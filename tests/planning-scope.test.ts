import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/host/store';
import { Planning } from '../src/host/planning';
import { planningFlowHash, validateScopedPlan } from '../src/host/planning-scope';
import { validateFlow, walk } from '../src/core/validate';
import { validateIPC } from '../src/shared/ipc';
import { scopedDescription, type PlanningScope } from '../src/shared/planning-scope';
import type { Flow, FlowRecord, Step } from '../src/shared/types';
import type { PlanningInput, PlanningResult, TaskDetail } from '../src/shared/planning';

const flow: Flow = {
  formatVersion: '1.0',
  id: 'scope-flow',
  name: '单步修改',
  description: '完整原任务',
  parameters: {},
  requiredCapabilities: ['value', 'condition', 'loop'],
  steps: [
    { id: 'start', type: 'value', version: 1, value: '项目标题' },
    {
      id: 'condition',
      type: 'condition',
      version: 1,
      actual: { $ref: 'steps.start' },
      operator: 'equals',
      expected: '',
      then: [
        {
          id: 'each',
          type: 'loop',
          version: 1,
          items: [1],
          body: [{ id: 'item', type: 'value', version: 1, value: { $ref: 'item' } }],
        },
      ],
      else: [],
    },
    { id: 'last', type: 'value', version: 1, value: '完成' },
  ],
};
const result = (flow: Flow): PlanningResult => ({
  formatVersion: '1.0',
  kind: 'plan',
  flow,
  summary: '只修改所选步骤',
  questions: [],
  limitations: [],
});
const change = (input: PlanningInput, id = 'condition') => {
  const copy = structuredClone(input.baseFlow!);
  const step: any = walk(copy.steps).find((node) => node.id === id)!;
  if (step.type === 'condition') {
    step.operator = 'contains';
    step.expected = '项目';
  } else if (step.type === 'loop') step.items = [2, 3];
  else step.value = '新的值';
  return result(copy);
};
const defer = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function settled(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((done) => setImmediate(done));
  }
  assert.ok(check(), 'planning did not settle');
}
async function fixture(t: TestContext) {
  const path = mkdtempSync(join(tmpdir(), 'flowark-step-scope-'));
  const key = randomBytes(32);
  let store = new Store(join(path, 'store.sqlite'), Buffer.from(key));
  const record: FlowRecord = {
    id: flow.id,
    flow: structuredClone(flow),
    bindings: { files: { output: '/private/local-output' }, credentials: [] },
    updatedAt: new Date().toISOString(),
  };
  store.put('flow', flow.id, record);
  store.put('snapshot', 'old-run', record);
  store.put('schedule', 'old-schedule', { flow: record.flow, fixed: true });
  const historical = () =>
    JSON.stringify([store.get('snapshot', 'old-run'), store.get('schedule', 'old-schedule')]);
  const frozen = historical();
  const inputs: PlanningInput[] = [];
  const deps = {
    key: async () => 'fictional-api-key',
    assertAvailable() {
      if (store.fault) throw new Error(store.fault);
    },
    generate: async (input: PlanningInput): Promise<PlanningResult> => {
      inputs.push(input);
      return change(input);
    },
    save(next: Flow, bindings: FlowRecord['bindings']) {
      validateFlow(next);
      const saved = { id: next.id, flow: next, bindings, updatedAt: new Date().toISOString() };
      store.put('flow', next.id, saved);
      return saved;
    },
  };
  let service = new Planning(store, deps);
  const call = (method: string, args: any = {}): Promise<TaskDetail> =>
    service.request(method, args);
  let initial = await call('task.create', { flowId: flow.id });
  initial = await call('task.save', {
    id: initial.task.id,
    revision: initial.task.revision,
    description: '保留的完整原任务描述',
    context: [{ id: 'chosen', kind: 'text', label: '选取资料', text: '仅这份资料' }],
    answers: {},
  });
  const detail = () => service.detail(initial.task.id);
  const saveScope = (nodeId = 'condition', instruction = '只调整判断为包含项目') => {
    const d = detail();
    return call('task.save', {
      id: d.task.id,
      revision: d.task.revision,
      description: d.task.description,
      context: d.task.context,
      answers: {},
      scope: { nodeId, instruction, baseFlowHash: d.flowHash },
    });
  };
  const start = () => {
    const d = detail();
    return call('task.generate', {
      id: d.task.id,
      revision: d.task.revision,
      provider: 'deepseek',
      model: 'fixture',
      reviewed: true,
    });
  };
  const generate = async () => {
    await start();
    await settled(() => detail().task.status !== 'generating');
    return detail();
  };
  const adopt = () => {
    const d = detail();
    return call('task.adopt', {
      id: d.task.id,
      revision: d.task.revision,
      proposalId: d.proposal!.id,
    });
  };
  t.after(() => {
    assert.equal(store.count('run'), 0);
    assert.equal(historical(), frozen);
    service.cancelAll();
    store.close();
    key.fill(0);
    rmSync(path, { recursive: true, force: true });
  });
  return {
    get store() {
      return store;
    },
    get service() {
      return service;
    },
    deps,
    inputs,
    call,
    detail,
    saveScope,
    start,
    generate,
    adopt,
    reopen() {
      service.cancelAll();
      store.close();
      store = new Store(join(path, 'store.sqlite'), Buffer.from(key));
      service = new Planning(store, deps);
    },
  };
}

test('scope IPC and save enforce exact source identity; invalid input does not alter the task', async (t) => {
  const f = await fixture(t);
  const original = f.detail();
  const args = {
    id: original.task.id,
    revision: original.task.revision,
    description: original.task.description,
    context: [],
    answers: {},
    scope: { nodeId: 'condition', baseFlowHash: original.flowHash, instruction: '' },
  };
  for (const scope of [
    { ...args.scope, permission: true },
    { ...args.scope, baseFlowHash: 'bad' },
    { ...args.scope, instruction: 'x'.repeat(10001) },
  ])
    assert.throws(() => validateIPC('task.save', { ...args, scope }));
  for (const scope of [
    { ...args.scope, nodeId: 'missing' },
    { ...args.scope, baseFlowHash: '0'.repeat(64) },
  ]) {
    await assert.rejects(f.call('task.save', { ...args, scope }));
    assert.deepEqual(f.detail(), original);
  }
  await f.call('task.save', args);
  await assert.rejects(f.start(), /请描述所选步骤/);
  assert.equal(f.inputs.length, 0);
});

test('nested scoped proposal survives reopen; adoption rolls back on write failure and undo preserves old snapshots', async (t) => {
  const f = await fixture(t);
  await f.saveScope();
  f.reopen();
  const d = await f.generate();
  assert.equal(d.task.status, 'plan');
  assert.deepEqual(d.proposal!.scope, d.task.scope);
  f.reopen();
  assert.deepEqual(f.detail().proposal, d.proposal);
  assert.equal(f.inputs[0].description, scopedDescription(d.task.scope!));
  assert.equal(JSON.stringify(f.inputs).includes('/private/local-output'), false);
  assert.equal(f.inputs[0].description.includes('保留的完整原任务描述'), false);
  assert.deepEqual(f.inputs[0].context, d.task.context);
  assert.equal(d.changes.length, 2);
  assert.ok(d.changes.every((entry) => entry.nodeId === 'condition'));
  const before = f.detail().flow;
  const put = f.store.put.bind(f.store);
  f.store.put = ((kind: string, id: string, value: any) => {
    if (kind === 'ai-task') throw new Error('synthetic write failure');
    put(kind, id, value);
  }) as typeof f.store.put;
  await assert.rejects(f.adopt(), /synthetic/);
  assert.deepEqual(f.detail().flow, before);
  f.store.put = put;
  await f.adopt();
  assert.equal(f.detail().task.scope, undefined);
  assert.equal(f.detail().task.description, '保留的完整原任务描述');
  f.reopen();
  const accepted = f.detail();
  await f.call('task.undo', { id: accepted.task.id, revision: accepted.task.revision });
  assert.deepEqual(f.detail().flow!.flow, before!.flow);
  await f.saveScope('each', '改变循环输入');
  f.deps.generate = async (input) => change(input, 'each');
  assert.equal((await f.generate()).task.status, 'plan');
});

test('out-of-scope changes are rejected for siblings, children, movement, identity and all top-level fields', async (t) => {
  const f = await fixture(t);
  await f.saveScope();
  const mutations: ((next: Flow) => void)[] = [
    (next) => {
      (next.steps[0] as any).value = 'different';
    },
    (next) => {
      (walk(next.steps).find((step) => step.id === 'item') as any).value = 9;
    },
    (next) => {
      next.steps.reverse();
    },
    (next) => {
      next.steps.pop();
    },
    (next) => {
      next.steps.push({ id: 'extra', type: 'value', version: 1, value: 1 });
    },
    (next) => {
      next.name = 'different';
    },
    (next) => {
      next.description = 'different';
    },
    (next) => {
      next.parameters = { injected: true };
    },
    (next) => {
      next.requiredCapabilities = [...next.requiredCapabilities].reverse();
    },
    (next) => {
      next.steps[1].id = 'new-id';
    },
  ];
  for (const mutate of mutations) {
    f.deps.generate = async (input) => {
      const next = change(input);
      mutate(next.flow!);
      return next;
    };
    const d = await f.generate();
    assert.equal(d.task.status, 'failed');
    assert.equal(d.proposal, undefined);
    assert.deepEqual(d.flow!.flow, flow);
  }
  f.deps.generate = async (input) => result(input.baseFlow!);
  assert.match((await f.generate()).task.error!, /没有修改/);
});

test('static targets and resources are fixed while HTTP body and file content can change', () => {
  const cases: [any, string, any][] = [
    [
      {
        id: 'target',
        type: 'http',
        version: 1,
        url: 'https://example.test/',
        method: 'POST',
        headers: {},
        body: 'old',
      },
      'url',
      'https://different.test/',
    ],
    [
      {
        id: 'target',
        type: 'file',
        version: 1,
        operation: 'write',
        binding: 'output',
        name: 'fixed.txt',
        content: 'old',
      },
      'name',
      'different.txt',
    ],
    [
      {
        id: 'target',
        type: 'browser',
        version: 2,
        operation: 'read',
        selector: '#one',
        framePath: [],
      },
      'selector',
      '#two',
    ],
    [
      {
        id: 'target',
        type: 'browser',
        version: 2,
        operation: 'navigate',
        value: 'https://example.test',
        framePath: [],
      },
      'value',
      'https://different.test',
    ],
    [
      {
        id: 'target',
        type: 'script',
        version: 1,
        language: 'javascript',
        code: 'export default () => 1',
        input: {},
        dependencies: [],
      },
      'dependencies',
      ['extra'],
    ],
    [
      {
        id: 'target',
        type: 'excel',
        version: 3,
        operation: 'map',
        binding: 'output',
        name: 'fixed.xlsx',
      },
      'binding',
      'another',
    ],
    [
      {
        id: 'target',
        type: 'file',
        version: 2,
        operation: 'archive',
        binding: 'output',
        name: 'archive.zip',
        files: ['a.txt'],
      },
      'files',
      ['b.txt'],
    ],
    [
      {
        id: 'target',
        type: 'file',
        version: 2,
        operation: 'archive',
        binding: 'output',
        files: { $ref: 'steps.source' },
      },
      'files',
      { $ref: 'steps.other' },
    ],
  ];
  cases.push([
    {
      id: 'target',
      type: 'file',
      version: 1,
      operation: 'copy',
      binding: 'output',
      name: 'fixed.txt',
      content: 'source.txt',
    },
    'content',
    'other.txt',
  ]);
  const scope: PlanningScope = {
    nodeId: 'target',
    baseFlowHash: '0'.repeat(64),
    instruction: 'test',
  };
  for (const [step, field, value] of cases) {
    const before = { ...flow, steps: [step] };
    const after = structuredClone(before);
    after.steps[0][field] = value;
    assert.throws(() => validateScopedPlan(result(after), before, scope), /超出单步/);
  }
  for (const [index, field] of [
    [0, 'body'],
    [1, 'content'],
    [4, 'code'],
  ] as const) {
    const before = { ...flow, steps: [cases[index][0]] };
    const after = structuredClone(before);
    after.steps[0][field] = 'new';
    assert.doesNotThrow(() => validateScopedPlan(result(after), before, scope));
  }
});

test('credential wait and model return both reject changed baselines; cancellation drops late responses', async (t) => {
  const f = await fixture(t);
  await f.saveScope();
  const key = defer<string>();
  f.deps.key = () => key.promise;
  await f.start();
  const baseline = f.detail().flow!;
  const changed = structuredClone(baseline);
  changed.bindings.files.output = '/private/changed';
  f.store.put('flow', flow.id, changed);
  key.resolve('fictional-api-key');
  await settled(() => f.detail().task.status !== 'generating');
  assert.equal(f.detail().task.status, 'failed');
  assert.equal(f.inputs.length, 0);
  await f.saveScope();
  const pending = defer<PlanningResult>();
  f.deps.generate = () => pending.promise;
  await f.start();
  await new Promise((done) => setImmediate(done));
  f.store.put('flow', flow.id, baseline);
  pending.resolve(change({ baseFlow: baseline.flow } as PlanningInput));
  await settled(() => f.detail().task.status !== 'generating');
  assert.equal(f.detail().task.status, 'failed');
  await f.saveScope();
  const late = defer<PlanningResult>();
  f.deps.generate = () => late.promise;
  await f.start();
  await new Promise((done) => setImmediate(done));
  await f.call('task.cancel', { id: f.detail().task.id });
  late.resolve(change({ baseFlow: baseline.flow } as PlanningInput));
  await new Promise((done) => setImmediate(done));
  assert.equal(f.detail().task.status, 'cancelled');
  assert.equal(f.detail().proposal, undefined);
  assert.ok(f.detail().task.scope);
  f.reopen();
  assert.equal(f.detail().task.status, 'cancelled');
});

test('clarify, unsupported, reject and explicit full-task switch retain the original description and never expand silently', async (t) => {
  const f = await fixture(t);
  await f.saveScope();
  f.deps.generate = async () => ({
    formatVersion: '1.0',
    kind: 'clarify',
    flow: null,
    summary: '请补充',
    questions: [{ id: 'rule', prompt: '筛选词？', options: ['项目'] }],
    limitations: [],
  });
  assert.equal((await f.generate()).task.status, 'clarify');
  await assert.rejects(f.adopt());
  f.deps.generate = async () => ({
    formatVersion: '1.0',
    kind: 'unsupported',
    flow: null,
    summary: '需要更换目标，请显式修改完整任务',
    questions: [],
    limitations: ['不能更换目标'],
  });
  assert.equal((await f.generate()).task.status, 'unsupported');
  assert.ok(f.detail().task.scope);
  f.deps.generate = async (input) => change(input);
  const proposed = await f.generate();
  await f.call('task.reject', {
    id: proposed.task.id,
    revision: proposed.task.revision,
    proposalId: proposed.proposal!.id,
  });
  assert.ok(f.detail().task.scope);
  assert.deepEqual(f.detail().flow!.flow, flow);
  const d = f.detail();
  await f.call('task.save', {
    id: d.task.id,
    revision: d.task.revision,
    description: d.task.description,
    context: d.task.context,
    answers: {},
  });
  assert.equal(f.detail().task.scope, undefined);
  assert.equal(f.detail().task.description, d.task.description);
});

test('adoption revalidates scope and refuses binding changes without touching current draft', async (t) => {
  const f = await fixture(t);
  await f.saveScope();
  await f.generate();
  const saved: any = f.store.get('ai-task', f.detail().task.id);
  saved.proposal.result.flow.steps[0].value = 'injected';
  f.store.put('ai-task', saved.id, saved);
  await assert.rejects(f.adopt(), /超出单步/);
  assert.deepEqual(f.detail().flow!.flow, flow);
  await f.generate();
  const record = f.detail().flow!;
  record.bindings.files.output = '/private/new';
  f.store.put('flow', flow.id, record);
  assert.equal(f.detail().flowHash, planningFlowHash(record));
  assert.equal(f.detail().conflict, true);
  await assert.rejects(f.adopt(), /绑定已修改/);
  assert.deepEqual(f.detail().flow, record);
});
