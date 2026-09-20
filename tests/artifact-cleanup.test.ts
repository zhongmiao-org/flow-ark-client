import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  realpath,
  readFile,
  writeFile,
  access,
  rm,
  symlink,
  rename,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { Store } from '../src/host/store';
import { ArtifactCleanup } from '../src/host/artifact-cleanup';
import { ArtifactFiles } from '../src/adapters/artifacts';
import { validateIPC } from '../src/shared/ipc';

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'flowark-cleanup-')));
  const key = randomBytes(32);
  let store = new Store(join(root, 'flowark.sqlite'), Buffer.from(key));
  let busy = false;
  let cleanup = new ArtifactCleanup(root, store, () => busy);
  const files = new ArtifactFiles(root);
  const original = join(root, 'business.txt');
  await writeFile(original, 'keep business');
  for (const id of ['run', 'other'])
    store.put('run', id, {
      id,
      flowId: 'flow',
      state: 'SUCCEEDED',
      name: id,
      versionId: 'version',
      createdAt: 'then',
      updatedAt: 'then',
      business: '待核对',
      source: 'manual',
    });
  const add = async (runId = 'run') => {
    const artifactId = randomUUID();
    const copy = await files.capture(runId, artifactId, original, new AbortController().signal);
    const item = { ...copy, artifactId, runId, time: 'then' };
    store.put('artifact', artifactId, item);
    return item;
  };
  const copy = await add(),
    other = await add('other');
  return {
    root,
    original,
    copy,
    other,
    files,
    add,
    get store() {
      return store;
    },
    get cleanup() {
      return cleanup;
    },
    busy(value: boolean) {
      busy = value;
    },
    restart() {
      store.close();
      store = new Store(join(root, 'flowark.sqlite'), Buffer.from(key));
      cleanup = new ArtifactCleanup(root, store, () => busy);
    },
    async close() {
      store.close();
      key.fill(0);
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('cleanup previews actual owned files, keeps business files and history, and marks copies cleared across restart', async () => {
  const f = await fixture();
  try {
    const directory = join(f.root, 'artifacts', 'run');
    await writeFile(join(directory, 'download.txt'), 'download staging');
    await symlink(f.original, join(directory, 'external-link'));
    await symlink(join(f.root, 'artifacts', 'other'), join(directory, 'other-link'));
    f.store.put('artifact', 'old', {
      artifactId: 'old',
      runId: 'run',
      name: 'business.txt',
      path: f.original,
      size: 13,
    });
    f.store.put('snapshot', 'run', { fixed: true });
    f.store.put('action', 'unknown', { id: 'unknown', flowId: 'flow', state: 'UNKNOWN' });
    f.store.put('attention', 'review', {
      id: 'review',
      read: false,
      detail: { actionId: 'unknown' },
    });
    f.store.event('run', 'state', '', { state: 'SUCCEEDED' });
    const preserved = ['run', 'snapshot', 'action', 'attention'].map((kind) => f.store.list(kind));
    const preview = await f.cleanup.preview('run');
    assert.equal(preview.count, 4);
    assert.equal(preview.indexedCount, 1);
    assert.equal(preview.externalCount, 1);
    assert.equal(preview.bytes, 13 + 16);
    assert.equal(preview.files.filter((x) => x.link).length, 2);
    assert.equal((await f.cleanup.preview('run')).token, preview.token);
    assert.equal(await readFile(f.copy.path, 'utf8'), 'keep business');
    assert.equal(f.store.list('artifact-cleanup').length, 0);
    const done = await f.cleanup.clear('run', preview.token, true);
    assert.equal(done.state, 'completed');
    await assert.rejects(access(directory), { code: 'ENOENT' });
    assert.equal(await readFile(f.original, 'utf8'), 'keep business');
    assert.equal(await readFile(f.other.path, 'utf8'), 'keep business');
    assert.deepEqual(
      ['run', 'snapshot', 'action', 'attention'].map((kind) => f.store.list(kind)),
      preserved,
    );
    assert.equal(f.store.events('run').length, 2);
    const saved = f.store.get('artifact', f.copy.artifactId);
    assert.equal(saved.clearedAt, done.finishedAt);
    assert.deepEqual(await f.files.inspect(saved), { integrity: 'cleared', available: false });
    assert.equal((await f.files.inspect(f.store.get('artifact', 'old')!)).integrity, 'unverified');
    await assert.rejects(f.cleanup.clear('run', preview.token, true), /预览已过期/);
    f.restart();
    assert.equal(f.cleanup.status('run')?.state, 'completed');
    const empty = await f.cleanup.preview('run');
    assert.equal(empty.count, 0);
    assert.equal(empty.indexedCount, 0);
    assert.equal((await f.cleanup.clear('run', empty.token, true)).count, 0);
    // Recreated paths cannot resurrect an explicitly cleared historical reference.
    await mkdir(join(directory, f.copy.artifactId), { recursive: true });
    await writeFile(f.copy.path, 'keep business');
    assert.equal(
      (await f.files.inspect(f.store.get('artifact', f.copy.artifactId)!)).integrity,
      'cleared',
    );
  } finally {
    await f.close();
  }
});

test('cleanup rejects unreviewed, stale, active and finishing requests, directory links and cross-run references', async () => {
  const f = await fixture();
  try {
    const preview = await f.cleanup.preview('run');
    assert.throws(() =>
      validateIPC('run.artifacts.clear', { id: 'run', token: preview.token, reviewed: false }),
    );
    assert.throws(() => validateIPC('run.artifacts.preview', { id: 'run', path: f.original }));
    assert.throws(() =>
      validateIPC('run.artifacts.clear', {
        id: 'run',
        token: preview.token,
        reviewed: true,
        files: [f.original],
      }),
    );
    await assert.rejects(f.cleanup.clear('run', preview.token, false), /确认清理/);
    await writeFile(f.copy.path, 'changed bytes');
    await assert.rejects(f.cleanup.clear('run', preview.token, true), /预览已过期/);
    for (const state of ['QUEUED', 'RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING']) {
      f.store.put('run', 'run', { ...f.store.get('run', 'run'), state });
      await assert.rejects(f.cleanup.preview('run'), /尚未结束/);
    }
    f.store.put('run', 'run', { ...f.store.get('run', 'run'), state: 'CANCELLED' });
    f.busy(true);
    await assert.rejects(f.cleanup.preview('run'), /仍在收尾/);
    f.busy(false);
    const directory = join(f.root, 'artifacts', 'run');
    await rename(directory, directory + '-saved');
    await symlink(join(f.root, 'artifacts', 'other'), directory);
    await assert.rejects(f.cleanup.preview('run'), /符号链接/);
    await rm(directory);
    await rename(directory + '-saved', directory);
    await rename(join(f.root, 'artifacts'), join(f.root, 'saved-artifacts'));
    await symlink(join(f.root, 'saved-artifacts'), join(f.root, 'artifacts'));
    await assert.rejects(f.cleanup.preview('run'), /符号链接/);
    await rm(join(f.root, 'artifacts'));
    await rename(join(f.root, 'saved-artifacts'), join(f.root, 'artifacts'));
    f.store.put('artifact', 'foreign', { ...f.copy, artifactId: 'foreign', runId: 'other' });
    await assert.rejects(f.cleanup.preview('run'), /其他运行仍引用/);
    assert.equal(f.store.list('artifact-cleanup').length, 0);
    assert.equal(await readFile(f.copy.path, 'utf8'), 'changed bytes');
    assert.equal(await readFile(f.other.path, 'utf8'), 'keep business');
  } finally {
    await f.close();
  }
});

test('intent write failure deletes nothing; interrupted intent does not continue deletion on restart', async () => {
  const f = await fixture();
  try {
    const preview = await f.cleanup.preview('run');
    (f.store as any).db.exec('PRAGMA query_only=ON');
    await assert.rejects(f.cleanup.clear('run', preview.token, true));
    assert.ok(f.store.fault);
    assert.equal(await readFile(f.copy.path, 'utf8'), 'keep business');
    f.restart();
    f.store.put('artifact-cleanup', 'run', {
      runId: 'run',
      token: preview.token,
      state: 'pending',
      startedAt: 'then',
      count: 1,
      bytes: 13,
    });
    f.restart();
    assert.equal(f.cleanup.status('run')?.state, 'interrupted');
    await assert.rejects(f.cleanup.clear('run', preview.token, true), /预览已过期/);
    assert.equal(await readFile(f.copy.path, 'utf8'), 'keep business');
    assert.equal(f.store.events('run').length, 0);
  } finally {
    await f.close();
  }
});

test('partial deletion and completion-transaction failure stay visible and can be explicitly retried', async () => {
  const f = await fixture();
  try {
    const directories = (f.cleanup as any).directories;
    const remove = directories.remove.bind(directories);
    directories.remove = async () => {
      await rm(f.copy.path);
      throw new Error('fixture partial deletion');
    };
    const preview = await f.cleanup.preview('run');
    await assert.rejects(
      f.cleanup.clear('run', preview.token, true),
      /清理未完成.*partial deletion/,
    );
    assert.equal(f.cleanup.status('run')?.state, 'failed');
    assert.equal(f.store.get('artifact', f.copy.artifactId).clearedAt, undefined);
    assert.equal(f.store.events('run').length, 0);
    assert.equal(await readFile(f.original, 'utf8'), 'keep business');
    directories.remove = remove;
    const next = await f.cleanup.preview('run');
    const event = f.store.event.bind(f.store);
    f.store.event = (...args) => {
      if (args[1] === 'artifact') {
        f.store.fault = 'fixture completion write failed';
        throw new Error(f.store.fault);
      }
      return event(...args);
    };
    await assert.rejects(
      f.cleanup.clear('run', next.token, true),
      /清理未完成.*completion write failed/,
    );
    assert.equal(f.cleanup.status('run')?.state, 'failed');
    assert.equal(f.store.get('artifact-cleanup', 'run').state, 'pending');
    assert.equal(f.store.get('artifact', f.copy.artifactId).clearedAt, undefined);
    assert.equal(f.store.events('run').length, 0);
    f.restart();
    assert.equal(f.cleanup.status('run')?.state, 'interrupted');
    const retry = await f.cleanup.preview('run');
    assert.equal(retry.count, 0);
    assert.equal(retry.indexedCount, 1);
    await f.cleanup.clear('run', retry.token, true);
    assert.equal(
      f.store.get('artifact', f.copy.artifactId).clearedAt,
      f.cleanup.status('run')?.finishedAt,
    );
    assert.equal(f.store.events('run').length, 1);
    assert.equal(await readFile(f.other.path, 'utf8'), 'keep business');
  } finally {
    await f.close();
  }
});

test('concurrent cleanup is rejected and long previews disclose omitted file names without omitting deletion scope', async () => {
  const f = await fixture();
  let release!: () => void;
  try {
    const directory = join(f.root, 'artifacts', 'run');
    for (let i = 0; i < 102; i++) await writeFile(join(directory, `staging-${i}.txt`), 'x');
    const preview = await f.cleanup.preview('run');
    assert.equal(preview.count, 103);
    assert.equal(preview.files.length, 100);
    assert.equal(preview.omitted, 3);
    const directories = (f.cleanup as any).directories,
      remove = directories.remove.bind(directories);
    let entered!: () => void;
    const waiting = new Promise<void>((r) => {
      entered = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    directories.remove = async (...args: any[]) => {
      entered();
      await gate;
      return remove(...args);
    };
    const first = f.cleanup.clear('run', preview.token, true);
    await waiting;
    await assert.rejects(f.cleanup.clear('run', preview.token, true), /正在清理/);
    await assert.rejects(f.cleanup.preview('run'), /正在清理/);
    assert.equal(f.cleanup.status('run')?.state, 'pending');
    release();
    await first;
    assert.equal(f.store.events('run').length, 1);
    await assert.rejects(access(directory), { code: 'ENOENT' });
  } finally {
    release?.();
    await f.close();
  }
});
