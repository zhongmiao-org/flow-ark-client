import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import example from '../contracts/example.file-create-numbered.json';
import { validateFlow } from '../src/core/validate';
import { fileOperation } from '../src/adapters/files';
import { numberedFilename, MAX_CREATED_NAMES } from '../src/shared/file-create';
import { fileConflictPolicy } from '../src/renderer/resource-form-model';
import { reviewEffects } from '../src/host/run-review-effects';
import { planningResources } from '../src/host/planning-diff';
import type { Flow, Step } from '../src/shared/types';
const node = { ...example.steps[0], name: '页面标题.txt', content: '标题 💡\n完整字节' };
async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(join(tmpdir(), 'flowark-numbered-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const artifacts: string[] = [];
  const bindings = { files: { output: root }, credentials: [] };
  const run = (changes: any = {}, signal?: AbortSignal) =>
    fileOperation(
      { ...node, ...changes },
      bindings,
      async (path) => {
        signal?.throwIfAborted();
        artifacts.push(path);
        return path;
      },
      signal,
    );
  return { root, artifacts, bindings, run };
}

test('numbered contract and editor preserve explicit policy, references and distinct no-overwrite effects', () => {
  assert.doesNotThrow(() => validateFlow(example));
  for (const change of [
    { version: 3 },
    { onConflict: undefined },
    { onConflict: 'overwrite' },
    { onConflict: { $ref: 'params.policy' } },
  ])
    assert.throws(() => validateFlow({ ...example, steps: [{ ...node, ...change }] }));
  assert.throws(
    () => validateFlow({ ...example, requiredCapabilities: ['file-create-v1'] }),
    /file-create-numbered-v1/,
  );
  assert.throws(() => validateFlow({ ...example, parameters: { title: false } }), /必须是文本/);
  const base = { ...node, timeoutMs: 4321, content: { $ref: 'params.title' } } as Step;
  const stop = fileConflictPolicy(base as any, 'error');
  assert.equal(stop.version, 3);
  assert.ok(!Object.hasOwn(stop, 'onConflict'));
  const restored = fileConflictPolicy(stop as any, 'number');
  assert.deepEqual(restored, base);
  assert.throws(() => fileConflictPolicy(base as any, 'overwrite'));
  const flow = { ...example, steps: [restored] } as Flow;
  assert.match(reviewEffects(flow)[0].detail, /同名自动加序号.*不覆盖.*执行后确定/);
  assert.match(planningResources(flow).join(' '), /同名自动加序号/);
});

test('numbering follows the final extension, preserves parent/name text and bounds candidates', () => {
  for (const [name, expected] of [
    ['结果.txt', '结果 (2).txt'],
    ['sub.dir/archive.tar.gz', 'sub.dir/archive.tar (2).gz'],
    ['结果', '结果 (2)'],
    ['.env', '.env (2)'],
    ['.env.local', '.env (2).local'],
    ['结果 (8).txt', '结果 (8) (2).txt'],
    ['sub.dir/结果', 'sub.dir/结果 (2)'],
  ]) {
    assert.equal(numberedFilename(name, 0), name);
    assert.equal(numberedFilename(name, 2), expected);
  }
  for (const index of [-1, 0.5, MAX_CREATED_NAMES, Infinity])
    assert.throws(() => numberedFilename('x', index));
});

test('original names and occupied numbered files, directories and links are preserved without following leaf links', async (t) => {
  const f = await fixture(t),
    outside = await fs.mkdtemp(join(tmpdir(), 'flowark-numbered-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const external = join(outside, 'protected.txt');
  await fs.writeFile(external, 'external unchanged');
  await fs.writeFile(join(f.root, node.name), 'original');
  await fs.mkdir(join(f.root, '页面标题 (1).txt'));
  await fs.symlink(join(f.root, node.name), join(f.root, '页面标题 (2).txt'));
  await fs.symlink(join(f.root, 'absent'), join(f.root, '页面标题 (3).txt'));
  await fs.symlink(external, join(f.root, '页面标题 (4).txt'));
  const path = await f.run();
  assert.equal(basename(path), '页面标题 (5).txt');
  assert.deepEqual(await fs.readFile(path), Buffer.from(node.content));
  assert.equal(await fs.readFile(join(f.root, node.name), 'utf8'), 'original');
  assert.equal(await fs.readFile(external, 'utf8'), 'external unchanged');
  for (const i of [2, 3, 4])
    assert.ok((await fs.lstat(join(f.root, `页面标题 (${i}).txt`))).isSymbolicLink());
  await fs.symlink(outside, join(f.root, 'outside-parent'));
  await assert.rejects(f.run({ name: 'outside-parent/new.txt' }), /授权目录/);
  assert.deepEqual(f.artifacts, [path]);
  assert.ok(!(await fs.readdir(f.root)).some((n) => n.startsWith('.flowark-')));
});

test('concurrent numbered output publishes one unique file per invocation and reports the actual paths', async (t) => {
  const f = await fixture(t);
  const paths = await Promise.all(
    Array.from({ length: 24 }, (_, i) => f.run({ content: 'writer-' + i })),
  );
  assert.equal(new Set(paths).size, 24);
  for (const [i, path] of paths.entries())
    assert.equal(await fs.readFile(path, 'utf8'), 'writer-' + i);
  assert.deepEqual(
    new Set(await fs.readdir(f.root)),
    new Set(Array.from({ length: 24 }, (_, i) => numberedFilename(node.name, i))),
  );
  assert.deepEqual(new Set(f.artifacts), new Set(paths));
});

test('exhausted numbered names stop without a new artifact, changed bytes or temporary remnants', async (t) => {
  const f = await fixture(t);
  await Promise.all(
    Array.from({ length: MAX_CREATED_NAMES }, (_, i) =>
      fs.writeFile(join(f.root, numberedFilename(node.name, i)), 'keep-' + i),
    ),
  );
  await assert.rejects(f.run(), /999 个序号均已占用/);
  assert.equal((await fs.readdir(f.root)).length, MAX_CREATED_NAMES);
  assert.equal(await fs.readFile(join(f.root, node.name), 'utf8'), 'keep-0');
  assert.equal(
    await fs.readFile(join(f.root, numberedFilename(node.name, 999)), 'utf8'),
    'keep-999',
  );
  assert.equal(f.artifacts.length, 0);
});

test('non-collision IO errors do not choose another name and cancellation between collisions stops publication', async (t) => {
  const f = await fixture(t);
  let attempts = 0;
  const denied = t.mock.method(fs, 'link', async () => {
    attempts++;
    throw Object.assign(new Error('denied'), { code: 'EACCES' });
  });
  await assert.rejects(f.run(), /denied/);
  assert.equal(attempts, 1);
  assert.deepEqual(await fs.readdir(f.root), []);
  denied.mock.restore();
  const abort = new AbortController();
  attempts = 0;
  const collision = t.mock.method(fs, 'link', async () => {
    attempts++;
    abort.abort(new Error('fixture cancelled'));
    throw Object.assign(new Error('occupied'), { code: 'EEXIST' });
  });
  await assert.rejects(f.run({}, abort.signal), /fixture cancelled/);
  assert.equal(attempts, 1);
  assert.deepEqual(await fs.readdir(f.root), []);
  collision.mock.restore();
  await assert.rejects(f.run({}, abort.signal), /fixture cancelled/);
  assert.deepEqual(await fs.readdir(f.root), []);
  assert.equal(f.artifacts.length, 0);
});

test('post-commit cancellation and artifact failures keep exactly the one published output', async (t) => {
  const f = await fixture(t),
    abort = new AbortController(),
    actual = fs.link.bind(fs);
  const publish = t.mock.method(
    fs,
    'link',
    async (from: Parameters<typeof fs.link>[0], to: Parameters<typeof fs.link>[1]) => {
      await actual(from, to);
      abort.abort(new Error('cancel after commit'));
    },
  );
  await assert.rejects(f.run({}, abort.signal), /cancel after commit/);
  publish.mock.restore();
  assert.deepEqual(await fs.readdir(f.root), [node.name]);
  await assert.rejects(
    fileOperation(node, f.bindings, async () => {
      throw new Error('artifact failed');
    }),
    /artifact failed/,
  );
  assert.deepEqual(
    (await fs.readdir(f.root)).sort(),
    [node.name, numberedFilename(node.name, 1)].sort(),
  );
  for (const name of await fs.readdir(f.root))
    assert.equal(await fs.readFile(join(f.root, name), 'utf8'), node.content);
  assert.equal(f.artifacts.length, 0);
});
