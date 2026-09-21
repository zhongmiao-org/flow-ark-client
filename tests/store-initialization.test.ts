import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { initializeStore } from '../src/host/store';
test('current storage initializes atomically and reopening does not alter records', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA query_only=ON');
    assert.throws(() => initializeStore(db), /readonly/i);
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 0);
    db.exec('PRAGMA query_only=OFF');
    initializeStore(db);
    db.prepare('INSERT INTO documents VALUES(?,?,?)').run('settings', 'one', 'opaque');
    initializeStore(db);
    assert.equal(db.prepare('SELECT payload FROM documents').get()!.payload, 'opaque');
  } finally {
    db.close();
  }
});
