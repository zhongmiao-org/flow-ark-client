import {readArchive} from '../src/templates/archive';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Runtime } from '../src/host/runtime';
import type { Bindings, Flow, FlowRecord, Run, Step } from '../src/shared/types';
import type { RunRerunConfirmInput, RunRerunMode, RunRerunPreview } from '../src/shared/run-rerun';

const base: Flow = {
  id: 'rerun-fixture',
  formatVersion: '1.0',
  name: '虚构重跑流程',
  description: '',
  parameters: {},
  requiredCapabilities: [],
  steps: [],
};
const terminal = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']);
const fixtureSecret = 'FICTIONAL_RERUN_PRIVATE_CREDENTIAL_9182';
const browser = {
  id: 'embedded',
  product: 'embedded' as const,
  version: 'fixture-1',
  executable: '/fictional/embedded-kernel',
};
const kinds = [
  'flow',
  'version',
  'snapshot',
  'run',
  'rerun-request',
  'artifact',
  'schedule',
  'action',
  'attention',
];

async function until(check: () => boolean, message = '等待真实 Worker 状态', timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function fixture(t: TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'flowark-rerun-')));
  const key = randomBytes(32);
  const open = () =>
    new Runtime(directory, resolve('dist'), process.execPath, Buffer.from(key), async (method) => {
      if (method === 'credentials.list') return ['fixture-credential', 'unrelated-credential'];
      if (method === 'credentials.get') return fixtureSecret;
      if (method === 'browser.embedded.binding') return browser;
      if (method === 'browser.embedded.pick.cancel' || method === 'notification') return true;
      throw new Error('此夹具不允许系统操作：' + method);
    });
  let runtime = open();
  t.after(async () => {
    await runtime.shutdown();
    runtime.store.close();
    key.fill(0);
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    get runtime() {
      return runtime;
    },
    async reopen() {
      await runtime.shutdown();
      runtime.store.close();
      runtime = open();
    },
  };
}

function records(runtime: Runtime) {
  return structuredClone(kinds.map((kind) => [kind, runtime.store.list(kind)]));
}

function originalEvidence(runtime: Runtime, id: string) {
  return structuredClone({
    run: runtime.store.get('run', id),
    snapshot: runtime.store.get('snapshot', id),
    output: runtime.store.get('output', id),
    events: runtime.store.events(id),
    artifacts: runtime.store.list<any>('artifact').filter((a) => a.runId === id),
  });
}

async function completed(runtime: Runtime, id: string, state = 'SUCCEEDED') {
  await until(
    () =>
      terminal.has(runtime.store.get<Run>('run', id)?.state ?? '') &&
      (runtime as any).active?.id !== id &&
      !(runtime as any).pendingCapabilities.has(id),
  );
  const detail = await runtime.request('run.detail', { id });
  assert.equal(detail.run.state, state, detail.run.error);
  return detail;
}

async function source(
  runtime: Runtime,
  flow = valueFlow(),
  bindings: Bindings = { files: {}, credentials: [] },
) {
  runtime.saveFlow(flow, bindings);
  const run = await runtime.enqueue(flow.id);
  await completed(runtime, run.id);
  return runtime.store.get<Run>('run', run.id)!;
}

function valueFlow(value: string = 'original'): Flow {
  return { ...base, steps: [{ id: 'value', type: 'value', version: 1, value }] };
}

const preview = (
  runtime: Runtime,
  id: string,
  mode: RunRerunMode = 'snapshot',
  debug = false,
): Promise<RunRerunPreview> => runtime.request('run.rerun.preview', { id, mode, debug });

function confirmation(p: RunRerunPreview, requestId = randomUUID()): RunRerunConfirmInput {
  return {
    id: p.source.id,
    mode: p.mode,
    debug: p.debug,
    token: p.token,
    requestId,
    reviewed: true,
  };
}

const confirm = (runtime: Runtime, p: RunRerunPreview): Promise<Run> =>
  runtime.request('run.rerun.confirm', confirmation(p));

function parameterBindings(directory: string, value: string): Bindings {
  return {
    files: { work: directory },
    credentials: ['fixture-credential'],
    configuration: {
      adapter: 'flow-parameters-v1',
      schema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
        additionalProperties: false,
      },
      values: { message: value },
    },
  };
}

const writeStep: Step = {
  id: 'write',
  type: 'file',
  version: 1,
  operation: 'write',
  binding: 'work',
  name: 'result.txt',
  content: { $ref: 'params.message' },
};

test('snapshot and saved reruns execute different reviewed content while previews and new runs preserve original evidence', async (t) => {
  const f = await fixture(t),
    runtime = f.runtime;
  const oldValue = 'ORIGINAL_PRIVATE_PARAMETER',
    newValue = 'SAVED_PRIVATE_PARAMETER';
  const flow: Flow = {
    ...base,
    parameters: { message: oldValue },
    steps: [
      writeStep,
      { id: 'result', type: 'value', version: 1, value: { $ref: 'params.message' } },
    ],
  };
  const old = await source(runtime, flow, parameterBindings(f.directory, oldValue));
  const oldEvidence = originalEvidence(runtime, old.id);
  const plan = await runtime.request('schedule.save', {
    flowId: flow.id,
    intervalMinutes: 60,
    timezone: 'UTC',
  });
  await runtime.request('schedule.toggle', { id: plan.id, enabled: false });
  const schedule = runtime.store.get('schedule', plan.id);
  runtime.store.put('action', 'unknown-fictional-action', {
    id: 'unknown-fictional-action',
    flowId: flow.id,
    state: 'UNKNOWN',
  });
  const action = runtime.store.get('action', 'unknown-fictional-action');
  runtime.saveFlow(
    {
      ...flow,
      name: '修改后保存的流程',
      steps: [...flow.steps, { id: 'newStep', type: 'value', version: 1, value: 'saved only' }],
    },
    parameterBindings(f.directory, newValue),
  );
  const before = records(runtime);
  const original = await preview(runtime, old.id);
  const saved = await preview(runtime, old.id, 'saved');
  assert.deepEqual(records(runtime), before, 'preview must not publish versions, runs or actions');
  assert.equal(await readFile(join(f.directory, 'result.txt'), 'utf8'), oldValue);
  assert.match(original.token, /^[a-f0-9]{64}$/);
  assert.equal(original.debug, false);
  assert.equal(original.flow.versionId, old.versionId);
  assert.equal(original.flow.stepCount, 2);
  assert.equal(saved.flow.stepCount, 3);
  assert.deepEqual(original.flow.parameterNames, ['message']);
  assert.deepEqual(original.flow.directoryBindings, ['work']);
  assert.deepEqual(original.flow.credentialRefs, ['fixture-credential']);
  for (const hidden of [f.directory, fixtureSecret, oldValue, newValue])
    assert.ok(!JSON.stringify([original, saved]).includes(hidden), hidden);
  const first = await confirm(runtime, original);
  const firstDetail = await completed(runtime, first.id);
  assert.equal(first.source, 'manual');
  assert.equal(first.scheduleId, undefined);
  assert.deepEqual(first.rerun && { runId: first.rerun.runId, mode: first.rerun.mode }, {
    runId: old.id,
    mode: 'snapshot',
  });
  assert.ok(Number.isFinite(Date.parse(first.rerun!.reviewedAt)));
  assert.equal(firstDetail.output.result, oldValue);
  assert.equal(firstDetail.output.newStep, undefined);
  const second = await confirm(runtime, saved);
  const secondDetail = await completed(runtime, second.id);
  assert.equal(secondDetail.output.result, newValue);
  assert.equal(secondDetail.output.newStep, 'saved only');
  assert.equal(await readFile(join(f.directory, 'result.txt'), 'utf8'), newValue);
  assert.equal(await readFile(oldEvidence.artifacts[0].path, 'utf8'), oldValue);
  assert.deepEqual(originalEvidence(runtime, old.id), oldEvidence);
  assert.deepEqual(runtime.store.get('schedule', plan.id), schedule);
  assert.deepEqual(runtime.store.get('action', 'unknown-fictional-action'), action);
  const relations = (await runtime.request('run.detail', { id: old.id })).rerun;
  assert.deepEqual(
    new Set(relations.derived.map((r: Run) => r.id)),
    new Set([first.id, second.id]),
  );
  assert.equal(firstDetail.rerun.source.id, old.id);
  await f.reopen();
  assert.deepEqual(originalEvidence(f.runtime, old.id), oldEvidence);
  assert.equal((await f.runtime.request('run.detail', { id: second.id })).rerun.source.id, old.id);
});

test('debug rerun pauses before the first side effect and keeps its chosen saved snapshot after subsequent edits', async (t) => {
  const f = await fixture(t),
    runtime = f.runtime;
  const flow: Flow = {
    ...base,
    parameters: { message: 'before' },
    steps: [
      writeStep,
      { id: 'later', type: 'value', version: 1, value: { $ref: 'params.message' } },
    ],
  };
  const old = await source(runtime, flow, parameterBindings(f.directory, 'before'));
  runtime.saveFlow(flow, parameterBindings(f.directory, 'reviewed'));
  const p = await preview(runtime, old.id, 'saved', true);
  const run = await confirm(runtime, p);
  await until(() => runtime.store.get<Run>('run', run.id)?.state === 'PAUSED');
  assert.equal(runtime.store.events(run.id).filter((e) => e.type === 'node-start').length, 0);
  assert.equal(await readFile(join(f.directory, 'result.txt'), 'utf8'), 'before');
  runtime.saveFlow(flow, parameterBindings(f.directory, 'edited after admission'));
  await runtime.control(run.id, 'step');
  await until(
    () =>
      runtime.store.get<Run>('run', run.id)?.state === 'PAUSED' &&
      runtime.store
        .events(run.id)
        .some((e) => e.type === 'debug-pause' && e.nodeInstance === 'later'),
  );
  assert.equal(await readFile(join(f.directory, 'result.txt'), 'utf8'), 'reviewed');
  assert.equal(runtime.store.events(run.id).filter((e) => e.type === 'node-start').length, 1);
  await runtime.control(run.id, 'resume');
  assert.equal((await completed(runtime, run.id)).output.later, 'reviewed');
});

test('same confirmation runs a real HTTP effect only once across concurrent calls, lost replies and restart', async (t) => {
  const f = await fixture(t);
  let requests = 0;
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ count: ++requests }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  );
  const flow: Flow = {
    ...base,
    steps: [
      {
        id: 'request',
        type: 'http',
        version: 1,
        method: 'POST',
        url: 'http://127.0.0.1:' + (server.address() as any).port,
        headers: {},
        body: { fictional: true },
      },
    ],
  };
  const old = await source(f.runtime, flow);
  assert.equal(requests, 1);
  const p = await preview(f.runtime, old.id),
    args = confirmation(p);
  const preflight = f.runtime.preflight.bind(f.runtime);
  let entered = false,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.runtime.preflight = async (record) => {
    if (!entered) {
      entered = true;
      await gate;
    }
    return preflight(record);
  };
  let a: Run, b: Run;
  try {
    // Start with a fresh requestId and overlap confirmations before the first
    // admission can publish its idempotency record. Discard that first reply.
    const lostReply = f.runtime.request('run.rerun.confirm', args).then(() => undefined);
    await until(() => entered, '首次确认没有进入预检');
    const second = f.runtime.request('run.rerun.confirm', args);
    const third = f.runtime.request('run.rerun.confirm', args);
    assert.equal(f.runtime.store.get('rerun-request', args.requestId), undefined);
    assert.equal(f.runtime.store.list('run').length, 1);
    release();
    const results = await Promise.all([lostReply, second, third]);
    a = results[1];
    b = results[2];
  } finally {
    release();
    f.runtime.preflight = preflight;
  }
  assert.equal(a.id, b.id);
  assert.equal((await completed(f.runtime, a.id)).output.request.count, 2);
  assert.equal(requests, 2);
  assert.equal(f.runtime.store.list('run').length, 2);
  assert.equal(f.runtime.store.list('rerun-request').length, 1);
  assert.equal(
    f.runtime.store.events(a.id).filter((e) => e.type === 'state' && e.data.state === 'QUEUED')
      .length,
    1,
  );
  for (const change of [
    { debug: true },
    { mode: 'saved' },
    { token: '0'.repeat(64) },
    { id: a.id },
  ])
    await assert.rejects(f.runtime.request('run.rerun.confirm', { ...args, ...change }));
  await f.reopen();
  const afterRestart = await f.runtime.request('run.rerun.confirm', args);
  assert.equal(afterRestart.id, a.id);
  assert.equal(f.runtime.store.list('run').length, 2);
  assert.equal(requests, 2);
});

test('rerun rejects invalid host input and stale previews after saved content, bindings or browser identity change', async (t) => {
  const f = await fixture(t),
    runtime = f.runtime;
  const otherDirectory = join(f.directory, 'other');
  await mkdir(otherDirectory);
  runtime.store.put('browser', browser.id, browser);
  const flow = valueFlow();
  const bindings: Bindings = {
    files: { work: f.directory },
    credentials: ['fixture-credential'],
    browserId: browser.id,
  };
  const old = await source(runtime, flow, bindings);
  for (const change of [
    { reviewed: false },
    { reviewed: undefined },
    { requestId: 'invalid' },
    { token: 'x' },
    { mode: 'resume' },
    { parameters: {} },
  ]) {
    const p = await preview(runtime, old.id);
    const before = records(runtime);
    await assert.rejects(runtime.request('run.rerun.confirm', { ...confirmation(p), ...change }));
    assert.deepEqual(records(runtime), before);
  }
  for (const scenario of [
    'content',
    'directory',
    'credential',
    'browser',
    'debug',
    'mode',
  ] as const) {
    runtime.saveFlow(flow, bindings);
    runtime.store.put('browser', browser.id, browser);
    const p = await preview(runtime, old.id),
      args = confirmation(p);
    if (scenario === 'content') runtime.saveFlow(valueFlow('changed'), bindings);
    if (scenario === 'directory')
      runtime.saveFlow(flow, { ...bindings, files: { work: otherDirectory } });
    if (scenario === 'credential') runtime.saveFlow(flow, { ...bindings, credentials: [] });
    if (scenario === 'browser')
      runtime.store.put('browser', browser.id, { ...browser, version: 'fixture-2' });
    if (scenario === 'debug') args.debug = true;
    if (scenario === 'mode') args.mode = 'saved';
    const before = records(runtime);
    await assert.rejects(runtime.request('run.rerun.confirm', args), scenario);
    assert.deepEqual(records(runtime), before, scenario);
  }
});

test('snapshot rerun retains current authorization without inheriting unrelated additions or resurrecting replaced grants', async (t) => {
  const f = await fixture(t),
    runtime = f.runtime;
  const flow = valueFlow();
  runtime.store.put('browser', browser.id, browser);
  const bindings: Bindings = {
    browserId: browser.id,
    files: { work: f.directory },
    credentials: ['fixture-credential'],
    scriptPackages: { 'fixture-package': { path: join(f.directory, 'package'), version: '1.0.0' } },
  };
  const old = await source(runtime, flow, bindings);
  const replacements: Bindings[] = [
    { ...bindings, browserId: undefined },
    { ...bindings, browserId: 'replacement' },
    { ...bindings, files: {} },
    { ...bindings, files: { work: join(f.directory, 'replacement') } },
    { ...bindings, credentials: [] },
    { ...bindings, scriptPackages: {} },
    {
      ...bindings,
      scriptPackages: {
        'fixture-package': { path: join(f.directory, 'replacement'), version: '1.0.0' },
      },
    },
  ];
  for (const changed of replacements) {
    runtime.saveFlow(flow, changed);
    const before = records(runtime);
    await assert.rejects(preview(runtime, old.id));
    assert.deepEqual(records(runtime), before);
  }
  runtime.saveFlow(flow, {
    ...bindings,
    files: { ...bindings.files, extra: f.directory },
    credentials: [...bindings.credentials, 'unrelated-credential'],
    scriptPackages: {
      ...bindings.scriptPackages,
      unrelated: { path: f.directory, version: '1.0.0' },
    },
  });
  const next = await confirm(runtime, await preview(runtime, old.id));
  await completed(runtime, next.id);
  assert.deepEqual(runtime.store.get<FlowRecord>('snapshot', next.id)!.bindings, bindings);
  const grants = { write: 'auto' as const };
  const policyFlow = { ...flow, id: 'policy-only-fixture' };
  const policyRun = await source(runtime, policyFlow, { files: {}, credentials: [], grants });
  runtime.saveFlow(policyFlow, {
    files: {},
    credentials: [],
    grants: {write:'deny'},
  });
  await assert.rejects(preview(runtime, policyRun.id));
});

test('confirmation rechecks after asynchronous preflight and does not admit work during suspend or shutdown', async (t) => {
  const f = await fixture(t),
    runtime = f.runtime;
  const old = await source(runtime);
  const preflight = runtime.preflight.bind(runtime);
  for (const scenario of ['saved-content', 'authorization', 'suspend', 'shutdown'] as const) {
    runtime.saveFlow(valueFlow(), { files: {}, credentials: ['fixture-credential'] });
    const p = await preview(runtime, old.id, 'saved');
    let entered = false,
      release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    runtime.preflight = async (record) => {
      entered = true;
      await gate;
      return preflight(record);
    };
    t.after(() => release());
    const pending = runtime.request('run.rerun.confirm', confirmation(p));
    const rejected = assert.rejects(pending);
    await until(() => entered, '确认没有进入异步预检');
    if (scenario === 'saved-content')
      runtime.saveFlow(valueFlow('changed during preflight'), {
        files: {},
        credentials: ['fixture-credential'],
      });
    if (scenario === 'authorization') runtime.saveFlow(valueFlow(), { files: {}, credentials: [] });
    if (scenario === 'suspend') await runtime.request('system.suspend');
    if (scenario === 'shutdown') await runtime.shutdown();
    const before = records(runtime);
    release();
    await rejected;
    runtime.preflight = preflight;
    assert.deepEqual(records(runtime), before, scenario);
    if (scenario === 'suspend') await runtime.request('system.resume');
  }
});

test('queued reruns recheck authorization before executing and share FIFO admission with ordinary manual runs', async (t) => {
  const f = await fixture(t),
    runtime = f.runtime;
  const flow: Flow = { ...base, parameters: { message: 'initial' }, steps: [writeStep] };
  const bindings = parameterBindings(f.directory, 'initial');
  const old = await source(runtime, flow, bindings);
  runtime.saveFlow(
    {
      ...base,
      id: 'blocker',
      steps: [{ id: 'human', type: 'human', version: 1, message: 'hold the only slot' }],
    },
    { files: {}, credentials: [] },
  );
  const blocker = await runtime.enqueue('blocker');
  await until(() => runtime.store.get<Run>('run', blocker.id)?.state === 'WAITING_INPUT');
  runtime.saveFlow(flow, parameterBindings(f.directory, 'must-not-write'));
  runtime.saveFlow(
    { ...valueFlow('after rerun'), id: 'following' },
    { files: {}, credentials: [] },
  );
  const p = await preview(runtime, old.id, 'saved');
  const preflight = runtime.preflight.bind(runtime);
  let entered = false,
    ordinaryPreflight = false,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  runtime.preflight = async (record) => {
    if (record.id === flow.id && !entered) {
      entered = true;
      await gate;
    }
    if (record.id === 'following') ordinaryPreflight = true;
    return preflight(record);
  };
  let queued: Run, following: Run;
  try {
    const firstAdmission = confirm(runtime, p);
    await until(() => entered, '重跑确认没有进入预检');
    const nextAdmission = runtime.enqueue('following');
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(
      ordinaryPreflight,
      false,
      'ordinary admission must wait behind the rerun preflight',
    );
    assert.equal(
      runtime.store.list('run').length,
      2,
      'neither pending admission may publish early',
    );
    release();
    [queued, following] = await Promise.all([firstAdmission, nextAdmission]);
  } finally {
    release();
    runtime.preflight = preflight;
  }
  assert.equal(runtime.store.get<Run>('run', queued.id)?.state, 'QUEUED');
  assert.equal(runtime.store.get<Run>('run', following.id)?.state, 'QUEUED');
  assert.ok(
    runtime.store.list<Run>('run').findIndex((r) => r.id === queued.id) <
      runtime.store.list<Run>('run').findIndex((r) => r.id === following.id),
  );
  runtime.saveFlow(flow, { ...parameterBindings(f.directory, 'must-not-write'), credentials: [] });
  await runtime.control(blocker.id, 'resume');
  await completed(runtime, blocker.id);
  await completed(runtime, queued.id, 'FAILED');
  await completed(runtime, following.id);
  assert.equal(runtime.store.events(queued.id).filter((e) => e.type === 'node-start').length, 0);
  assert.equal(await readFile(join(f.directory, 'result.txt'), 'utf8'), 'initial');
});

test('all terminal source states allow a fresh run while running and human-waiting sources remain unavailable', async (t) => {
  const f = await fixture(t),
    runtime = f.runtime;
  const succeeded = await source(runtime);
  const good = valueFlow('fresh saved result');
  const sources = [succeeded];
  runtime.saveFlow(
    {
      ...base,
      id: 'failure',
      steps: [
        {
          id: 'bad',
          type: 'assert',
          version: 1,
          actual: false,
          operator: 'equals',
          expected: true,
        },
      ],
    },
    { files: {}, credentials: [] },
  );
  const failed = await runtime.enqueue('failure');
  await completed(runtime, failed.id, 'FAILED');
  sources.push(runtime.store.get('run', failed.id)!);
  for (const state of ['CANCELLED', 'INTERRUPTED']) {
    const id = state.toLowerCase();
    runtime.saveFlow(
      { ...base, id, steps: [{ id: 'wait', type: 'human', version: 1, message: 'hold' }] },
      { files: {}, credentials: [] },
    );
    const run = await runtime.enqueue(id);
    await until(() => runtime.store.get<Run>('run', run.id)?.state === 'WAITING_INPUT');
    await assert.rejects(preview(runtime, run.id));
    assert.equal((await runtime.request('run.detail', { id: run.id })).rerun.available, false);
    if (state === 'CANCELLED') await runtime.control(run.id, 'cancel');
    else (runtime as any).active.child.kill('SIGKILL');
    await completed(runtime, run.id, state);
    sources.push(runtime.store.get('run', run.id)!);
  }
  for (const old of sources) {
    runtime.saveFlow({ ...good, id: old.flowId }, { files: {}, credentials: [] });
    assert.equal((await runtime.request('run.detail', { id: old.id })).rerun.available, true);
    const before = originalEvidence(runtime, old.id);
    const next = await confirm(runtime, await preview(runtime, old.id, 'saved'));
    assert.equal((await completed(runtime, next.id)).output.value, 'fresh saved result');
    assert.deepEqual(originalEvidence(runtime, old.id), before);
  }
});

test('a cancelled source cannot rerun while its real artifact capability is still completing', async (t) => {
  const f = await fixture(t),
    runtime = f.runtime;
  const files = (runtime as any).artifactFiles,
    capture = files.capture.bind(files);
  let copied = false,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  t.after(() => release());
  files.capture = async (...args: any[]) => {
    const result = await capture(...args);
    copied = true;
    await gate;
    return result;
  };
  runtime.saveFlow(
    { ...base, parameters: { message: 'already written' }, steps: [writeStep] },
    parameterBindings(f.directory, 'already written'),
  );
  const old = await runtime.enqueue(base.id);
  await until(() => copied);
  await runtime.control(old.id, 'cancel');
  await until(
    () => runtime.store.get<Run>('run', old.id)?.state === 'CANCELLED' && !(runtime as any).active,
  );
  await assert.rejects(preview(runtime, old.id));
  assert.equal((await runtime.request('run.detail', { id: old.id })).rerun.available, false);
  assert.equal(runtime.store.list('run').length, 1);
  release();
  await until(() => !(runtime as any).pendingCapabilities.has(old.id));
  files.capture = capture;
  const next = await confirm(runtime, await preview(runtime, old.id));
  await completed(runtime, next.id);
  assert.equal(await readFile(join(f.directory, 'result.txt'), 'utf8'), 'already written');
});

test('rerun version, snapshot, relation, request and queued event roll back together when persistence fails', async (t) => {
  const f = await fixture(t),
    runtime = f.runtime;
  const old = await source(runtime);
  runtime.saveFlow(valueFlow('new version only if transaction succeeds'), {
    files: {},
    credentials: [],
  });
  const p = await preview(runtime, old.id, 'saved'),
    args = confirmation(p);
  const before = records(runtime),
    original = originalEvidence(runtime, old.id);
  const event = runtime.store.event.bind(runtime.store);
  let attempted = '';
  runtime.store.event = (id, type, instance, data) => {
    if (id !== old.id && type === 'state' && data.state === 'QUEUED') {
      attempted = id;
      throw new Error('fixture queued event failed');
    }
    return event(id, type, instance, data);
  };
  try {
    await assert.rejects(runtime.request('run.rerun.confirm', args), /fixture queued event failed/);
    assert.ok(attempted);
    assert.deepEqual(records(runtime), before);
    assert.deepEqual(runtime.store.events(attempted), []);
    assert.deepEqual(originalEvidence(runtime, old.id), original);
  } finally {
    runtime.store.event = event;
  }
  const next = await runtime.request('run.rerun.confirm', args);
  assert.equal(
    (await completed(runtime, next.id)).output.value,
    'new version only if transaction succeeds',
  );
  assert.equal(runtime.store.list('rerun-request').length, 1);
});

test('fixed scripts retain original dependencies, saved reruns adopt new code and damaged bundles never recompile', async (t) => {
  const f = await fixture(t),
    runtime = f.runtime,
    pkg = join(f.directory, 'local-package');
  await mkdir(pkg);
  await writeFile(
    join(pkg, 'package.json'),
    JSON.stringify({ name: 'fixture-package', version: '1.0.0', main: 'index.cjs' }),
  );
  await writeFile(join(pkg, 'index.cjs'), 'module.exports = {value:"original"};');
  const flow: Flow = {
    ...base,
    steps: [
      {
        id: 'script',
        type: 'script',
        version: 1,
        language: 'ts',
        dependencies: [{ name: 'fixture-package', version: '1.0.0' }],
        input: null,
        code: 'import pkg from "fixture-package"; export default async()=>pkg.value;',
      },
    ],
  };
  const bindings: Bindings = {
    files: {},
    credentials: [],
    scriptPackages: { 'fixture-package': { path: pkg, version: '1.0.0' } },
  };
  const old = await source(runtime, flow, bindings);
  await writeFile(join(pkg, 'index.cjs'), 'module.exports = {value:"updated"};');
  const original = await confirm(runtime, await preview(runtime, old.id));
  assert.equal((await completed(runtime, original.id)).output.script, 'original');
  const p = await preview(runtime, old.id, 'saved');
  assert.notEqual(p.flow.versionId, old.versionId);
  const latest = await confirm(runtime, p);
  assert.equal((await completed(runtime, latest.id)).output.script, 'updated');
  const stale = await preview(runtime, old.id, 'saved');
  await writeFile(join(pkg, 'index.cjs'), 'module.exports = {value:"changed after preview"};');
  await assert.rejects(runtime.request('run.rerun.confirm', confirmation(stale)));
  const snapshot = runtime.store.get<any>('snapshot', old.id);
  const compiled = snapshot.scripts.script;
  await writeFile(compiled, 'throw new Error("tampered fixture must not execute");');
  const before = records(runtime);
  await assert.rejects(preview(runtime, old.id));
  assert.deepEqual(records(runtime), before);
  await rm(compiled);
  await assert.rejects(preview(runtime, old.id));
  assert.deepEqual(records(runtime), before);
});

test('legacy snapshots do not bypass dependency freezing and missing sources never fall back to another mode', async (t) => {
  const f = await fixture(t),
    runtime = f.runtime;
  const flow: Flow = {
    ...base,
    steps: [
      {
        id: 'script',
        type: 'script',
        version: 1,
        language: 'ts',
        dependencies: [],
        input: null,
        code: 'export default async()=>42;',
      },
    ],
  };
  const old = await source(runtime, flow);
  const original = runtime.store.get<any>('snapshot', old.id);
  const { scripts: _scripts, scriptBundles: _bundles, ...legacy } = original;
  runtime.store.put('snapshot', old.id, legacy); // Represent a persisted pre-bundle-format record.
  const before = records(runtime),
    p = await preview(runtime, old.id);
  assert.deepEqual(records(runtime), before);
  const next = await confirm(runtime, p);
  assert.equal((await completed(runtime, next.id)).output.script, 42);
  const legacyDependency = structuredClone(legacy);
  legacyDependency.flow.steps[0].dependencies = [{ name: 'fixture-package', version: '1.0.0' }];
  runtime.store.put('snapshot', old.id, legacyDependency);
  await assert.rejects(preview(runtime, old.id), /依赖|固定|保存/);
  runtime.store.remove('snapshot', old.id);
  await assert.rejects(preview(runtime, old.id));
  runtime.store.put('snapshot', old.id, original);
  runtime.store.remove('flow', old.flowId);
  await assert.rejects(preview(runtime, old.id));
  await assert.rejects(preview(runtime, old.id, 'saved'));
});

test('rerun relations span old history and restart without entering exports or changing unrelated records', async (t) => {
  const f = await fixture(t),
    runtime = f.runtime;
  const old = await source(runtime);
  const derived = await confirm(runtime, await preview(runtime, old.id));
  await completed(runtime, derived.id);
  for (let i = 0; i < 205; i++) {
    const id = 'unrelated-history-' + i;
    runtime.store.put('run', id, { ...old, id, flowId: 'unrelated', name: '虚构旧历史 ' + i });
  }
  const grandchild = await confirm(runtime, await preview(runtime, derived.id));
  await completed(runtime, grandchild.id);
  const bootstrap = await runtime.bootstrap();
  assert.ok(!bootstrap.runs.some((r) => r.id === old.id || r.id === derived.id));
  const rootRelations = (await runtime.request('run.detail', { id: old.id })).rerun;
  assert.deepEqual(
    rootRelations.derived.map((r: Run) => r.id),
    [derived.id],
  );
  const childRelations = (await runtime.request('run.detail', { id: derived.id })).rerun;
  assert.equal(childRelations.source.id, old.id);
  assert.deepEqual(
    childRelations.derived.map((r: Run) => r.id),
    [grandchild.id],
  );
  const before = records(runtime);
  const exportPath=join(f.directory,'export.zip');
  await runtime.request('flow.export', {
    path:exportPath,
    flow: runtime.store.get<FlowRecord>('flow', old.flowId)!.flow,
    reviewed: true,
  });
  const content=JSON.stringify([...(await readArchive(exportPath)).files].map(([p,b])=>[p,b.toString()]));
  for (const hidden of [
    '"rerun"',
    '"requestId"',
    '"reviewedAt"',
    old.id,
    derived.id,
    grandchild.id,
  ])
    assert.ok(!content.includes(hidden), hidden);
  assert.deepEqual(records(runtime), before);
  const unrelated = runtime.store.get('run', 'unrelated-history-0');
  await f.reopen();
  assert.equal(
    (await f.runtime.request('run.detail', { id: grandchild.id })).rerun.source.id,
    derived.id,
  );
  assert.deepEqual(
    (await f.runtime.request('run.detail', { id: old.id })).rerun.derived.map((r: Run) => r.id),
    [derived.id],
  );
  assert.deepEqual(f.runtime.store.get('run', 'unrelated-history-0'), unrelated);
});
