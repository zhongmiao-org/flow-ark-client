import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Runtime } from '../src/host/runtime';
import type { Flow, FlowRecord, Run } from '../src/shared/types';

// Real Store, admission, snapshots, queue and Worker. Main page metadata is an
// explicit fixture; native webpage operations are covered by the UI smoke.
async function until(check: () => boolean | Promise<boolean>) {
  const end = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('worker did not settle');
    await new Promise((r) => setTimeout(r, 20));
  }
}
async function fixture(t: TestContext, wait: boolean) {
  const data = await mkdtemp(join(tmpdir(), 'flowark-web-worker-'));
  const output = join(data, 'output');
  await mkdir(output);
  const page = {
    started: true,
    loading: false,
    resourceId: 'fixture-resource',
    documentRevision: 1,
    url: 'https://example.com/selected',
    title: 'fixture',
  };
  const control = {
    credentialGate: undefined as Promise<string[]> | undefined,
    credentialReads: 0,
  };
  const runtime = new Runtime(
    data,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async (method) => {
      if (method === 'browser.embedded.review') return structuredClone(page);
      if (method === 'credentials.list') {
        control.credentialReads++;
        return control.credentialGate ?? [];
      }
      if (method === 'notification' || method === 'browser.embedded.pick.cancel') return true;
      throw new Error('unexpected fixture system: ' + method);
    },
  );
  t.after(async () => {
    await runtime.shutdown();
    runtime.store.close();
    await rm(data, { recursive: true, force: true });
  });
  const call = (method: string, args: any = {}): Promise<any> => runtime.request(method, args);
  const task = (await call('task.create')).task;
  const identity = { id: task.id, revision: task.revision };
  const preview = await call('task.web.preview', identity);
  const selected = await call('task.web.select', { ...identity, token: preview.token });
  const flow: Flow = {
    id: task.flowId,
    formatVersion: '1.0',
    name: 'source-bound fixture',
    description: '',
    parameters: {},
    requiredCapabilities: ['file-create-v1'],
    steps: [
      ...(wait
        ? [{ id: 'wait', type: 'human' as const, version: 1 as const, message: 'fixture wait' }]
        : []),
      {
        id: 'save',
        type: 'file',
        version: 3,
        operation: 'create',
        binding: 'output',
        name: 'selected.txt',
        content: 'selected source output',
      },
    ],
  };
  const record = runtime.saveFlow(flow, {
    browserId: 'embedded',
    files: { output },
    credentials: [],
  });
  // Seed the host-owned adopted marker; adoption itself is covered by Planning and UI tests.
  runtime.store.put('flow', record.id, { ...record, webTarget: selected.task.webTarget });
  return { runtime, call, page, flow, output, selected, control };
}

test('selected source is checked at real Worker boundaries, including file-only nodes, and external refresh blocks the next output', async (t) => {
  const f = await fixture(t, true);
  const run = await f.runtime.enqueue(f.flow.id);
  await until(() => f.runtime.store.get<Run>('run', run.id)?.state === 'WAITING_INPUT');
  const snapshot = f.runtime.store.get<FlowRecord>('snapshot', run.id)!;
  assert.ok(snapshot.webTarget);
  const edited = f.runtime.saveFlow({ ...f.flow, name: 'manual edit' }, snapshot.bindings);
  assert.deepEqual(edited.webTarget, snapshot.webTarget, 'manual save must retain the host source');
  f.page.documentRevision++;
  await f.runtime.control(run.id, 'resume');
  await until(() => f.runtime.store.get<Run>('run', run.id)?.state === 'FAILED');
  assert.match(f.runtime.store.get<Run>('run', run.id)!.error!, /刷新|切换/);
  await assert.rejects(access(join(f.output, 'selected.txt')));
  assert.ok(
    !f.runtime.store
      .events(run.id)
      .some((e) => e.type === 'node-start' && e.nodeInstance === 'save'),
  );
  assert.deepEqual(f.runtime.store.get('snapshot', run.id), snapshot);
  const count = f.runtime.store.count('run');
  await assert.rejects(f.call('flow.run', { id: f.flow.id }), /刷新|切换/);
  await assert.rejects(
    f.call('schedule.save', { flowId: f.flow.id, intervalMinutes: 1, timezone: 'UTC' }),
    /刷新|切换/,
  );
  await assert.rejects(
    f.call('run.rerun.preview', { id: run.id, mode: 'snapshot', debug: false }),
    /刷新|切换/,
  );
  assert.equal(f.runtime.store.count('run'), count);
});

test('real output is created only for a current selection; reselecting invalidates an earlier run review and historical snapshot', async (t) => {
  const f = await fixture(t, false);
  const review = await f.call('flow.run.preview', { id: f.flow.id });
  assert.equal(review.ready, true, JSON.stringify(review.checks));
  const run = await f.call('flow.run.confirm', {
    id: f.flow.id,
    token: review.token,
    requestId: randomUUID(),
    reviewed: true,
  });
  await until(() =>
    ['SUCCEEDED', 'FAILED'].includes(f.runtime.store.get<Run>('run', run.id)!.state),
  );
  assert.equal(f.runtime.store.get<Run>('run', run.id)!.state, 'SUCCEEDED');
  assert.equal(await readFile(join(f.output, 'selected.txt'), 'utf8'), 'selected source output');
  await until(async () => !(await f.call('bootstrap')).execution.active);
  const validRerun = await f.call('run.rerun.preview', {
    id: run.id,
    mode: 'snapshot',
    debug: false,
  });
  assert.equal(validRerun.flow.versionId, run.versionId);
  const preview = await f.call('flow.run.preview', { id: f.flow.id });
  const identity = { id: f.selected.task.id, revision: f.selected.task.revision };
  const target = await f.call('task.web.preview', identity);
  await f.call('task.web.select', { ...identity, token: target.token });
  const rejected = await f.call('flow.run.confirm', {
    id: f.flow.id,
    token: preview.token,
    requestId: randomUUID(),
    reviewed: true,
  });
  assert.equal(rejected.rejected, true);
  await assert.rejects(f.call('flow.run', { id: f.flow.id }), /撤销|更换/);
  await assert.rejects(
    f.call('run.rerun.preview', { id: run.id, mode: 'snapshot', debug: false }),
    /撤销|更换/,
  );
  assert.equal(f.runtime.store.count('run'), 1);
  assert.equal(await readFile(join(f.output, 'selected.txt'), 'utf8'), 'selected source output');
});

test('refresh during credential preflight prevents admission and queued runs recheck their fixed source on dispatch', async (t) => {
  const f = await fixture(t, true);
  const record = f.runtime.store.get<FlowRecord>('flow', f.flow.id)!;
  f.runtime.saveFlow(record.flow, { ...record.bindings, credentials: ['fixture'] });
  let release!: (value: string[]) => void;
  f.control.credentialGate = new Promise<string[]>((r) => {
    release = r;
  });
  const count = f.control.credentialReads;
  const pending = f.runtime.enqueue(f.flow.id);
  await until(() => f.control.credentialReads > count);
  f.page.documentRevision++;
  release(['fixture']);
  await assert.rejects(pending, /刷新|切换/);
  assert.equal(f.runtime.store.count('run'), 0);
  f.page.documentRevision--;
  f.runtime.saveFlow(record.flow, record.bindings);
  const first = await f.runtime.enqueue(f.flow.id);
  await until(() => f.runtime.store.get<Run>('run', first.id)?.state === 'WAITING_INPUT');
  const queued = await f.runtime.enqueue(f.flow.id);
  assert.equal(f.runtime.store.get<Run>('run', queued.id)?.state, 'QUEUED');
  f.page.documentRevision++;
  await f.runtime.control(first.id, 'resume');
  await until(() => f.runtime.store.get<Run>('run', queued.id)?.state === 'FAILED');
  assert.equal(f.runtime.store.get<Run>('run', first.id)?.state, 'FAILED');
  assert.ok(!f.runtime.store.events(queued.id).some((e) => e.type === 'node-start'));
  await assert.rejects(access(join(f.output, 'selected.txt')));
});
