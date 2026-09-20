import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from '../src/host/store';
import { listRuns, runOverview } from '../src/host/run-history';
import { validateIPC } from '../src/shared/ipc';
import type { Run } from '../src/shared/types';
const run = (n: number, extra: Partial<Run> = {}): Run => ({
  id: `history-${n}`,
  flowId: 'flow-a',
  versionId: 'version',
  name: '虚构 History',
  state: 'SUCCEEDED',
  source: 'manual',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  business: 'fixture',
  ...extra,
});
function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'flowark-history-unit-')),
    key = randomBytes(32);
  const path = join(dir, 'store.sqlite');
  let store = new Store(path, Buffer.from(key));
  t.after(() => {
    store.close();
    key.fill(0);
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = new Store(path, Buffer.from(key));
    },
  };
}
test('history traverses all 503 same-time runs once, preserving boundaries across new runs, updates and reopen', async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 503; i++) {
    f.store.put('run', run(i).id, run(i));
    if (i % 3 === 0) f.store.put('snapshot', String(i), { fixture: true });
  }
  let page = await listRuns(f.store, { limit: 37 });
  assert.equal(page.runs.length, 37);
  assert.equal(page.totalCount, 503);
  const found = page.runs.map((r) => r.id);
  for (let i = 503; i < 512; i++) f.store.put('run', run(i).id, run(i));
  f.store.put('run', run(400).id, run(400, { state: 'FAILED' }));
  f.reopen();
  while (page.nextCursor) {
    page = await listRuns(f.store, { limit: 37, cursor: page.nextCursor });
    assert.ok(page.runs.length <= 37);
    assert.equal(page.totalCount, 512);
    assert.equal(page.newerCount, 9);
    found.push(...page.runs.map((r) => r.id));
  }
  assert.deepEqual(
    found,
    Array.from({ length: 503 }, (_, i) => run(502 - i).id),
  );
  assert.equal((await listRuns(f.store, {})).runs[0].id, run(511).id);
  assert.equal((await listRuns(f.store, { query: 'history-400' })).runs[0].state, 'FAILED');
});
test('literal search and state/source filters reach old records and enforce cursor/query validation', async (t) => {
  const { store } = fixture(t);
  for (let i = 0; i < 401; i++)
    store.put(
      'run',
      run(i).id,
      run(i, {
        name: i % 2 ? 'Plain name' : 'Alpha %_[x]',
        state: i % 3 ? 'FAILED' : 'SUCCEEDED',
        source: i % 5 ? 'manual' : 'schedule',
        flowId: i === 0 ? 'old-flow-id' : 'flow-a',
      }),
    );
  const args = {
    query: '  aLPHa %_[x]  ',
    source: 'schedule',
    state: 'SUCCEEDED',
    limit: 5,
  } as const;
  let page = await listRuns(store, args),
    ids = page.runs.map((r) => r.id);
  const cursor = page.nextCursor!;
  assert.ok(cursor);
  while (page.nextCursor) {
    page = await listRuns(store, { ...args, cursor: page.nextCursor });
    ids.push(...page.runs.map((r) => r.id));
  }
  assert.deepEqual(
    ids,
    Array.from({ length: 401 }, (_, i) => 400 - i)
      .filter((i) => i % 30 === 0)
      .map((i) => run(i).id),
  );
  assert.deepEqual(
    (await listRuns(store, { query: 'OLD-FLOW-ID' })).runs.map((r) => r.id),
    [run(0).id],
  );
  assert.equal((await listRuns(store, { query: 'not-present' })).runs.length, 0);
  for (const changed of [
    { limit: 6 },
    { state: 'FAILED' },
    { source: 'manual' },
    { query: 'plain' },
  ])
    await assert.rejects(listRuns(store, { ...args, ...changed, cursor }), /分页位置无效/);
  for (const invalid of [
    '?',
    'e30',
    Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(cursor, 'base64url').toString()), before: -1 }),
    ).toString('base64url'),
  ])
    await assert.rejects(listRuns(store, { ...args, cursor: invalid }), /分页位置无效/);
  for (const bad of [
    { limit: 0 },
    { limit: 101 },
    { limit: 1.2 },
    { cursor: '' },
    { cursor: 'x'.repeat(1025) },
    { query: 'x'.repeat(201) },
    { state: 'UNKNOWN' },
    { source: 'remote' },
    { path: '/tmp' },
  ]) {
    assert.throws(() => validateIPC('run.list', bad));
    await assert.rejects(listRuns(store, bad));
  }
  assert.deepEqual(validateIPC('run.list', {}), {});
});
test('overview includes older active runs and per-flow latest; rolled back writes do not change history', async (t) => {
  const { store } = fixture(t);
  store.put('run', run(0).id, run(0, { flowId: '__proto__', state: 'WAITING_INPUT' }));
  for (let i = 1; i <= 205; i++) store.put('run', run(i).id, run(i, { state: 'QUEUED' }));
  assert.throws(
    () =>
      store.tx(() => {
        store.put('run', run(500).id, run(500));
        throw new Error('rollback');
      }),
    /rollback/,
  );
  const overview = runOverview(store.list<Run>('run').reverse());
  assert.equal(overview.total, 206);
  assert.equal(overview.queued, 205);
  assert.equal(overview.active?.id, run(0).id);
  assert.deepEqual(
    overview.latest.map((r) => r.id),
    [run(205).id, run(0).id],
  );
  assert.equal((await listRuns(store, { state: 'WAITING_INPUT' })).runs[0].id, run(0).id);
  assert.equal(runOverview([]).active, null);
});
test('long filtered scan yields without including newer matches outside its captured boundary', async (t) => {
  const { store } = fixture(t);
  for (let i = 0; i < 601; i++)
    store.put('run', run(i).id, run(i, { name: i === 0 ? 'needle' : 'other' }));
  const insertion = new Promise<void>((resolve) =>
    setImmediate(() => {
      store.put('run', run(700).id, run(700, { name: 'needle' }));
      resolve();
    }),
  );
  const page = await listRuns(store, { query: 'needle' });
  await insertion;
  assert.deepEqual(
    page.runs.map((r) => r.id),
    [run(0).id],
  );
  assert.equal(page.newerCount, 1);
});
