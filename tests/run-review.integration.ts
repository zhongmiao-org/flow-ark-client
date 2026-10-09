import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Runtime } from '../src/host/runtime';
import type { Flow, Run } from '../src/shared/types';
import type { EmbeddedReview, RunReviewPreview } from '../src/shared/run-review';

const base = (id = 'reviewed'): Flow => ({
  id,
  name: '虚构检查流程',
  formatVersion: '1.0',
  description: '',
  parameters: {},
  requiredCapabilities: [],
  steps: [{ id: 'value', type: 'value', version: 1, value: 'fixed' }],
});
const args = (p: RunReviewPreview) => ({
  id: p.flow.id,
  debug: p.debug,
  token: p.token!,
  requestId: randomUUID(),
  reviewed: true,
});
const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};
async function until(check: () => boolean, label = '等待运行状态') {
  const deadline = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(label);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
async function fixture(t: TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'flowark-review-runtime-'))),
    key = randomBytes(32);
  let credentialGate:
    | { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> }
    | undefined;
  const state = {
    browserCalls: 0,
    embedded: {
      resourceId: 'fictional-web',
      documentRevision: 1,
      started: true,
      loading: false,
      url: 'https://example.test',
      title: 'Fixture',
    } as EmbeddedReview,
  };
  const open = () =>
    new Runtime(directory, resolve('dist'), process.execPath, Buffer.from(key), async (method) => {
      if (method === 'credentials.list') {
        const gate = credentialGate;
        credentialGate = undefined;
        if (gate) {
          gate.entered.release();
          await gate.release.promise;
        }
        return ['fixture-key'];
      }
      if (method === 'browser.embedded.binding')
        return {
          id: 'embedded',
          product: 'embedded',
          executable: '/fictional/embedded',
          version: '1',
        };
      if (method === 'browser.embedded.review') return structuredClone(state.embedded);
      if (method === 'notification' || method === 'browser.embedded.pick.cancel') return true;
      state.browserCalls++;
      throw new Error('夹具不允许此系统操作：' + method);
    });
  let runtime = open();
  await runtime.ready;
  t.after(async () => {
    await runtime.shutdown();
    runtime.store.close();
    key.fill(0);
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    state,
    get runtime() {
      return runtime;
    },
    gate() {
      const gate = { entered: deferred(), release: deferred() };
      credentialGate = gate;
      return gate;
    },
    async reopen() {
      await runtime.shutdown();
      runtime.store.close();
      runtime = open();
      await runtime.ready;
    },
  };
}
const preview = (runtime: Runtime, id: string, debug = false): Promise<RunReviewPreview> =>
  runtime.request('flow.run.preview', { id, debug });
async function completed(runtime: Runtime, run: Run, expected = 'SUCCEEDED') {
  await until(
    () =>
      ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(
        runtime.store.get<Run>('run', run.id)?.state ?? '',
      ) && (runtime as any).active?.id !== run.id,
  );
  const detail = await runtime.request('run.detail', { id: run.id });
  assert.equal(detail.run.state, expected, detail.run.error);
  return detail;
}
async function blocker(runtime: Runtime) {
  const flow = base('blocker');
  flow.steps = [{ id: 'hold', type: 'human', version: 1, message: '隔离测试占用执行槽' }];
  runtime.saveFlow(flow, { files: {}, credentials: [] });
  const run = await runtime.enqueue(flow.id);
  await until(() => runtime.store.get<Run>('run', run.id)?.state === 'WAITING_INPUT');
  return run;
}

test('confirmed fixed snapshot executes real file work once; concurrent repeats and reopening return the same Run', async (t) => {
  const f = await fixture(t),
    runtime = f.runtime,
    directory = join(f.directory, 'files');
  await mkdir(directory);
  const flow = base();
  flow.steps = [
    {
      id: 'write',
      type: 'file',
      version: 1,
      operation: 'write',
      binding: 'work',
      name: 'result.txt',
      content: 'reviewed output',
    },
  ];
  runtime.saveFlow(flow, { files: { work: directory }, credentials: [] });
  const p = await preview(runtime, flow.id);
  assert.equal(p.ready, true);
  assert.equal(runtime.store.list('run').length, 0);
  assert.equal(runtime.store.list('version').length, 0);
  const input = args(p),
    results: Run[] = await Promise.all(
      Array.from({ length: 8 }, () => runtime.request('flow.run.confirm', input)),
    );
  assert.equal(new Set(results.map((r) => r.id)).size, 1);
  await completed(runtime, results[0]);
  assert.equal(await readFile(join(directory, 'result.txt'), 'utf8'), 'reviewed output');
  assert.equal(runtime.store.list('run').length, 1);
  assert.equal(runtime.store.list('flow-run-request').length, 1);
  await runtime.request('system.suspend');
  assert.equal((await runtime.request('flow.run.confirm', input)).id, results[0].id);
  await runtime.request('system.resume');
  await f.reopen();
  assert.equal((await f.runtime.request('flow.run.confirm', input)).id, results[0].id);
  assert.equal(f.runtime.store.list('run').length, 1);
  assert.match((await f.runtime.request('flow.run.confirm', args(p))).message, /过期/);
});

test('queued fixed body survives later editing; debug runs still wait for explicit step control', async (t) => {
  const { runtime } = await fixture(t),
    hold = await blocker(runtime),
    flow = base();
  runtime.saveFlow(flow, { files: {}, credentials: [] });
  const p = await preview(runtime, flow.id, true),
    reviewed = await runtime.request('flow.run.confirm', args(p));
  flow.steps = [{ id: 'value', type: 'value', version: 1, value: 'unreviewed edit' }];
  runtime.saveFlow(flow, { files: {}, credentials: [] });
  await runtime.control(hold.id, 'cancel');
  await until(() => runtime.store.get<Run>('run', reviewed.id)?.state === 'PAUSED');
  assert.equal(runtime.store.get('output', reviewed.id), undefined);
  await runtime.control(reviewed.id, 'resume');
  const detail = await completed(runtime, reviewed);
  assert.equal(detail.output.value, 'fixed');
});

test('queued browser identity or same-path directory replacement stops the Run before any action', async (t) => {
  for (const target of ['browser', 'directory'] as const) {
    const f = await fixture(t),
      runtime = f.runtime,
      hold = await blocker(runtime),
      flow = base(target);
    let directory = '';
    if (target === 'browser') {
      flow.steps = [
        {
          id: 'read',
          type: 'browser',
          version: 1,
          operation: 'read',
          selector: 'body',
          value: null,
        },
      ];
      await runtime.request('browser.embedded.enable');
      runtime.saveFlow(flow, { files: {}, credentials: [], browserId: 'embedded' });
    } else {
      directory = join(f.directory, 'work');
      await mkdir(directory);
      flow.steps = [
        {
          id: 'write',
          type: 'file',
          version: 1,
          operation: 'write',
          binding: 'work',
          name: 'never.txt',
          content: 'must not write',
        },
      ];
      runtime.saveFlow(flow, { files: { work: directory }, credentials: [] });
    }
    const p = await preview(runtime, flow.id);
    assert.equal(p.ready, true, p.checks[0]?.detail);
    const run = await runtime.request('flow.run.confirm', args(p));
    if (target === 'browser') f.state.embedded.documentRevision++;
    else {
      await rename(directory, directory + '-old');
      await mkdir(directory);
    }
    await runtime.control(hold.id, 'cancel');
    const detail = await completed(runtime, run, 'FAILED');
    assert.match(detail.run.error, /资源或网页/);
    assert.equal(f.state.browserCalls, 0);
    if (directory) await assert.rejects(readFile(join(directory, 'never.txt')), /ENOENT/);
  }
});

test('suspend invalidates an in-flight confirmation and a second FIFO admission that was waiting behind it', async (t) => {
  const f = await fixture(t),
    runtime = f.runtime,
    first = base('first'),
    second = base('second');
  for (const flow of [first, second])
    runtime.saveFlow(flow, { files: {}, credentials: ['fixture-key'] });
  const p1 = await preview(runtime, first.id),
    p2 = await preview(runtime, second.id),
    gate = f.gate();
  const pending = runtime.request('flow.run.confirm', args(p1));
  await gate.entered.promise;
  const later = runtime.request('flow.run.confirm', args(p2));
  await runtime.request('system.suspend');
  await runtime.request('system.resume');
  gate.release.release();
  assert.equal((await pending).rejected, true);
  assert.equal((await later).rejected, true);
  assert.equal(runtime.store.list('run').length, 0);
  const fresh = await preview(runtime, second.id),
    run = await runtime.request('flow.run.confirm', args(fresh));
  await completed(runtime, run);
});

test('execution checks resources again after asynchronous preflight before invoking Worker actions', async (t) => {
  const f = await fixture(t),
    runtime = f.runtime,
    hold = await blocker(runtime),
    flow = base('web');
  flow.steps = [
    { id: 'read', type: 'browser', version: 1, operation: 'read', selector: 'body', value: null },
  ];
  await runtime.request('browser.embedded.enable');
  runtime.saveFlow(flow, { files: {}, credentials: ['fixture-key'], browserId: 'embedded' });
  const p = await preview(runtime, flow.id),
    run = await runtime.request('flow.run.confirm', args(p)),
    gate = f.gate();
  await runtime.control(hold.id, 'cancel');
  await gate.entered.promise;
  f.state.embedded.documentRevision++;
  gate.release.release();
  const detail = await completed(runtime, run, 'FAILED');
  assert.match(detail.run.error, /资源或网页/);
  assert.equal(f.state.browserCalls, 0);
});

test('artifact preview reads an actual Worker copy and withholds bytes when its record is cleared during reading', async (t) => {
  const { runtime, directory } = await fixture(t);
  const flow = base('preview-file');
  flow.requiredCapabilities = ['file'];
  flow.steps = [
    {
      id: 'write',
      type: 'file',
      version: 1,
      operation: 'write',
      binding: 'work',
      name: 'preview.txt',
      content: 'result sk-private-test',
    },
  ];
  runtime.saveFlow(flow, { files: { work: directory }, credentials: [] });
  const run = await runtime.request('flow.run.confirm', args(await preview(runtime, flow.id)));
  await completed(runtime, run);
  const artifact = (await runtime.request('run.detail', { id: run.id })).artifacts[0];
  const result = await runtime.request('artifact.preview', { id: artifact.artifactId });
  assert.equal(result.status, 'text');
  assert.equal(result.text, 'result [REDACTED]');
  assert.equal(runtime.store.list('run').length, 1);
  const adapter = (runtime as any).artifactFiles;
  const original = adapter.preview.bind(adapter);
  t.mock.method(adapter, 'preview', async (item: any) => {
    const result = await original(item);
    runtime.store.put('artifact', artifact.artifactId, {
      ...runtime.store.get<any>('artifact', artifact.artifactId),
      clearedAt: new Date().toISOString(),
    });
    return result;
  });
  const changed = await runtime.request('artifact.preview', { id: artifact.artifactId });
  assert.equal(changed.status, 'unavailable');
  assert.ok(!('text' in changed));
  assert.equal(runtime.store.list('run').length, 1);
});
