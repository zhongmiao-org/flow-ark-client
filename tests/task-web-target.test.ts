import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/host/store';
import { Planning } from '../src/host/planning';
import { TaskWebTargets } from '../src/host/task-web-target';
import { planningFlowHash } from '../src/host/planning-scope';
import { executionVersion } from '../src/host/run-rerun';
import { validateIPC } from '../src/shared/ipc';
import { validateFlow } from '../src/core/validate';
import {
  assertWebFlow,
  pageIdentity,
  webContext,
  WEB_CONTEXT_ID,
} from '../src/shared/task-web-target';
import type { PlanningInput, PlanningResult, TaskDetail } from '../src/shared/planning';
import type { EmbeddedReview } from '../src/shared/run-review';
import type { Flow, FlowRecord, Step } from '../src/shared/types';

const original: EmbeddedReview = {
  started: true,
  loading: false,
  resourceId: 'private-resource-id',
  documentRevision: 7,
  url: 'https://example.com/selected',
  title: '已选资料页',
};
const gate = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setImmediate(r));
  }
  assert.ok(check(), 'planning did not settle');
}
const result = (input: PlanningInput): PlanningResult => ({
  formatVersion: '1.0',
  kind: 'plan',
  summary: '读取已选网页',
  questions: [],
  limitations: [],
  flow: {
    id: input.flowId,
    formatVersion: '1.0',
    name: '只读网页',
    description: '',
    parameters: {},
    requiredCapabilities: ['browser'],
    steps: [
      { id: 'read', type: 'browser', version: 1, operation: 'read', selector: 'h1', value: null },
    ],
  },
});
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'flowark-web-target-'));
  const store = new Store(join(dir, 'store.sqlite'), randomBytes(32));
  const state = {
    page: structuredClone(original),
    busy: false,
    pageGate: undefined as Promise<void> | undefined,
    reads: 0,
    requests: [] as PlanningInput[],
    modelGate: undefined as Promise<PlanningResult> | undefined,
  };
  const web = new TaskWebTargets(store, {
    assertSelectable() {
      if (state.busy) throw new Error('运行中');
    },
    async page() {
      state.reads++;
      const page = structuredClone(state.page);
      await state.pageGate;
      return page;
    },
  });
  const deps = {
    web,
    assertAvailable() {},
    key: async () => 'sk-fixture-web-key',
    async generate(input: PlanningInput) {
      state.requests.push(input);
      return state.modelGate ? state.modelGate : result(input);
    },
    save(flow: Flow, bindings: FlowRecord['bindings']): FlowRecord {
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
  const planning = new Planning(store, deps);
  t.after(() => {
    planning.cancelAll();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const call = (method: string, args: unknown = {}): Promise<any> => planning.request(method, args);
  const identity = (d: TaskDetail) => ({ id: d.task.id, revision: d.task.revision });
  const create = async () => {
    const d = await call('task.create');
    return call('task.save', {
      ...identity(d),
      description: '读取网页标题',
      context: [],
      answers: {},
    }) as Promise<TaskDetail>;
  };
  const select = async (d: TaskDetail) => {
    const p = await call('task.web.preview', identity(d));
    return call('task.web.select', { ...identity(d), token: p.token }) as Promise<TaskDetail>;
  };
  const start = (d: TaskDetail) =>
    call('task.generate', {
      ...identity(d),
      provider: 'deepseek',
      model: 'fixture',
      reviewed: true,
    });
  const generate = async (d: TaskDetail) => {
    await start(d);
    await until(() => planning.detail(d.task.id).task.status !== 'generating');
    return planning.detail(d.task.id);
  };
  const adopt = (d: TaskDetail) =>
    call('task.adopt', { ...identity(d), proposalId: d.proposal!.id }) as Promise<TaskDetail>;
  return {
    store,
    state,
    web,
    deps,
    planning,
    call,
    identity,
    create,
    select,
    start,
    generate,
    adopt,
  };
}

test('web selection IPC accepts only host tokens and ordinary context cannot claim the reserved source', () => {
  const input = { id: 'task', revision: 2, token: 'a'.repeat(64) };
  assert.deepEqual(validateIPC('task.web.select', input), input);
  for (const extra of [
    { page: original },
    { verified: true },
    { token: 'guessed' },
    { revision: 0 },
  ])
    assert.throws(() => validateIPC('task.web.select', { ...input, ...extra }));
  assert.throws(() =>
    validateIPC('task.save', {
      id: 'task',
      revision: 1,
      description: '',
      context: [{ id: WEB_CONTEXT_ID, label: 'forged', kind: 'web', text: 'x' }],
      answers: {},
    }),
  );
  for (const change of [
    { started: false },
    { loading: true },
    { blocked: 'busy' },
    { resourceId: null },
    { documentRevision: -1 },
    { url: 'file:///private/data' },
    { title: null },
  ])
    assert.throws(() => pageIdentity({ ...original, ...change } as any));
});

test('preview and select reject a refreshed page, another host session, task change, and active runs without side effects', async (t) => {
  const f = fixture(t),
    d = await f.create(),
    id = f.identity(d);
  const p = await f.call('task.web.preview', id);
  f.state.page.documentRevision++;
  await assert.rejects(f.call('task.web.select', { ...id, token: p.token }), /变化/);
  f.state.page = structuredClone(original);
  const another = new TaskWebTargets(f.store, {
    page: async () => original,
    assertSelectable() {},
  });
  await assert.rejects(another.select(f.store.get('ai-task', d.task.id)!, p.token), /变化/);
  f.state.busy = true;
  await assert.rejects(f.call('task.web.preview', id), /运行中/);
  f.state.busy = false;
  const pending = gate<void>();
  f.state.pageGate = pending.promise;
  const stale = f.call('task.web.select', { ...id, token: p.token });
  await f.call('task.save', { ...id, description: 'changed', context: [], answers: {} });
  pending.resolve();
  await assert.rejects(stale, /变化/);
  for (const kind of ['run', 'flow', 'snapshot']) assert.equal(f.store.count(kind), 0);
});

test('selected source is host-built, constrained and versioned; adoption and undo preserve the independent source choice', async (t) => {
  const f = fixture(t),
    d = await f.select(await f.create());
  assert.equal(d.task.context.length, 0);
  const proposed = await f.generate(d),
    input = f.state.requests[0];
  assert.deepEqual(input.context, [webContext(d.task.webTarget!)]);
  assert.match(input.context[0]!.text, /未核对/);
  assert.doesNotMatch(
    JSON.stringify(input),
    /private-resource-id|selectionId|documentRevision|selectedAt|sk-fixture/,
  );
  assert.ok(!input.capabilities.includes('script'));
  const accepted = await f.adopt(proposed),
    record = accepted.flow!;
  assert.deepEqual(record.webTarget, d.task.webTarget);
  assert.equal(record.bindings.browserId, 'embedded');
  await f.web.record(record);
  const different = { ...record, webTarget: { ...record.webTarget!, selectionId: 'different' } };
  assert.notEqual(planningFlowHash(record), planningFlowHash(different));
  assert.notEqual(
    executionVersion(record, { scriptBundles: [], scripts: {} }),
    executionVersion(different, { scriptBundles: [], scripts: {} }),
  );
  await assert.rejects(f.call('task.create', { flowId: record.id }), /原任务/);
  const undone = await f.call('task.undo', f.identity(accepted));
  assert.equal(undone.flow, null);
  assert.deepEqual(undone.task.webTarget, d.task.webTarget);
  assert.equal(f.store.count('run'), 0);
});

test('web context counts toward both item and total text limits when selecting and editing', async (t) => {
  const f = fixture(t);
  const many = Array.from({ length: 20 }, (_, i) => ({
    id: 'c' + i,
    kind: 'text',
    label: 'text',
    text: '',
  }));
  let d = await f.create();
  d = await f.call('task.save', {
    ...f.identity(d),
    description: 'read',
    context: many,
    answers: {},
  });
  await assert.rejects(f.select(d), /至少一项/);
  const large = many.slice(0, 4).map((c) => ({ ...c, text: 'x'.repeat(50000) }));
  d = await f.call('task.save', {
    ...f.identity(d),
    description: 'read',
    context: large,
    answers: {},
  });
  await assert.rejects(f.select(d), /文本上限/);
  d = await f.call('task.save', {
    ...f.identity(d),
    description: 'read',
    context: [],
    answers: {},
  });
  d = await f.select(d);
  await assert.rejects(
    f.call('task.save', { ...f.identity(d), description: 'read', context: large, answers: {} }),
    /文本上限/,
  );
});

test('credential wait rejects refreshed sources before model dispatch and clear cancels late model output', async (t) => {
  const f = fixture(t);
  let d = await f.select(await f.create());
  const key = gate<string>();
  f.deps.key = () => key.promise;
  await f.start(d);
  f.state.page.documentRevision++;
  key.resolve('sk-fixture');
  await until(() => f.planning.detail(d.task.id).task.status === 'failed');
  assert.equal(f.state.requests.length, 0);
  d = await f.select(f.planning.detail(d.task.id));
  const held = gate<PlanningResult>();
  f.state.modelGate = held.promise;
  await f.start(d);
  await until(() => f.state.requests.length === 1);
  await f.call('task.web.clear', f.identity(d));
  held.resolve(result(f.state.requests[0]));
  await new Promise((r) => setImmediate(r));
  const after = f.planning.detail(d.task.id);
  assert.equal(after.task.status, 'draft');
  assert.equal(after.task.webTarget, undefined);
  assert.equal(after.proposal, undefined);
});

test('source changes after model dispatch or during adoption cannot produce or save a stale plan', async (t) => {
  const f = fixture(t);
  let d = await f.select(await f.create());
  const held = gate<PlanningResult>();
  f.state.modelGate = held.promise;
  await f.start(d);
  await until(() => f.state.requests.length === 1);
  f.state.page.documentRevision++;
  held.resolve(result(f.state.requests[0]));
  await until(() => f.planning.detail(d.task.id).task.status === 'failed');
  assert.equal(f.planning.detail(d.task.id).proposal, undefined);
  f.state.modelGate = undefined;
  d = await f.generate(await f.select(f.planning.detail(d.task.id)));
  const wait = gate<void>();
  f.state.pageGate = wait.promise;
  const adopting = f.adopt(d);
  await f.call('task.web.clear', f.identity(d));
  wait.resolve();
  await assert.rejects(adopting, /撤销|变化/);
  assert.equal(f.store.count('flow'), 0);
});

test('web policy rejects side effects recursively and allows only the chosen static or parameter URL', async (t) => {
  const f = fixture(t),
    d = await f.select(await f.create()),
    target = d.task.webTarget!;
  const base = result({ flowId: d.task.flowId } as any).flow!;
  const nav = {
    id: 'nav',
    type: 'browser',
    version: 1,
    operation: 'navigate',
    selector: '',
    value: target.page.url,
  } as const;
  assert.doesNotThrow(() => assertWebFlow({ ...base, steps: [nav] }, target));
  assert.doesNotThrow(() =>
    assertWebFlow(
      {
        ...base,
        parameters: { url: target.page.url },
        steps: [{ ...nav, value: { $ref: 'params.url' } }],
      },
      target,
    ),
  );
  const prohibited = [
    { ...nav, value: 'https://example.com/other' },
    { ...nav, value: { $ref: 'steps.dynamic' } },
    { ...nav, operation: 'fill' },
    { id: 'code', type: 'script' },
    { id: 'http', type: 'http' },
    { id: 'file', type: 'file', version: 1, operation: 'write' },
    { id: 'excel', type: 'excel' },
  ];
  for (const node of prohibited) {
    assert.throws(() => assertWebFlow({ ...base, steps: [node as Step] }, target));
    assert.throws(() =>
      assertWebFlow(
        {
          ...base,
          steps: [{ id: 'loop', type: 'loop', version: 1, items: [1], body: [node as Step] }],
        },
        target,
      ),
    );
  }
  f.deps.generate = async (input) => ({
    ...result(input),
    flow: { ...result(input).flow!, steps: [{ ...nav, operation: 'click' }] },
  });
  assert.equal((await f.generate(d)).task.status, 'failed');
});

test('run source rejects stale snapshots, revoked choices and a browser binding changed while awaiting Main', async (t) => {
  const f = fixture(t);
  const d = await f.adopt(await f.generate(await f.select(await f.create())));
  const old = structuredClone(d.flow!);
  const wait = gate<void>();
  f.state.pageGate = wait.promise;
  const checking = f.web.record(old);
  f.store.put('flow', old.id, { ...old, bindings: { ...old.bindings, browserId: 'chrome' } });
  wait.resolve();
  await assert.rejects(checking, /绑定已变化/);
  f.state.pageGate = undefined;
  f.store.put('flow', old.id, old);
  await f.call('task.web.clear', f.identity(d));
  await assert.rejects(f.web.record(old), /撤销/);
  await assert.rejects(f.web.record({ ...old, webTarget: undefined }), /尚未采纳/);
  const next = await f.select(f.planning.detail(d.task.id));
  await assert.rejects(f.web.record(old), /撤销/);
  assert.notEqual(next.task.webTarget!.selectionId, old.webTarget!.selectionId);
});

test('adoption storage failure rolls back flow and keeps the source and proposal available', async (t) => {
  const f = fixture(t),
    d = await f.generate(await f.select(await f.create()));
  const before = f.planning.detail(d.task.id);
  const save = f.deps.save;
  f.deps.save = (flow, bindings) => {
    save(flow, bindings);
    throw new Error('fixture save failed');
  };
  await assert.rejects(f.adopt(d), /save failed/);
  assert.equal(f.store.count('flow'), 0);
  assert.deepEqual(f.planning.detail(d.task.id), before);
});
