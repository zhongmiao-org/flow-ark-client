import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ArtifactFiles } from '../src/adapters/artifacts';

test('history copies retain bytes and names independently of the source and other registrations', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'flowark-artifacts-')));
  const files = new ArtifactFiles(root);
  const source = join(root, '结果 副本.txt');
  try {
    await writeFile(source, 'first');
    const first = await files.capture('run', 'first', source, new AbortController().signal);
    await writeFile(source, 'later');
    const next = await files.capture('run', 'next', source, new AbortController().signal);
    await rm(source);
    assert.equal(first.name, '结果 副本.txt');
    assert.notEqual(first.path, next.path);
    assert.equal(await readFile(first.path, 'utf8'), 'first');
    assert.equal(await readFile(next.path, 'utf8'), 'later');
    assert.deepEqual(await files.inspect(first), { available: true, integrity: 'verified' });
    await writeFile(first.path, 'other'); // Same length; polling must invalidate the cached digest.
    assert.deepEqual(await files.inspect(first), { available: false, integrity: 'changed' });
    // A locate request must bypass even a matching cache entry.
    (files as any).cache.get(first.path).sha256 = first.sha256;
    assert.deepEqual(await files.inspect(first, true), { available: false, integrity: 'changed' });
    await rm(first.path);
    assert.deepEqual(await files.inspect(first), { available: false, integrity: 'missing' });
    await symlink(next.path, first.path);
    assert.deepEqual(await files.inspect(first, true), { available: false, integrity: 'missing' });
    assert.deepEqual(await files.inspect({ path: next.path }), {
      available: true,
      integrity: 'unverified',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cancelled and invalid captures do not publish, remove a source or overwrite an existing copy', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'flowark-artifact-fail-')));
  const files = new ArtifactFiles(root);
  const source = join(root, 'source.txt');
  try {
    await writeFile(source, 'keep');
    const signal = AbortSignal.abort();
    await assert.rejects(files.capture('run', 'cancel', source, signal), /abort/i);
    await assert.rejects(
      files.capture('run', 'dir', root, new AbortController().signal),
      /普通文件/,
    );
    const copy = await files.capture('run', 'copy', source, new AbortController().signal);
    await assert.rejects(
      files.capture('run', 'copy', source, new AbortController().signal),
      /EEXIST/,
    );
    assert.equal(await readFile(copy.path, 'utf8'), 'keep');
    await files.discard(copy);
    assert.deepEqual(await readdir(join(root, 'artifacts', 'run')), []);
    assert.equal(await readFile(source, 'utf8'), 'keep');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an in-progress stream is cancelled or rejects a source changed during copying and removes its partial copy', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'flowark-artifact-stream-')));
  const source = join(root, 'large.txt');
  const files = new ArtifactFiles(root);
  try {
    for (const mode of ['cancel', 'change']) {
      const input = await open(source, 'w');
      await input.truncate(64 * 1024 * 1024);
      await input.close();
      const controller = new AbortController();
      let settled = false;
      const capture = files.capture('run', mode, source, controller.signal);
      const rejected = assert.rejects(capture, mode === 'cancel' ? /abort/i : /发生变化/);
      void capture.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      const target = join(root, 'artifacts', 'run', mode, 'large.txt');
      while (!settled && !(await stat(target).catch(() => undefined))?.size)
        await new Promise((r) => setImmediate(r));
      assert.equal(settled, false, 'intervene after bytes are copied, before the stream completes');
      if (mode === 'cancel') controller.abort();
      else {
        const changed = await open(source, 'r+');
        await changed.write(Buffer.from('changed'), 0, 7, 0);
        await changed.close();
      }
      await rejected;
      assert.equal((await stat(source)).size, 64 * 1024 * 1024);
      assert.deepEqual(await readdir(join(root, 'artifacts', 'run')), []);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('authenticated previews support UTF-8 and reject changed, cleared, linked, binary and oversized copies', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'flowark-preview-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = new ArtifactFiles(root),
    source = join(root, 'result.txt');
  let index = 0;
  const capture = async (content: string | Buffer) => {
    await writeFile(source, content);
    return files.capture('run', String(index++), source, new AbortController().signal);
  };
  const a = await capture('真实文本 😀\n<script>plain text</script>');
  assert.deepEqual(await files.preview(a), { text: '真实文本 😀\n<script>plain text</script>' });
  assert.ok('reason' in (await files.preview({ ...a, clearedAt: 'now' })));
  assert.ok('reason' in (await files.preview({ path: a.path })));
  const b = await capture('else');
  await writeFile(a.path, 'tampered');
  assert.ok('reason' in (await files.preview(a)));
  await rm(a.path);
  await symlink(b.path, a.path);
  assert.ok('reason' in (await files.preview(a)));
  for (const content of [
    Buffer.from([0xff, 0xfe]),
    Buffer.from([0x61, 0, 0x62]),
    'x'.repeat(1048577),
  ])
    assert.ok('reason' in (await files.preview(await capture(content))));
  assert.deepEqual(await files.preview(await capture('')), { text: '' });
});

test('preview authenticates bytes read from the descriptor and rejects a mutation during that read', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'flowark-preview-race-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = new ArtifactFiles(root),
    source = join(root, 'source.txt');
  await writeFile(source, 'before');
  const a = await files.capture('run', 'copy', source, new AbortController().signal);
  const sample = await open(source, 'r');
  const prototype = Object.getPrototypeOf(sample),
    original = prototype.read;
  await sample.close();
  let changed = false;
  t.mock.method(prototype, 'read', async function (this: any, ...args: any[]) {
    const result = await original.apply(this, args);
    if (!changed) {
      changed = true;
      await writeFile(a.path, 'after!');
    }
    return result;
  });
  assert.ok('reason' in (await files.preview(a)));
  assert.equal(changed, true);
});
