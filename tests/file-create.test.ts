import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, symlink, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import example from '../contracts/example.file-create.json';
import type { Flow, Step } from '../src/shared/types';
import { validateFlow } from '../src/core/validate';
import { fileOperation } from '../src/adapters/files';
import {
  MAX_TEXT_BYTES,
  validateCreatedName,
  validateCreatedText,
} from '../src/shared/file-create';
import { resourceOperation } from '../src/renderer/resource-form-model';
import { reviewEffects } from '../src/host/run-review-effects';
const node = { ...example.steps[0], content: '标题：示例资料页\n第二行 💡' };
async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'flowark-create-text-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifacts: string[] = [];
  return {
    root,
    artifacts,
    run: (n: any) =>
      fileOperation(n, { files: { output: root }, credentials: [] }, async (path) => {
        artifacts.push(path);
        return { artifactId: 'artifact', runId: 'run' };
      }),
  };
}
test('create-only contract validates known values and capability while leaving scoped runtime references deferred', () => {
  assert.doesNotThrow(() => validateFlow(example));
  assert.throws(() => validateFlow({ ...example, requiredCapabilities: [] }), /file-create-v1/);
  for (const content of [null, false, 0, [], { text: 'not text' }])
    assert.throws(() => validateFlow({ ...example, steps: [{ ...node, content }] }), /必须是文本/);
  assert.throws(() => validateFlow({ ...example, parameters: { title: 42 } }), /必须是文本/);
  assert.throws(() => validateFlow({ ...example, steps: [{ ...node, version: 1 }] }), /格式无效/);
  assert.throws(
    () => validateFlow({ ...example, steps: [{ ...node, content: { $ref: 'steps.future' } }] }),
    /作用域/,
  );
  assert.doesNotThrow(() =>
    validateFlow({
      ...example,
      steps: [
        { id: 'prior', type: 'value', version: 1, value: 'title' },
        { ...node, name: { $ref: 'steps.prior' }, content: { $ref: 'steps.prior' } },
      ],
    }),
  );
});
test('create text uses UTF-8 byte limit and safe relative names, without implicit conversions', () => {
  const limit = '💡'.repeat(MAX_TEXT_BYTES / 4);
  assert.doesNotThrow(() => validateCreatedText(limit));
  assert.throws(() => validateCreatedText(limit + 'a'), /10 MiB/);
  assert.doesNotThrow(() => validateCreatedText(''));
  for (const name of [
    '',
    '/absolute.txt',
    '../escape.txt',
    'a/../b',
    'a/./b',
    'a//b',
    'C:foo',
    'a\\b',
    'a\nb',
    'a\u007fb',
  ])
    assert.throws(() => validateCreatedName(name), /相对路径/);
  assert.doesNotThrow(() => validateCreatedName('子目录/标题.txt'));
});
test('create writes exact text bytes and empty files, and only then registers artifacts', async (t) => {
  const { root, run, artifacts } = await fixture(t);
  await mkdir(join(root, 'nested'));
  await run({ ...node, name: 'nested/title.txt' });
  assert.deepEqual(
    await readFile(join(root, 'nested/title.txt')),
    Buffer.from(node.content, 'utf8'),
  );
  await run({ ...node, name: 'empty.txt', content: '' });
  assert.equal((await readFile(join(root, 'empty.txt'))).length, 0);
  assert.equal(artifacts.length, 2);
  assert.equal((await lstat(join(root, 'empty.txt'))).mode & 0o777, 0o600);
});
test('create preserves regular files, directories, valid and dangling links, and rejects escaped paths', async (t) => {
  const { root, run, artifacts } = await fixture(t);
  await writeFile(join(root, 'keep.txt'), 'original bytes');
  await mkdir(join(root, 'folder'));
  await symlink(join(root, 'keep.txt'), join(root, 'link.txt'));
  await symlink(join(root, 'absent.txt'), join(root, 'dangling.txt'));
  for (const name of ['keep.txt', 'folder', 'link.txt', 'dangling.txt'])
    await assert.rejects(run({ ...node, name }), /已存在/);
  await assert.rejects(run({ ...node, name: '../outside.txt' }), /相对路径/);
  await assert.rejects(run({ ...node, name: 'missing/file.txt' }));
  assert.equal(await readFile(join(root, 'keep.txt'), 'utf8'), 'original bytes');
  assert.ok((await lstat(join(root, 'dangling.txt'))).isSymbolicLink());
  assert.equal(artifacts.length, 0);
  assert.deepEqual((await readdir(root)).sort(), [
    'dangling.txt',
    'folder',
    'keep.txt',
    'link.txt',
  ]);
});
test('same-name creation is atomic under contention; validation failure has no file or artifact', async (t) => {
  const { root, run, artifacts } = await fixture(t);
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) => run({ ...node, content: String(i) })),
  );
  const winners = results.flatMap((r, i) => (r.status === 'fulfilled' ? [i] : []));
  assert.equal(winners.length, 1);
  assert.equal(await readFile(join(root, node.name), 'utf8'), String(winners[0]));
  for (const content of [42, null, { title: 'bad' }, '💡'.repeat(MAX_TEXT_BYTES / 4) + 'x'])
    await assert.rejects(run({ ...node, name: 'invalid.txt', content }));
  assert.equal(artifacts.length, 1);
  assert.deepEqual(await readdir(root), [node.name]);
});
test('artifact registration failure keeps the already committed file and prevents an automatic overwrite', async (t) => {
  const { root, run, artifacts } = await fixture(t);
  await assert.rejects(
    fileOperation(node, { files: { output: root }, credentials: [] }, async () => {
      throw new Error('artifact store failure');
    }),
    /artifact store failure/,
  );
  assert.equal(await readFile(join(root, node.name), 'utf8'), node.content);
  await assert.rejects(run(node), /已存在/);
  assert.equal(artifacts.length, 0);
  assert.deepEqual(await readdir(root), [node.name]);
});
test('create operation conversion preserves binding and timeout, and review states the real no-overwrite effect', () => {
  const archive = {
    id: 'file',
    type: 'file',
    version: 2,
    operation: 'archive',
    name: 'bundle.zip',
    files: ['input'],
    binding: 'chosen',
    timeoutMs: 4321,
  } as Step;
  const created = resourceOperation(archive as any, 'create');
  assert.deepEqual(created, {
    id: 'file',
    type: 'file',
    version: 3,
    operation: 'create',
    binding: 'chosen',
    timeoutMs: 4321,
    name: 'result.txt',
    content: '',
  });
  assert.equal(resourceOperation(created, 'write').version, 1);
  const effect = reviewEffects({ ...example, steps: [created] } as Flow)[0];
  assert.equal(effect.kind, 'write');
  assert.match(effect.detail, /新建文本文件.*同名文件存在时停止，不覆盖/);
  assert.doesNotMatch(effect.detail, /可能覆盖/);
});
