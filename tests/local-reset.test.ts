import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
// @ts-expect-error one-time native maintenance module is deliberately outside app builds
import { resetLocalWork } from '../scripts/maintenance/reset-local-work.mjs';
test('explicit reset removes only work and owned artifacts while preserving encrypted credentials, browser state, settings, backups and external files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'reset-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of [
    'credentials',
    'browser-profiles',
    'Partitions',
    'backups',
    'external',
    'artifacts',
    'compiled',
  ]) {
    await mkdir(join(root, name));
    await writeFile(join(root, name, 'keep'), 'original');
  }
  const db = new DatabaseSync(join(root, 'flowark.sqlite'));
  db.exec(
    'CREATE TABLE documents(kind TEXT,id TEXT,payload TEXT); CREATE TABLE events(run_id TEXT,seq INTEGER,payload TEXT)',
  );
  for (const kind of ['browser', 'settings', 'flow', 'run', 'action', 'attention'])
    db.prepare('INSERT INTO documents VALUES(?,?,?)').run(kind, 'one', 'opaque-encrypted');
  db.exec("INSERT INTO events VALUES('one',1,'opaque')");
  db.close();
  const options = { assertStopped: async () => {} };
  await assert.rejects(resetLocalWork(root));
  await resetLocalWork(root, options);
  await access(join(root, 'artifacts/keep'));
  await resetLocalWork(root, { ...options, apply: true });
  for (const name of ['credentials', 'browser-profiles', 'Partitions', 'backups', 'external'])
    assert.equal(await readFile(join(root, name, 'keep'), 'utf8'), 'original');
  await assert.rejects(access(join(root, 'artifacts')));
  const read = new DatabaseSync(join(root, 'flowark.sqlite'));
  assert.deepEqual(
    read
      .prepare('SELECT kind FROM documents ORDER BY kind')
      .all()
      .map((r) => r.kind),
    ['browser', 'settings'],
  );
  assert.equal(read.prepare('SELECT count(*) AS n FROM events').get()!.n, 0);
  read.close();
  await symlink(join(root, 'external'), join(root, 'artifacts'));
  await assert.rejects(resetLocalWork(root, { ...options, apply: true }), /symlink/);
  assert.equal(await readFile(join(root, 'external/keep'), 'utf8'), 'original');
});
