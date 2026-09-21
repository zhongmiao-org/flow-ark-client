import test from 'node:test';
import assert from 'node:assert/strict';
import { RunReviewSession } from '../src/renderer/run-review-session';
import type { RunReviewPreview } from '../src/shared/run-review';
import type { Run } from '../src/shared/types';
const selection = { id: 'flow', task: { id: 'task', revision: 1 } };
const preview = (id = 'flow', debug = false): RunReviewPreview => ({
  ready: true,
  token: 'a'.repeat(64),
  debug,
  flow: {
    id,
    name: 'Fixture',
    stepCount: 1,
    parameterNames: [],
    capabilities: ['value'],
    scriptBundles: [],
  },
  resources: [],
  effects: [],
  checks: [],
  limitations: [],
});
const run: Run = {
  id: 'run-1',
  flowId: 'flow',
  name: 'Fixture',
  versionId: 'a'.repeat(64),
  state: 'QUEUED',
  createdAt: '2026-09-21T00:00:00Z',
  updatedAt: '2026-09-21T00:00:00Z',
  source: 'manual',
  business: '',
};
function defer<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture() {
  const calls: { method: string; args: any }[] = [],
    opened: any[] = [];
  let count = 0;
  const response = {
    call: async (method: string, args: any): Promise<any> =>
      method === 'flow.run.preview'
        ? preview(args.id, args.debug)
        : method === 'flow.run.confirm'
          ? run
          : { run },
  };
  const session = new RunReviewSession(
    async (method, args) => {
      calls.push({ method, args });
      return response.call(method, args);
    },
    (detail) => opened.push(detail),
    () => `request-${++count}`,
  );
  return { session, calls, opened, response };
}
async function enter(f: ReturnType<typeof fixture>) {
  f.session.enter(selection, 'first');
  await settle();
}

test('leaving clears review and a late preview cannot reopen or populate a new page', async () => {
  const f = fixture(),
    delayed = defer<RunReviewPreview>();
  f.response.call = async () => delayed.promise;
  f.session.enter(selection, 'first');
  f.session.leave();
  delayed.resolve(preview());
  await settle();
  assert.equal(f.session.snapshot().active, false);
  assert.equal(f.session.snapshot().preview, undefined);
  assert.equal(f.session.snapshot().reviewed, false);
  assert.equal(f.calls.length, 1);
});

test('source changes and debug mode changes clear checked approval; stale preview replies cannot win', async () => {
  const f = fixture();
  await enter(f);
  f.session.setReviewed(true);
  const old = defer<RunReviewPreview>();
  let index = 0;
  f.response.call = async (_, args) => (++index === 1 ? old.promise : preview(args.id, args.debug));
  const pending = f.session.refresh(true);
  f.session.enter({ ...selection, task: { id: 'task', revision: 2 } }, 'new');
  await settle();
  old.resolve(preview('flow', true));
  await pending;
  assert.equal(f.session.snapshot().selection?.task?.revision, 2);
  assert.equal(f.session.snapshot().preview?.debug, false);
  assert.equal(f.session.snapshot().reviewed, false);
  await f.session.confirm();
  assert.equal(f.calls.filter((c) => c.method === 'flow.run.confirm').length, 0);
});

test('confirm requires a checked ready preview, uses one request while pending and opens only its Run', async () => {
  const f = fixture();
  await enter(f);
  await f.session.confirm();
  assert.equal(f.calls.length, 1);
  const pending = defer<Run>();
  f.response.call = async (method) => (method === 'flow.run.confirm' ? pending.promise : { run });
  f.session.setReviewed(true);
  const started = f.session.confirm();
  await f.session.confirm();
  assert.equal(f.calls.filter((c) => c.method === 'flow.run.confirm').length, 1);
  pending.resolve(run);
  await started;
  assert.equal(f.opened[0].run.id, run.id);
  assert.equal(f.session.snapshot().attempt?.phase, 'created');
});

test('a lost confirmation reply retains the exact input and UUID; query creates no new confirmation identity', async () => {
  const f = fixture();
  await enter(f);
  let count = 0;
  f.response.call = async (method) => {
    if (method !== 'flow.run.confirm') return { run };
    if (++count === 1) throw new Error('lost reply after commit');
    return run;
  };
  f.session.setReviewed(true);
  await f.session.confirm();
  assert.equal(f.session.snapshot().attempt?.phase, 'unknown');
  await f.session.refresh();
  assert.equal(f.calls.length, 2);
  f.session.leave();
  f.session.enter(selection, 'changed elsewhere');
  await f.session.confirm();
  const confirmations = f.calls.filter((c) => c.method === 'flow.run.confirm');
  assert.equal(confirmations.length, 2);
  assert.deepEqual(confirmations[0].args, confirmations[1].args);
  assert.equal(f.opened.length, 1);
});

test('a late successful confirmation is retained without stealing navigation, including a different active task', async () => {
  const f = fixture();
  await enter(f);
  const pending = defer<Run>();
  f.response.call = async (method, args) =>
    method === 'flow.run.confirm' ? pending.promise : preview(args.id);
  f.session.setReviewed(true);
  const started = f.session.confirm();
  f.session.leave();
  f.session.enter({ id: 'other' }, 'other');
  pending.resolve(run);
  await started;
  assert.equal(f.opened.length, 0);
  assert.equal(f.session.snapshot().attempt, undefined);
  f.session.enter(selection, 'first');
  assert.equal(f.session.snapshot().attempt?.run?.id, run.id);
  assert.equal(f.opened.length, 0);
});

test('detail failure keeps the created Run and retries only detail; a late detail cannot reopen the old page', async () => {
  const f = fixture();
  await enter(f);
  f.response.call = async (method) => {
    if (method === 'flow.run.confirm') return run;
    throw new Error('detail offline');
  };
  f.session.setReviewed(true);
  await f.session.confirm();
  assert.equal(f.session.snapshot().attempt?.run?.id, run.id);
  assert.match(f.session.snapshot().error, /运行已创建/);
  const pending = defer<any>();
  f.response.call = async () => pending.promise;
  const opening = f.session.open();
  f.session.leave();
  pending.resolve({ run });
  await opening;
  assert.equal(f.opened.length, 0);
  assert.equal(f.calls.filter((c) => c.method === 'flow.run.confirm').length, 1);
});

test('only an explicit rejection permits a fresh preview and confirmation ID; malformed replies remain unknown', async () => {
  const f = fixture();
  await enter(f);
  f.response.call = async (method) =>
    method === 'flow.run.confirm' ? { rejected: true, message: 'changed resources' } : preview();
  f.session.setReviewed(true);
  await f.session.confirm();
  assert.equal(f.session.snapshot().attempt?.phase, 'rejected');
  await f.session.refresh();
  f.response.call = async () => undefined;
  f.session.setReviewed(true);
  await f.session.confirm();
  assert.equal(f.session.snapshot().attempt?.phase, 'unknown');
  const confirmations = f.calls.filter((c) => c.method === 'flow.run.confirm');
  assert.notEqual(confirmations[0].args.requestId, confirmations[1].args.requestId);
});
