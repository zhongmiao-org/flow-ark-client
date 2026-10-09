import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, realpath, mkdir, rm, rename, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/host/store';
import { Planning } from '../src/host/planning';
import { TaskOutputs } from '../src/host/task-output';
import { validateIPC } from '../src/shared/ipc';
import { taskPlanningContext } from '../src/shared/planning-context';
import {
  assertOutputFlow,
  OUTPUT_BINDING,
  OUTPUT_CONTEXT_ID,
  outputContext,
} from '../src/shared/task-output';
import { assertWebFlow, type TaskWebTarget } from '../src/shared/task-web-target';
import { planningFlowHash } from '../src/host/planning-scope';
import { executionVersion } from '../src/host/run-rerun';
import type { Flow, FlowRecord } from '../src/shared/types';
import type { PlanningInput, PlanningResult, TaskDetail } from '../src/shared/planning';

const defer = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const identity = (d: TaskDetail) => ({ id: d.task.id, revision: d.task.revision });
async function until(check: () => boolean) {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) throw new Error('planning did not settle');
    await new Promise((r) => setTimeout(r, 5));
  }
}
async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'flowark-task-output-')));
  const directory = join(root, 'private-local-output');
  await mkdir(directory);
  const store = new Store(join(root, 'store.sqlite'), randomBytes(32));
  const native = { choose: async (): Promise<string | null> => directory, busy: false };
  const output = new TaskOutputs(store, {
    choose: () => native.choose(),
    assertSelectable: () => {
      if (native.busy) throw new Error('运行未结束');
    },
  });
  const requests: PlanningInput[] = [];
  const deps = {
    output,
    key: async () => 'fictional-key',
    assertAvailable() {},
    generate: async (input: PlanningInput): Promise<PlanningResult> => {
      requests.push(input);
      const selected = input.context.find((c) => c.id === OUTPUT_CONTEXT_ID);
      const choice = selected ? JSON.parse(selected.text) : undefined;
      return {
        formatVersion: '1.0',
        kind: 'plan',
        summary: 'text output',
        questions: [],
        limitations: [],
        flow: {
          id: input.flowId,
          formatVersion: '1.0',
          name: 'text output',
          description: '',
          parameters: {},
          requiredCapabilities:
            choice?.onConflict === 'number' ? ['file-create-numbered-v1'] : ['file'],
          steps: choice
            ? [
                {
                  id: 'save',
                  type: 'file',
                  binding: OUTPUT_BINDING,
                  name: choice.name,
                  content: 'fixture text',
                  ...(choice.onConflict === 'number'
                    ? { version: 4, operation: 'create', onConflict: 'number' }
                    : { version: 1, operation: 'write' }),
                },
              ]
            : [{ id: 'value', type: 'value', version: 1, value: 'no output' }],
        },
      };
    },
    save: (flow: Flow, bindings: FlowRecord['bindings']) => {
      const r = { id: flow.id, flow, bindings, updatedAt: new Date().toISOString() };
      store.put('flow', flow.id, r);
      return r;
    },
  };
  const planning = new Planning(store, deps);
  t.after(async () => {
    planning.cancelAll();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const call = (method: string, args: any = {}): Promise<TaskDetail> =>
    planning.request(method, args);
  let d = await call('task.create');
  d = await call('task.save', {
    ...identity(d),
    description: 'save text',
    context: [],
    answers: {},
  });
  const choose = (d: TaskDetail, onConflict = 'number', name = 'result.txt') =>
    call('task.output.choose', { ...identity(d), onConflict, name });
  const generate = async (d: TaskDetail) => {
    await call('task.generate', {
      ...identity(d),
      provider: 'deepseek',
      model: 'fixture',
      reviewed: true,
    });
    await until(() => planning.detail(d.task.id).task.status !== 'generating');
    return planning.detail(d.task.id);
  };
  const adopt = (d: TaskDetail) =>
    call('task.adopt', { ...identity(d), proposalId: d.proposal!.id });
  return {
    root,
    directory,
    store,
    native,
    deps,
    output,
    planning,
    requests,
    call,
    d,
    choose,
    generate,
    adopt,
  };
}

test('strict output IPC rejects path/proof injection, invalid names, hidden policies and reserved model context', () => {
  const args = { id: 'task', revision: 1, name: 'result.txt', onConflict: 'number' };
  assert.deepEqual(validateIPC('task.output.choose', args), args);
  assert.throws(() => validateIPC('task.output.directory', {}));
  for (const extra of [
    { directory: '/tmp/hidden' },
    { selectionId: 'forged' },
    { name: '../x' },
    { name: 'a/b' },
    { name: 'a\\b' },
    { name: '.' },
    { name: '' },
    { onConflict: 'auto' },
    { revision: 0 },
  ])
    assert.throws(() => validateIPC('task.output.choose', { ...args, ...extra }));
  assert.throws(() =>
    validateIPC('task.save', {
      id: 't',
      revision: 1,
      description: '',
      answers: {},
      context: [{ id: OUTPUT_CONTEXT_ID, kind: 'text', label: 'forged', text: '{}' }],
    }),
  );
});

test('cancel leaves task unchanged; path never enters provider input and adoption binds only chosen output with undo', async (t) => {
  const f = await fixture(t);
  f.native.choose = async () => null;
  assert.deepEqual(await f.choose(f.d), f.d);
  assert.equal(f.store.count('flow'), 0);
  f.native.choose = async () => f.directory;
  let d = await f.choose(f.d);
  assert.equal(d.task.outputTarget!.directory, f.directory);
  assert.equal(d.task.revision, f.d.task.revision + 1);
  d = await f.generate(d);
  assert.equal(d.task.status, 'plan', d.task.error);
  assert.equal(JSON.stringify(f.requests).includes(f.directory), false);
  assert.equal(JSON.stringify(f.requests).includes(d.task.outputTarget!.selectionId), false);
  assert.deepEqual(f.requests[0].context, [outputContext(d.task.outputTarget!)]);
  d = await f.adopt(d);
  assert.equal(d.flow!.bindings.files[OUTPUT_BINDING], f.directory);
  assert.deepEqual(d.flow!.outputTarget, d.task.outputTarget);
  await f.output.record(d.flow!);
  const changed = {
    ...d.flow!,
    outputTarget: { ...d.task.outputTarget!, selectionId: 'different' },
  };
  assert.notEqual(planningFlowHash(d.flow), planningFlowHash(changed));
  assert.notEqual(
    executionVersion(d.flow!, { scripts: {}, scriptBundles: [] }),
    executionVersion(changed, { scripts: {}, scriptBundles: [] }),
  );
  const undone = await f.call('task.undo', identity(d));
  assert.equal(undone.flow, null);
  assert.deepEqual(undone.task.outputTarget, d.task.outputTarget);
  assert.equal(f.store.count('run'), 0);
});

test('late directory replies, cancellation, concurrent choices and running transition never overwrite newer task state', async (t) => {
  const f = await fixture(t);
  const pending = defer<string | null>();
  f.native.choose = () => pending.promise;
  const chosen = f.choose(f.d);
  await f.call('task.save', { ...identity(f.d), description: 'newer', context: [], answers: {} });
  pending.resolve(f.directory);
  await assert.rejects(chosen, /变化/);
  let d = f.planning.detail(f.d.task.id);
  assert.equal(d.task.outputTarget, undefined);
  const late = defer<string | null>();
  f.native.choose = () => late.promise;
  const cancelled = f.choose(d);
  await f.call('task.cancel', { id: d.task.id });
  late.resolve(f.directory);
  await assert.rejects(cancelled, /取消/);
  f.native.choose = async () => f.directory;
  const concurrent = await Promise.allSettled([f.choose(d), f.choose(d)]);
  assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter((r) => r.status === 'rejected').length, 1);
  d = f.planning.detail(d.task.id);
  const busyReply = defer<string | null>();
  f.native.choose = () => busyReply.promise;
  const busy = f.choose(d);
  f.native.busy = true;
  busyReply.resolve(f.directory);
  await assert.rejects(busy, /运行/);
  assert.deepEqual(f.planning.detail(d.task.id), d);
});

test('combined system contexts obey the total budget and failed choice does not alter a draft', async (t) => {
  const f = await fixture(t);
  const context = Array.from({ length: 20 }, (_, i) => ({
    id: 'c' + i,
    kind: 'text' as const,
    label: 'source',
    text: '',
  }));
  const d = await f.call('task.save', {
    ...identity(f.d),
    description: 'context',
    context,
    answers: {},
  });
  await assert.rejects(f.choose(d), /20/);
  assert.deepEqual(f.planning.detail(d.task.id), d);
  const selected = await f.choose(
    await f.call('task.save', { ...identity(d), description: 'context', context: [], answers: {} }),
  );
  const output = selected.task.outputTarget!;
  assert.throws(
    () =>
      taskPlanningContext(
        [{ id: 'a', kind: 'text', label: 'x', text: 'x'.repeat(50001) }],
        undefined,
        output,
      ),
    /上限/,
  );
  await assert.rejects(
    f.call('task.save', { ...identity(selected), description: 'context', context, answers: {} }),
    /20/,
  );
});

test('changing output cancels in-flight generation and rejects delayed credentials and model results', async (t) => {
  const f = await fixture(t);
  let d = await f.choose(f.d);
  const key = defer<string>();
  f.deps.key = () => key.promise;
  await f.call('task.generate', {
    ...identity(d),
    provider: 'deepseek',
    model: 'fixture',
    reviewed: true,
  });
  d = await f.call('task.output.configure', {
    ...identity(d),
    name: 'changed.txt',
    onConflict: 'overwrite',
  });
  key.resolve('key');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(f.requests.length, 0);
  assert.equal(f.planning.detail(d.task.id).proposal, undefined);
  f.deps.key = async () => 'key';
  const result = defer<PlanningResult>();
  let called = false;
  f.deps.generate = async () => {
    called = true;
    return result.promise;
  };
  await f.call('task.generate', {
    ...identity(d),
    provider: 'deepseek',
    model: 'fixture',
    reviewed: true,
  });
  await until(() => called);
  d = await f.call('task.output.clear', identity(d));
  result.resolve({
    formatVersion: '1.0',
    kind: 'unsupported',
    summary: 'late',
    questions: [],
    limitations: [],
    flow: null,
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(f.planning.detail(d.task.id), d);
});

test('policy validates fixed static output, nested steps and the precise independently authorized webpage overwrite', async (t) => {
  const f = await fixture(t);
  let d = await f.generate(await f.choose(f.d));
  const target = d.task.outputTarget!,
    flow = d.proposal!.result.flow!;
  for (const extra of [
    { name: 'another.txt' },
    { name: { $ref: 'params.name' } },
    { version: 3, onConflict: undefined },
    { binding: 'different' },
    { version: 1, operation: 'read', onConflict: undefined },
  ]) {
    assert.throws(() =>
      assertOutputFlow({ ...flow, steps: [{ ...flow.steps[0], ...extra } as any] }, target),
    );
  }
  d = await f.call('task.output.configure', {
    ...identity(d),
    name: 'fixed.txt',
    onConflict: 'overwrite',
  });
  d = await f.generate(d);
  assert.equal(d.task.status, 'plan', d.task.error);
  assert.throws(
    () =>
      assertOutputFlow(
        {
          ...d.proposal!.result.flow!,
          steps: [
            { ...d.proposal!.result.flow!.steps[0], content: { unexpected: 'object' } } as any,
          ],
        },
        d.task.outputTarget!,
      ),
    /文本/,
  );
  const web: TaskWebTarget = {
    selectionId: 'web',
    taskId: d.task.id,
    selectedAt: 'now',
    browserId: 'embedded',
    access: 'read',
    page: {
      resourceId: 'page',
      documentRevision: 1,
      url: 'https://example.com/',
      title: 'example',
    },
  };
  assert.throws(() => assertWebFlow(d.proposal!.result.flow!, web), /只允许/);
  assert.doesNotThrow(() => assertWebFlow(d.proposal!.result.flow!, web, d.task.outputTarget));
  assert.doesNotThrow(() => assertOutputFlow(d.proposal!.result.flow!, d.task.outputTarget!));
  const upload: any = {
    id: 'u',
    type: 'browser',
    version: 3,
    operation: 'upload',
    selector: 'input',
    value: { binding: OUTPUT_BINDING, name: 'fixed.txt' },
  };
  assert.throws(
    () => assertOutputFlow({ ...flow, steps: [flow.steps[0], upload] }, target),
    /上传/,
  );
});

test('manual binding conflict and store failure preserve original resources and proposal; clear removes only prior host output', async (t) => {
  const f = await fixture(t);
  let d = await f.choose(f.d);
  const manual: FlowRecord = {
    id: d.task.flowId,
    updatedAt: 'before',
    flow: {
      id: d.task.flowId,
      formatVersion: '1.0',
      name: 'original',
      description: '',
      parameters: {},
      requiredCapabilities: ['value'],
      steps: [{ id: 'v', type: 'value', version: 1, value: 1 }],
    },
    bindings: {
      credentials: ['kept'],
      files: { input: '/unchanged-input', [OUTPUT_BINDING]: '/unrelated-manual-output' },
    },
  };
  f.store.put('flow', manual.id, manual);
  d = await f.generate(d);
  await assert.rejects(f.adopt(d), /冲突/);
  assert.deepEqual(f.store.get('flow', manual.id), manual);
  delete manual.bindings.files[OUTPUT_BINDING];
  f.store.put('flow', manual.id, manual);
  d = await f.generate(d);
  const original = f.store.put.bind(f.store);
  f.store.put = (kind, id, value) => {
    if (kind === 'ai-task') throw new Error('fixture write failure');
    return original(kind, id, value);
  };
  await assert.rejects(f.adopt(d), /write failure/);
  f.store.put = original;
  assert.deepEqual(f.store.get('flow', manual.id), manual);
  assert.ok(f.planning.detail(d.task.id).proposal);
  d = await f.adopt(d);
  assert.equal(d.flow!.bindings.files.input, '/unchanged-input');
  assert.deepEqual(d.flow!.bindings.credentials, ['kept']);
  const old = structuredClone(d.flow!);
  d = await f.call('task.output.clear', identity(d));
  await assert.rejects(f.output.record(old), /撤销/);
  d = await f.adopt(await f.generate(d));
  assert.equal(d.flow!.outputTarget, undefined);
  assert.equal(d.flow!.bindings.files[OUTPUT_BINDING], undefined);
  assert.equal(d.flow!.bindings.files.input, '/unchanged-input');
});

test('directory replacement, symlink overwrite, removed metadata and manual file rule edits fail execution checks', async (t) => {
  const f = await fixture(t);
  let d = await f.adopt(await f.generate(await f.choose(f.d)));
  const record = structuredClone(d.flow!);
  await assert.rejects(f.output.record({ ...record, outputTarget: undefined }), /尚未采纳/);
  await assert.rejects(
    f.output.record({
      ...record,
      flow: {
        ...record.flow,
        steps: [{ ...record.flow.steps[0], name: 'unauthorized.txt' } as any],
      },
    }),
    /固定文件名/,
  );
  await rename(f.directory, f.directory + '-old');
  await mkdir(f.directory);
  await assert.rejects(f.output.record(record), /不可用/);
  await rm(f.directory, { recursive: true });
  await rename(f.directory + '-old', f.directory);
  await writeFile(join(f.directory, 'other.txt'), 'preserve');
  await symlink('other.txt', join(f.directory, 'result.txt'));
  await assert.rejects(
    f.call('task.output.configure', {
      ...identity(d),
      name: 'result.txt',
      onConflict: 'overwrite',
    }),
    /不可用/,
  );
  assert.deepEqual(f.planning.detail(d.task.id), d);
});

test('two pre-existing tasks sharing one flow cannot acquire conflicting output ownership', async (t) => {
  const f = await fixture(t);
  const original = await f.adopt(await f.generate(f.d));
  const other = await f.call('task.create', { flowId: original.flow!.id });
  const first = await f.choose(original);
  await assert.rejects(f.choose(other), /其他任务/);
  assert.equal(f.planning.detail(other.task.id).task.outputTarget, undefined);
  const cleared = await f.call('task.output.clear', identity(first));
  assert.equal(cleared.task.outputTarget, undefined);
  const second = await f.choose(other);
  assert.ok(second.task.outputTarget);
  await assert.rejects(f.choose(cleared), /其他任务/);
});

test('clearing a selected output does not let a pre-existing task take over the still-bound flow', async (t) => {
  const f = await fixture(t);
  const original = await f.adopt(await f.generate(f.d));
  const other = await f.call('task.create', { flowId: original.flow!.id });
  const adopted = await f.adopt(await f.generate(await f.choose(original)));
  const cleared = await f.call('task.output.clear', identity(adopted));
  await assert.rejects(f.choose(other), /其他任务/);
  await f.adopt(await f.generate(cleared));
  assert.ok((await f.choose(other)).task.outputTarget);
});
