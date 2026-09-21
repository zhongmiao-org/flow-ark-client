import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/host/store';
import { Planning } from '../src/host/planning';
import { PlanningRepair } from '../src/host/planning-repair';
import { validateIPC } from '../src/shared/ipc';
import type { PlanningInput, PlanningResult, TaskDetail } from '../src/shared/planning';
import type { RepairInput, RepairPreview, RepairSelection } from '../src/shared/task-repair';
import type { Flow, FlowRecord, Run } from '../src/shared/types';

const defer = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
async function wait(done: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (done()) return;
    await new Promise((r) => setImmediate(r));
  }
  assert.ok(done(), 'planning did not settle');
}
async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'flowark-repair-'));
  const key = randomBytes(32);
  let store = new Store(join(directory, 'store.sqlite'), Buffer.from(key));
  const flow: Flow = {
    formatVersion: '1.0',
    id: 'flow',
    name: '虚构目标修复',
    description: '',
    parameters: {},
    requiredCapabilities: ['browser', 'value'],
    steps: [
      { id: 'before', type: 'value', version: 1, value: 'keep' },
      {
        id: 'title',
        name: '读取标题',
        type: 'browser',
        version: 2,
        operation: 'read',
        selector: '#old',
        framePath: [],
        value: null,
      },
      { id: 'after', type: 'value', version: 1, value: { $ref: 'steps.title' } },
    ],
  };
  const original: FlowRecord = {
    id: flow.id,
    flow,
    bindings: { files: { private: '/never-send' }, credentials: [], browserId: 'embedded' },
    updatedAt: '2026-09-21',
  };
  store.put('flow', flow.id, original);
  store.put('browser', 'embedded', {
    id: 'embedded',
    product: 'embedded',
    executable: '',
    version: 'fixture',
  });
  const run: Run = {
    id: 'failed',
    flowId: flow.id,
    versionId: 'fixed',
    name: flow.name,
    state: 'FAILED',
    createdAt: '2026-09-21',
    updatedAt: '2026-09-21',
    source: 'manual',
    business: '',
    error: 'private failure text',
  };
  store.put('run', run.id, run);
  store.put('snapshot', run.id, original);
  store.event(run.id, 'node-start', 'before', {});
  store.event(run.id, 'node-end', 'before', { completed: true });
  store.event(run.id, 'node-start', 'title', {});
  const selection: RepairSelection = {
    requestId: randomUUID(),
    resourceId: randomUUID(),
    documentRevision: 1,
    url: 'https://private.example/?token=private',
    title: 'private-page-title',
    target: {
      selector: '#new',
      framePath: [],
      label: '虚构标题',
      tag: 'h1',
      inputType: '',
      structural: false,
    },
  };
  let captured = true,
    runtimeEpoch = 0,
    blocked = false,
    calls = 0,
    keyCalls = 0;
  let captureGate: ReturnType<typeof defer> | undefined;
  let keyGate: ReturnType<typeof defer> | undefined;
  let modelGate: ReturnType<typeof defer> | undefined;
  let changeResult: (r: PlanningResult) => void = () => {};
  let sent: PlanningInput | undefined;
  const create = () =>
    new Planning(store, {
      assertAvailable: () => {
        if (store.fault) throw new Error(store.fault);
      },
      repair: new PlanningRepair(store, {
        epoch: () => runtimeEpoch,
        assertAvailable: () => {
          if (blocked) throw new Error('runtime busy');
        },
        capture: async (requestId) => {
          await captureGate?.promise;
          if (!captured || requestId !== selection.requestId)
            throw new Error('selection unavailable');
          return structuredClone(selection);
        },
      }),
      key: async () => {
        keyCalls++;
        await keyGate?.promise;
        return 'sk-local-test';
      },
      generate: async (input) => {
        sent = structuredClone(input);
        calls++;
        await modelGate?.promise;
        const next = structuredClone(input.baseFlow!);
        const target = JSON.parse(input.context[0]!.text).target;
        Object.assign(next.steps[1], { selector: target.selector, framePath: target.framePath });
        const result: PlanningResult = {
          formatVersion: '1.0',
          kind: 'plan',
          summary: '只修复目标',
          flow: next,
          questions: [],
          limitations: [],
        };
        changeResult(result);
        return result;
      },
      save: (flow, bindings) => {
        const record = { id: flow.id, flow, bindings, updatedAt: 'updated' };
        store.put('flow', record.id, record);
        return record;
      },
    });
  let service = create();
  t.after(() => {
    service.cancelAll();
    store.close();
    key.fill(0);
    rmSync(directory, { recursive: true, force: true });
  });
  const task = (await service.request('task.create', { flowId: flow.id })).task;
  const saved: TaskDetail = await service.request('task.save', {
    id: task.id,
    revision: task.revision,
    description: '读取标题',
    context: [
      { id: 'unselected', kind: 'text', label: 'private', text: 'unselected-private-context' },
    ],
    answers: { private: 'private-answer' },
  });
  const args: RepairInput = {
    id: task.id,
    revision: saved.task.revision,
    runId: run.id,
    nodeId: 'title',
    pickRequestId: selection.requestId,
  };
  const call = (method: string, input: unknown) => service.request(method, input);
  const preview = (): Promise<RepairPreview> => call('task.repair.preview', args);
  const generate = async (p?: RepairPreview) => {
    await call('task.repair.generate', {
      ...args,
      token: (p ?? (await preview())).token,
      provider: 'deepseek',
      model: 'fixture',
      reviewed: true,
    });
  };
  const detail = () => service.detail(task.id);
  const settled = async () => {
    await wait(() => detail().task.status !== 'generating');
    return detail();
  };
  const adopt = () =>
    call('task.adopt', { id: task.id, revision: args.revision, proposalId: detail().proposal!.id });
  return {
    args,
    original,
    run,
    selection,
    preview,
    generate,
    settled,
    detail,
    call,
    adopt,
    get store() {
      return store;
    },
    get calls() {
      return calls;
    },
    get keyCalls() {
      return keyCalls;
    },
    get sent() {
      return sent;
    },
    block: () => {
      blocked = true;
    },
    suspendResume: () => {
      runtimeEpoch++;
      service.cancelAll();
    },
    unpick: () => {
      captured = false;
    },
    gateCapture: () => (captureGate = defer()),
    gateKey: () => (keyGate = defer()),
    gateModel: () => (modelGate = defer()),
    change: (fn: typeof changeResult) => {
      changeResult = fn;
    },
    reopen: () => {
      service.cancelAll();
      store.close();
      store = new Store(join(directory, 'store.sqlite'), Buffer.from(key));
      service = create();
    },
  };
}

test('target repair previews explicit minimal input, validates actual source and adopts only target without touching old run', async (t) => {
  const f = await fixture(t);
  const before = {
    run: f.store.get('run', 'failed'),
    snapshot: f.store.get('snapshot', 'failed'),
    events: f.store.events('failed'),
  };
  const p = await f.preview();
  assert.equal(f.calls, 0);
  for (const secret of [
    'never-send',
    'unselected-private-context',
    'private-answer',
    'private failure text',
    'private-page-title',
    'token=private',
  ])
    assert.equal(JSON.stringify(p.input).includes(secret), false, secret);
  await f.generate(p);
  const result = await f.settled();
  assert.equal(result.task.status, 'plan');
  assert.equal(result.proposal?.repair?.runId, 'failed');
  assert.equal(result.changes.length, 1);
  assert.equal(f.calls, 1);
  assert.deepEqual(f.sent, p.input);
  await f.adopt();
  const current = f.store.get<FlowRecord>('flow', 'flow')!;
  assert.equal((current.flow.steps[1] as any).selector, '#new');
  assert.deepEqual(current.bindings, f.original.bindings);
  assert.deepEqual(
    {
      run: f.store.get('run', 'failed'),
      snapshot: f.store.get('snapshot', 'failed'),
      events: f.store.events('failed'),
    },
    before,
  );
  assert.equal(f.store.list('run').length, 1);
  const d = f.detail();
  await f.call('task.undo', { id: d.task.id, revision: d.task.revision });
  assert.deepEqual(f.store.get<FlowRecord>('flow', 'flow')!.flow, f.original.flow);
});

test('repair rejects forged IPC, unrelated or completed nodes, changed step, same target and unavailable native selection', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(validateIPC('task.repair.preview', f.args), f.args);
  for (const extra of [
    { selector: '#x' },
    { matched: 1 },
    { nodeId: '' },
    { pickRequestId: 'fake' },
    { revision: 0 },
  ])
    assert.throws(() => validateIPC('task.repair.preview', { ...f.args, ...extra }));
  assert.throws(() =>
    validateIPC('browser.embedded.pick.capture', { requestId: f.args.pickRequestId }),
  );
  await assert.rejects(f.call('task.repair.preview', { ...f.args, nodeId: 'before' }), /最后开始/);
  await assert.rejects(f.call('task.repair.preview', { ...f.args, runId: 'other' }), /修复来源/);
  const changed = structuredClone(f.original);
  changed.flow.steps[1].name = 'manual';
  f.store.put('flow', 'flow', changed);
  await assert.rejects(f.preview(), /手动修改/);
  f.store.put('flow', 'flow', f.original);
  f.selection.target.selector = '#old';
  await assert.rejects(f.preview(), /没有变化/);
  f.selection.target.selector = '#new';
  f.unpick();
  await assert.rejects(f.preview(), /selection unavailable/);
  assert.equal(f.calls, 0);
});

test('repair rejects model expansion, stale page after preview and while waiting for credentials', async (t) => {
  const f = await fixture(t);
  const p = await f.preview();
  f.selection.documentRevision++;
  await assert.rejects(f.generate(p), /已变化/);
  assert.equal(f.calls, 0);
  const key = f.gateKey();
  await f.generate();
  await wait(() => f.keyCalls === 1);
  f.selection.documentRevision++;
  key.resolve();
  assert.equal((await f.settled()).task.status, 'failed');
  assert.equal(f.calls, 0);
  f.change((result) => {
    result.flow!.steps[0] = { id: 'before', type: 'value', version: 1, value: 'changed' };
  });
  await f.generate();
  assert.match((await f.settled()).task.error!, /超出/);
  assert.deepEqual(f.store.get<FlowRecord>('flow', 'flow'), f.original);
});

test('repair cannot publish a late model result after cancel or page changes', async (t) => {
  const f = await fixture(t);
  const hold = f.gateModel();
  await f.generate();
  await wait(() => f.calls === 1);
  await f.call('task.cancel', { id: f.args.id });
  hold.resolve();
  await new Promise((r) => setImmediate(r));
  assert.equal(f.detail().task.status, 'cancelled');
  assert.equal(f.detail().proposal, undefined);
  const changed = f.gateModel();
  await f.generate();
  await wait(() => f.calls === 2);
  f.selection.documentRevision++;
  changed.resolve();
  assert.equal((await f.settled()).task.status, 'failed');
  assert.equal(f.detail().proposal, undefined);
});

test('repair adoption rechecks selection, task revision, current proposal and bindings across async inspection', async (t) => {
  const f = await fixture(t);
  await f.generate();
  await f.settled();
  f.selection.documentRevision++;
  await assert.rejects(f.adopt(), /已变化/);
  f.selection.documentRevision--;
  const gate = f.gateCapture();
  const adopt = f.adopt();
  const d = f.detail();
  await f.call('task.reject', {
    id: d.task.id,
    revision: d.task.revision,
    proposalId: d.proposal!.id,
  });
  gate.resolve();
  await assert.rejects(adopt, /提案或流程/);
  assert.deepEqual(f.store.get<FlowRecord>('flow', 'flow'), f.original);
  await f.generate();
  await f.settled();
  const second = f.gateCapture();
  const changing = f.adopt();
  const current = f.detail();
  await f.call('task.save', {
    id: current.task.id,
    revision: current.task.revision,
    description: 'manual edit',
    context: [],
    answers: {},
  });
  second.resolve();
  await assert.rejects(changing, /草稿已变化/);
  assert.equal(f.store.list('run').length, 1);
});

test('repair adoption rolls back failed writes and reopening invalidates unconfirmed repair tokens', async (t) => {
  const f = await fixture(t);
  const p = await f.preview();
  await f.generate(p);
  await f.settled();
  const put = f.store.put.bind(f.store);
  f.store.put = (kind, id, payload) => {
    if (kind === 'ai-task') throw new Error('fixture write failure');
    put(kind, id, payload);
  };
  await assert.rejects(f.adopt(), /write failure/);
  assert.deepEqual(f.store.get<FlowRecord>('flow', 'flow'), f.original);
  f.store.put = put;
  f.reopen();
  await assert.rejects(f.generate(p), /已变化/);
  assert.equal(f.store.list('run').length, 1);
});

test('cancel during repair preflight prevents later generation; binding edits and runtime ownership invalidate pending work', async (t) => {
  const f = await fixture(t);
  const preview = await f.preview();
  const pending = f.gateCapture();
  const generating = f.generate(preview);
  await f.call('task.cancel', { id: f.args.id });
  pending.resolve();
  await assert.rejects(generating, /已取消/);
  assert.equal(f.calls, 0);
  await f.generate();
  await f.settled();
  const adopting = f.gateCapture();
  const accepted = f.adopt();
  const changed = structuredClone(f.original);
  changed.bindings.files.private = '/manual-binding';
  f.store.put('flow', 'flow', changed);
  adopting.resolve();
  await assert.rejects(accepted, /已变化/);
  assert.deepEqual(f.store.get('flow', 'flow'), changed);
  f.block();
  await assert.rejects(f.preview(), /runtime busy/);
  assert.equal(f.store.list('run').length, 1);
});

test('suspension invalidates a displayed token and an adoption waiting for native inspection', async (t) => {
  const f = await fixture(t);
  const before = await f.preview();
  f.suspendResume();
  await assert.rejects(f.generate(before), /已变化/);
  assert.equal(f.calls, 0);
  await f.generate();
  await f.settled();
  const gate = f.gateCapture();
  const adopting = f.adopt();
  f.suspendResume();
  gate.resolve();
  await assert.rejects(adopting, /已变化/);
  assert.deepEqual(f.store.get('flow', 'flow'), f.original);
  assert.equal(f.store.list('run').length, 1);
});
