import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateStore, Store } from '../src/host/store';

function v1(db: DatabaseSync) {
  db.exec(
    'CREATE TABLE documents(kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE events(run_id TEXT NOT NULL,seq INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(run_id,seq)); PRAGMA user_version=1;',
  );
}
function version(db: DatabaseSync) {
  return db.prepare('PRAGMA user_version').get()!.user_version;
}
function seal(key: Buffer, value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  return Buffer.concat([
    iv,
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
}

test('v1 upgrade preserves every encrypted document/event byte and their reader values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flowark-store-migration-'));
  const path = join(dir, 'flowark.sqlite');
  const key = randomBytes(32);
  const values = [
    'flow',
    'version',
    'snapshot',
    'schedule',
    'run',
    'trigger',
    'action',
    'attention',
    'artifact',
    'credential',
  ].map((kind) => ({ kind, value: { id: kind, fixture: '虚构旧版数据', nested: { number: 17 } } }));
  const event = { runId: 'run', seq: 1, type: 'log', data: { message: '旧事件' } };
  let db = new DatabaseSync(path);
  v1(db);
  for (const { kind, value } of values)
    db.prepare('INSERT INTO documents VALUES(?,?,?)').run(kind, kind, seal(key, value));
  db.prepare('INSERT INTO events VALUES(?,?,?)').run('run', 1, seal(key, event));
  const originalDocs = db.prepare('SELECT * FROM documents ORDER BY kind,id').all();
  const originalEvents = db.prepare('SELECT * FROM events').all();
  db.close();
  let store: Store | undefined;
  try {
    store = new Store(path, key);
    for (const { kind, value } of values) assert.deepEqual(store.get(kind, kind), value);
    assert.deepEqual(store.events('run'), [event]);
    db = new DatabaseSync(path);
    assert.equal(version(db), 3);
    assert.deepEqual(db.prepare('SELECT * FROM documents ORDER BY kind,id').all(), originalDocs);
    assert.deepEqual(db.prepare('SELECT * FROM events').all(), originalEvents);
    db.close();
  } finally {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a real read-only migration failure rolls back the version and original rows', () => {
  const db = new DatabaseSync(':memory:');
  try {
    v1(db);
    db.prepare('INSERT INTO documents VALUES(?,?,?)').run('fixture', 'id', 'unchanged');
    db.exec('PRAGMA query_only=ON');
    assert.throws(() => migrateStore(db), /readonly/i);
    assert.equal(version(db), 1);
    assert.equal(db.prepare('SELECT payload FROM documents').get()!.payload, 'unchanged');
    db.exec('PRAGMA query_only=OFF');
    migrateStore(db);
    assert.equal(version(db), 3);
    assert.equal(db.prepare('SELECT payload FROM documents').get()!.payload, 'unchanged');
  } finally {
    db.close();
  }
});

test('new stores use v3 and future readers fail without replacing database contents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flowark-store-future-'));
  const path = join(dir, 'flowark.sqlite');
  const key = randomBytes(32);
  try {
    const store = new Store(path, key);
    store.put('fixture', 'id', { value: 'retained' });
    store.close();
    const db = new DatabaseSync(path);
    assert.equal(version(db), 3);
    const original = db.prepare('SELECT * FROM documents').all();
    db.exec('PRAGMA user_version=4');
    assert.throws(() => new Store(path, key), /数据库版本.*已阻止打开/);
    assert.equal(version(db), 4);
    assert.deepEqual(db.prepare('SELECT * FROM documents').all(), original);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v2 to v3 retains encrypted rows and makes v2 readers refuse template-authorized data', () => {
  const db = new DatabaseSync(':memory:');
  try {
    v1(db);
    db.exec('PRAGMA user_version=2');
    db.prepare('INSERT INTO documents VALUES(?,?,?)').run(
      'template-instance',
      'fixture',
      'encrypted',
    );
    db.prepare('INSERT INTO events VALUES(?,?,?)').run('run', 1, 'encrypted-event');
    const before = db.prepare('SELECT * FROM documents').all();
    migrateStore(db);
    assert.equal(version(db), 3);
    assert.deepEqual(db.prepare('SELECT * FROM documents').all(), before);
    assert.equal(db.prepare('SELECT payload FROM events').get()!.payload, 'encrypted-event');
    assert.ok(![0, 1, 2].includes(Number(version(db))), 'legacy v2 reader rejects version 3');
  } finally {
    db.close();
  }
});
