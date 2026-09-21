import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/host/store';
import { Learning } from '../src/host/learning';
import { Planning } from '../src/host/planning';
import { validateIPC } from '../src/shared/ipc';
import { learningPrompt } from '../src/shared/learning';
import type { Run } from '../src/shared/types';

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'flowark-learning-'));
  const store = new Store(join(dir, 'store.sqlite'), randomBytes(32));
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const planning = new Planning(store, {
    assertAvailable() {},
    key: async () => {
      throw new Error('no provider during learning navigation');
    },
    save() {
      throw new Error('no flow creation during learning navigation');
    },
  });
  const learning = new Learning(store, {
    create: () => planning.create(undefined, learningPrompt),
    detail: (id) => planning.detail(id),
    assertAvailable() {},
  });
  const start = (mode = 'continue') =>
    learning.request('learning.start', { revision: learning.status().revision, mode }) as any;
  return { store, planning, learning, start };
}

test('learning IPC forbids renderer completion flags and status reads do not initialize a record', (t) => {
  const f = fixture(t);
  assert.deepEqual(f.learning.status(), {
    revision: 0,
    status: 'new',
    achieved: {},
    taskExists: false,
  });
  assert.equal(f.store.count('learning'), 0);
  for (const [method, args] of [
    ['learning.status', { done: true }],
    ['learning.start', { revision: 0, mode: 'finish' }],
    ['learning.start', { revision: 0, mode: 'continue', taskId: 'invented' }],
    ['learning.skip', { revision: -1 }],
  ] as const)
    assert.throws(() => validateIPC(method, args));
  assert.throws(() => validateIPC('learning.complete', {}));
});

test('begin is atomic and stale double-clicks never create another task; skip and continue preserve it', (t) => {
  const f = fixture(t);
  const first = f.start();
  assert.equal(first.learning.status, 'active');
  assert.equal(first.detail.task.description, learningPrompt);
  assert.equal(f.store.count('ai-task'), 1);
  assert.throws(
    () => f.learning.request('learning.start', { revision: 0, mode: 'continue' }),
    /变化/,
  );
  const skipped = f.learning.request('learning.skip', { revision: first.learning.revision }) as any;
  assert.equal(skipped.status, 'skipped');
  const next = f.start();
  assert.equal(next.detail.task.id, first.detail.task.id);
  for (const kind of ['run', 'flow', 'snapshot']) assert.equal(f.store.count(kind), 0);
  assert.equal(f.store.count('ai-task'), 1);
});

test('failed learning write rolls back the newly created task as well', (t) => {
  const f = fixture(t),
    original = f.store.put.bind(f.store);
  t.mock.method(f.store, 'put', (kind: string, id: string, value: unknown) => {
    if (kind === 'learning') throw new Error('injected learning write failure');
    return original(kind, id, value);
  });
  assert.throws(() => f.start(), /injected/);
  assert.equal(f.store.count('ai-task'), 0);
  assert.equal(f.store.count('learning'), 0);
});

test('missing task refuses silent recreation and restart retains every old task', (t) => {
  const f = fixture(t),
    a = f.start();
  f.store.remove('ai-task', a.detail.task.id);
  assert.throws(() => f.start(), /已不存在/);
  const b = f.start('restart');
  assert.notEqual(b.detail.task.id, a.detail.task.id);
  const c = f.start('restart');
  assert.notEqual(c.learning.attemptId, b.learning.attemptId);
  assert.equal(f.store.count('ai-task'), 2);
});

test('restart is denied for a generating task or an unterminated run without cancelling either', (t) => {
  const f = fixture(t),
    a = f.start(),
    task = a.detail.task;
  f.store.put('ai-task', task.id, { ...task, status: 'generating' });
  assert.throws(() => f.start('restart'), /仍在/);
  f.store.put('ai-task', task.id, task);
  for (const state of ['QUEUED', 'RUNNING', 'WAITING_INPUT', 'PAUSED', 'CANCELLING']) {
    f.store.put('run', 'owned', { id: 'owned', task: { id: task.id }, state });
    assert.throws(() => f.start('restart'), /仍在/);
    assert.equal(f.store.get('run', 'owned').state, state);
  }
  assert.equal(f.store.count('ai-task'), 1);
  assert.equal(f.learning.status().attemptId, a.learning.attemptId);
});

test('only ordered evidence for this attempt advances learning; skipped completion remains skipped until continued', (t) => {
  const f = fixture(t),
    a = f.start(),
    task = a.detail.task;
  const selected = { ...task, webTarget: { selectionId: 'actual-selection' } } as any;
  f.learning.plan(selected, 'early');
  f.learning.target({ ...selected, id: 'unrelated' });
  assert.deepEqual(f.learning.status().achieved, {});
  f.learning.target(selected);
  f.learning.plan(selected, 'actual-hash');
  const run = {
    id: 'actual-run',
    state: 'SUCCEEDED',
    task: { id: task.id },
    review: { reviewedAt: 'now' },
  } as Run;
  f.store.put('run', run.id, run);
  f.learning.trial(run);
  f.learning.request('learning.skip', { revision: f.learning.status().revision });
  f.learning.result(
    a.learning.attemptId,
    { runId: run.id, artifactId: 'actual-artifact' },
    'real text',
  );
  assert.equal(f.learning.status().status, 'skipped');
  assert.equal(Object.keys(f.learning.status().achieved).length, 4);
  assert.equal(f.start().learning.status, 'completed');
  const stable = f.learning.status();
  f.learning.target(selected);
  f.learning.plan(selected, 'another-hash');
  f.learning.trial(run);
  assert.deepEqual(f.learning.status(), stable);
  f.learning.request('learning.skip', { revision: stable.revision });
  assert.equal(f.learning.status().status, 'completed');
});

test('failed runs, empty previews and late result receipts cannot complete a new attempt', (t) => {
  const f = fixture(t),
    a = f.start(),
    task = a.detail.task;
  f.learning.target({ ...task, webTarget: { selectionId: 's' } } as any);
  f.learning.plan({ ...task, webTarget: {} } as any, 'hash');
  const run = {
    id: 'r',
    state: 'FAILED',
    task: { id: task.id },
    review: { reviewedAt: 'now' },
  } as Run;
  f.store.put('run', run.id, run);
  f.learning.trial(run);
  f.learning.result(
    a.learning.attemptId,
    { runId: run.id, artifactId: 'a' },
    'file remains after failure',
  );
  assert.equal(f.learning.status().status, 'active');
  f.store.put('run', run.id, { ...run, state: 'SUCCEEDED' });
  f.learning.result(a.learning.attemptId, { runId: run.id, artifactId: 'a' }, '  ');
  assert.equal(f.learning.status().status, 'active');
  const b = f.start('restart');
  f.learning.result(a.learning.attemptId, { runId: run.id, artifactId: 'a' }, 'late');
  assert.deepEqual(f.learning.status().achieved, {});
  assert.equal(f.learning.status().taskId, b.detail.task.id);
  assert.equal(f.store.count('run'), 1);
});
