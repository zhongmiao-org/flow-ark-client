import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/host/store';
import { Planning } from '../src/host/planning';
import { planningDiff } from '../src/host/planning-diff';
import { generatePlan } from '../src/ai/planning';
import { validateFlow, validateObject } from '../src/core/validate';
import { validateIPC } from '../src/shared/ipc';
import type { Flow, FlowRecord } from '../src/shared/types';
import type { PlanningInput, PlanningResult, TaskDetail } from '../src/shared/planning';

const example = JSON.parse(readFileSync('contracts/example.planning.json', 'utf8'));
const cases = JSON.parse(readFileSync('contracts/planning.cases.json', 'utf8'));
const valueFlow = (id: string, value: unknown = 'fictional'): Flow => ({
  ...example.result.flow,
  id,
  steps: [{ id: 'value', type: 'value', version: 1, value }],
});
const plan = (input: PlanningInput, value: unknown = 'fictional'): PlanningResult => ({
  ...example.result,
  flow: valueFlow(input.flowId, value),
});
const defer = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
async function settle(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((done) => setImmediate(done));
  }
  assert.ok(check(), 'planning did not settle');
}
function fixture(t: TestContext, generator: typeof generatePlan = async (input) => plan(input)) {
  const directory = mkdtempSync(join(tmpdir(), 'flowark-planning-'));
  const key = randomBytes(32);
  let store = new Store(join(directory, 'store.sqlite'), Buffer.from(key));
  const apiKey = 'sk-fictional-planning-secret';
  const deps = {
    key: async () => apiKey,
    generate: generator,
    assertAvailable: () => {
      if (store.fault) throw new Error(store.fault);
    },
    save: (flow: Flow, bindings: FlowRecord['bindings']) => {
      validateFlow(flow);
      const record = {
        id: flow.id,
        flow: structuredClone(flow),
        bindings: structuredClone(bindings),
        updatedAt: new Date().toISOString(),
      };
      store.put('flow', flow.id, record);
      return record;
    },
  };
  let service = new Planning(store, deps);
  t.after(() => {
    service.cancelAll();
    store.close();
    key.fill(0);
    rmSync(directory, { recursive: true, force: true });
  });
  const call = (method: string, args: unknown = {}): Promise<TaskDetail> =>
    service.request(method, args);
  const create = async (flowId?: string) => {
    const { task } = await call('task.create', flowId ? { flowId } : {});
    return call('task.save', {
      id: task.id,
      revision: task.revision,
      description: '产生示例值并核对',
      context: [],
      answers: {},
    });
  };
  const generate = async (detail: TaskDetail) => {
    await call('task.generate', {
      id: detail.task.id,
      revision: detail.task.revision,
      provider: 'deepseek',
      model: 'fixture-model',
      reviewed: true,
    });
    await settle(() => service.detail(detail.task.id).task.status !== 'generating');
    return service.detail(detail.task.id);
  };
  const adopt = (d: TaskDetail) =>
    call('task.adopt', { id: d.task.id, revision: d.task.revision, proposalId: d.proposal!.id });
  return {
    get store() {
      return store;
    },
    get service() {
      return service;
    },
    deps,
    apiKey,
    call,
    create,
    generate,
    adopt,
    reopen() {
      store.close();
      store = new Store(join(directory, 'store.sqlite'), Buffer.from(key));
      service = new Planning(store, deps);
    },
  };
}

test('published planning cases and IPC reject incomplete plans, hidden permissions and oversized context', () => {
  validateObject('AIPlanningRequest', example.request);
  for (const c of cases.valid) validateObject('AIPlanningResult', c);
  for (const c of cases.invalid)
    assert.throws(() => validateObject('AIPlanningResult', c.value), c.name);
  const args = { id: 'task', revision: 1, provider: 'deepseek', model: 'example', reviewed: true };
  assert.deepEqual(validateIPC('task.generate', args), args);
  for (const extra of [
    { reviewed: false },
    { provider: 'automatic' },
    { revision: 0 },
    { bindings: {} },
  ])
    assert.throws(() => validateIPC('task.generate', { ...args, ...extra }));
  const item = { id: 'ctx', kind: 'text', label: 'Chosen text', text: 'x'.repeat(50000) };
  const save = { id: 'task', revision: 1, description: '', context: [item], answers: {} };
  assert.doesNotThrow(() => validateIPC('task.save', save));
  assert.throws(() => validateIPC('task.save', { ...save, context: [item, item] }));
  assert.throws(() =>
    validateIPC('task.save', {
      ...save,
      context: Array.from({ length: 5 }, (_, i) => ({ ...item, id: 'c' + i })),
    }),
  );
  assert.throws(() => validateIPC('task.save', { ...save, filePath: '/private/unselected' }));
});

test('plan generation is inert; explicit adoption and undo affect only the associated draft and survive reopen', async (t) => {
  const f = fixture(t);
  const task = await f.create();
  const proposed = await f.generate(task);
  assert.equal(proposed.task.status, 'plan');
  assert.equal(proposed.flow, null);
  assert.ok(proposed.changes.some((c) => c.kind === 'added' && c.nodeId === 'value'));
  const accepted = await f.adopt(proposed);
  assert.equal(accepted.flow?.flow.id, task.task.flowId);
  assert.equal(accepted.task.revision, task.task.revision + 1);
  assert.equal(accepted.canUndo, true);
  f.reopen();
  assert.equal(f.service.detail(task.task.id).canUndo, true);
  const undone = await f.call('task.undo', { id: task.task.id, revision: accepted.task.revision });
  assert.equal(undone.flow, null);
  for (const kind of ['run', 'version', 'snapshot', 'schedule', 'script-lease'])
    assert.equal(f.store.count(kind), 0, kind);
});

test('clarification and unsupported results are stored without flows; malformed semantics are rejected', async (t) => {
  let result: any = cases.valid[1];
  const f = fixture(t, async () => result);
  const task = await f.create();
  let d = await f.generate(task);
  assert.equal(d.task.status, 'clarify');
  await assert.rejects(f.adopt(d), /完整方案/);
  result = cases.valid[2];
  assert.equal((await f.generate(task)).task.status, 'unsupported');
  for (const wrong of [
    { ...example.result, flow: valueFlow('another-flow') },
    { ...example.result, flow: { ...valueFlow(task.task.flowId), steps: [] } },
    {
      ...example.result,
      flow: { ...valueFlow(task.task.flowId), requiredCapabilities: ['unknown-tool'] },
    },
    {
      ...example.result,
      flow: {
        ...valueFlow(task.task.flowId),
        sourceTemplate: { id: 'invented', version: '1', digest: 'fake' },
      },
    },
    { ...example.result, flow: valueFlow(task.task.flowId, { $ref: 'steps.absent' }) },
    { ...cases.valid[1], questions: [cases.valid[1].questions[0], cases.valid[1].questions[0]] },
  ]) {
    result = wrong;
    d = await f.generate(task);
    assert.equal(d.task.status, 'failed');
    assert.equal(d.flow, null);
    assert.equal(d.task.description, task.task.description);
  }
  assert.equal(f.store.count('run'), 0);
});

test('a late provider result cannot revive a cancelled request or overwrite a new task revision', async (t) => {
  let gate = defer<PlanningResult>(),
    captured!: PlanningInput,
    signal!: AbortSignal;
  const f = fixture(t, async (input, _p, _m, _k, abort) => {
    captured = input;
    signal = abort;
    return gate.promise;
  });
  const d = await f.create();
  const start = () =>
    f.call('task.generate', {
      id: d.task.id,
      revision: d.task.revision,
      provider: 'deepseek',
      model: 'fixture',
      reviewed: true,
    });
  await start();
  await settle(() => !!captured);
  await assert.rejects(start(), /正在生成/);
  await f.call('task.cancel', { id: d.task.id });
  assert.equal(signal.aborted, true);
  gate.resolve(plan(captured));
  await new Promise((r) => setImmediate(r));
  assert.equal(f.service.detail(d.task.id).task.status, 'cancelled');
  gate = defer<PlanningResult>();
  await start();
  const saved = await f.call('task.save', {
    id: d.task.id,
    revision: d.task.revision,
    description: '修改后的目标',
    context: [],
    answers: {},
  });
  gate.resolve(plan(captured));
  await new Promise((r) => setImmediate(r));
  assert.equal(f.service.detail(d.task.id).task.description, '修改后的目标');
  assert.equal(f.service.detail(d.task.id).proposal, undefined);
  await assert.rejects(
    f.call('task.save', {
      id: d.task.id,
      revision: d.task.revision,
      description: 'stale',
      context: [],
      answers: {},
    }),
    /已变化/,
  );
  assert.equal(saved.task.revision, d.task.revision + 1);
});

test('editing while credentials are pending prevents any model call; explicit context excludes bindings and history', async (t) => {
  let called = 0,
    captured!: PlanningInput;
  const f = fixture(t, async (input) => {
    called++;
    captured = input;
    return plan(input);
  });
  const record = f.deps.save(valueFlow('existing'), {
    files: { work: '/private/unselected' },
    credentials: ['private-binding'],
  });
  f.store.put('run', 'old', { id: 'old', privateHistory: 'never send' });
  const d = await f.create(record.id);
  const gate = defer<string>();
  f.deps.key = () => gate.promise;
  await f.call('task.generate', {
    id: d.task.id,
    revision: d.task.revision,
    provider: 'deepseek',
    model: 'fixture',
    reviewed: true,
  });
  let next = await f.call('task.save', {
    id: d.task.id,
    revision: d.task.revision,
    description: '本次目标',
    context: [{ id: 'selected', kind: 'text', label: '选中片段', text: 'only selected' }],
    answers: { output: 'review first' },
  });
  gate.resolve(f.apiKey);
  await new Promise((r) => setImmediate(r));
  assert.equal(called, 0);
  next = await f.generate(next);
  assert.equal(called, 1);
  assert.equal(captured.context[0]!.text, 'only selected');
  assert.equal(captured.answers.output, 'review first');
  const body = JSON.stringify(captured);
  for (const omitted of ['private-binding', '/private/unselected', 'never send', f.apiKey])
    assert.ok(!body.includes(omitted));
  assert.equal(f.store.count('run'), 1);
});

test('manual flow edits and resource changes invalidate adoption; reject and undo preserve fixed execution records', async (t) => {
  const f = fixture(t, async (input) => plan(input, 'new-value'));
  const original = f.deps.save(valueFlow('existing', 'old-value'), { files: {}, credentials: [] });
  const fixed = { id: 'fixed', flow: original.flow };
  f.store.put('version', fixed.id, fixed);
  const d = await f.create(original.id);
  let proposed = await f.generate(d);
  f.deps.save(valueFlow(original.id, 'hand edit'), original.bindings);
  assert.equal(f.service.detail(d.task.id).conflict, true);
  await assert.rejects(f.adopt(proposed), /未覆盖手动编辑/);
  assert.deepEqual(f.store.get('version', fixed.id), fixed);
  proposed = await f.generate(d);
  f.deps.save(f.store.get<FlowRecord>('flow', original.id)!.flow, {
    files: { other: '/chosen' },
    credentials: [],
  });
  await assert.rejects(f.adopt(proposed), /未覆盖手动编辑/);
  proposed = await f.generate(d);
  await f.call('task.reject', {
    id: d.task.id,
    revision: d.task.revision,
    proposalId: proposed.proposal!.id,
  });
  assert.equal(f.service.detail(d.task.id).proposal, undefined);
  proposed = await f.generate(d);
  const accepted = await f.adopt(proposed);
  f.deps.save(valueFlow(original.id, 'later hand edit'), accepted.flow!.bindings);
  await assert.rejects(
    f.call('task.undo', { id: d.task.id, revision: accepted.task.revision }),
    /不能用撤销覆盖/,
  );
  assert.deepEqual(f.store.get('version', fixed.id), fixed);
});

test('adoption rollback keeps the old flow and proposal when task persistence fails', async (t) => {
  const f = fixture(t, async (input) => plan(input, 'replacement'));
  const original = f.deps.save(valueFlow('old'), { files: {}, credentials: [] });
  const proposed = await f.generate(await f.create(original.id));
  const put = f.store.put.bind(f.store);
  t.mock.method(f.store, 'put', (kind: string, id: string, value: any) => {
    if (kind === 'ai-task') throw new Error('fictional save failure');
    put(kind, id, value);
  });
  await assert.rejects(f.adopt(proposed), /save failure/);
  assert.deepEqual(f.store.get('flow', original.id), original);
  assert.equal(f.service.detail(proposed.task.id).proposal?.id, proposed.proposal?.id);
});

test('generation failures never disclose the key or replace the accepted flow, and restart cancels old requests', async (t) => {
  let fail = true;
  const f = fixture(t, async (input) => {
    if (fail) throw new Error('provider says ' + f.apiKey);
    return plan(input);
  });
  const d = await f.create();
  const failed = await f.generate(d);
  assert.equal(failed.task.status, 'failed');
  assert.ok(!failed.task.error?.includes(f.apiKey));
  fail = false;
  await f.adopt(await f.generate(d));
  const saved = f.store.get<any>('ai-task', d.task.id);
  f.store.put('ai-task', d.task.id, { ...saved, status: 'generating', requestId: 'interrupted' });
  f.reopen();
  assert.equal(f.service.detail(d.task.id).task.status, 'cancelled');
  assert.ok(f.service.detail(d.task.id).flow);
  assert.equal(f.store.count('run'), 0);
});

test('shutdown revokes all in-flight requests before a failed cancellation write', async (t) => {
  const signals: AbortSignal[] = [];
  const f = fixture(t, async (_i, _p, _m, _k, signal) => {
    signals.push(signal);
    return new Promise(() => {});
  });
  for (let i = 0; i < 2; i++) {
    const d = await f.create();
    await f.call('task.generate', {
      id: d.task.id,
      revision: d.task.revision,
      provider: 'deepseek',
      model: 'fixture',
      reviewed: true,
    });
  }
  await settle(() => signals.length === 2);
  t.mock.method(f.store, 'put', () => {
    throw new Error('fictional storage error');
  });
  assert.throws(() => f.service.cancelAll(), /状态未能完整保存/);
  assert.ok(signals.every((s) => s.aborted));
});

test('diff preserves node identities across nested branch moves and reports field/resource changes', () => {
  const before = valueFlow('flow', 'before');
  const after: Flow = {
    ...before,
    parameters: { new: 1 },
    steps: [
      {
        id: 'branch',
        type: 'condition',
        version: 1,
        actual: true,
        operator: 'equals',
        expected: true,
        then: [{ ...before.steps[0], value: 'after' } as any],
        else: [],
      },
    ],
  };
  const diff = planningDiff(before, after);
  assert.ok(diff.some((c) => c.nodeId === 'value' && c.kind === 'moved'));
  assert.ok(
    diff.some(
      (c) => c.path === 'steps/value/value' && c.before === 'before' && c.after === 'after',
    ),
  );
  assert.ok(diff.some((c) => c.path === 'parameters'));
});

test('both provider adapters request a complete JSON envelope and reject incomplete/malformed responses', async () => {
  for (const provider of ['deepseek', 'openai-codex'] as const) {
    let request: any;
    const output = { resultJson: JSON.stringify(example.result) };
    const response =
      provider === 'deepseek'
        ? {
            id: 'fixture',
            choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }],
          }
        : {
            id: 'fixture',
            status: 'completed',
            output: [
              { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] },
            ],
          };
    const fetcher = (async (_url, init) => {
      request = JSON.parse(init!.body as string);
      return Response.json(response);
    }) as typeof fetch;
    const result = await generatePlan(
      example.request,
      provider,
      'fixture-model',
      'fictional-key',
      new AbortController().signal,
      fetcher,
    );
    assert.deepEqual(result, example.result);
    assert.equal(request.model, 'fixture-model');
    const userInput = provider === 'deepseek' ? request.messages[1].content : request.input;
    assert.ok(userInput.includes('flowId'));
    assert.ok(!userInput.includes('fictional-key'));
    output.resultJson = '{"kind":"plan"';
    const broken = (async () =>
      Response.json(
        provider === 'deepseek'
          ? { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }
          : {
              status: 'completed',
              output: [
                {
                  type: 'message',
                  content: [{ type: 'output_text', text: JSON.stringify(output) }],
                },
              ],
            },
      )) as typeof fetch;
    await assert.rejects(
      generatePlan(
        example.request,
        provider,
        'fixture',
        'key',
        new AbortController().signal,
        broken,
      ),
    );
  }
});
