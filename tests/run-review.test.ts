import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { chmod, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/host/store';
import { RunReview, type ReviewTemplate } from '../src/host/run-review';
import { executionVersion } from '../src/host/run-rerun';
import { validateFlow } from '../src/core/validate';
import { validateIPC } from '../src/shared/ipc';
import type {
  EmbeddedReview,
  RunReviewConfirmation,
  RunReviewInput,
  RunReviewPreview,
} from '../src/shared/run-review';
import type { Flow, FlowRecord, PreparedScripts, Run } from '../src/shared/types';
import type { RepairSelection } from '../src/shared/task-repair';
import { digest } from '../src/shared/utils';

const valueFlow = (): Flow => ({
  id: 'review-flow',
  name: '虚构试运行',
  formatVersion: '1.0',
  description: '',
  parameters: {},
  requiredCapabilities: [],
  steps: [{ id: 'value', type: 'value', version: 1, value: 'fixed' }],
});
const browser = {
  id: 'embedded',
  product: 'embedded' as const,
  version: 'fixture-1',
  executable: '/fictional/embedded',
};
const request = (p: RunReviewPreview, requestId = randomUUID()): RunReviewConfirmation => ({
  id: p.flow.id,
  debug: p.debug,
  task: p.task,
  token: p.token!,
  requestId,
  reviewed: true,
  ...(p.rerun ? { rerun: { runId: p.rerun.runId, reviewed: true as const } } : {}),
});
const kinds = [
  'flow',
  'version',
  'snapshot',
  'run',
  'flow-run-request',
  'schedule',
  'action',
  'attention',
  'ai-task',
];
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'flowark-review-unit-'));
  const store = new Store(join(directory, 'store.sqlite'), randomBytes(32));
  const state = {
    busy: '',
    target: async (selection: RepairSelection) => structuredClone(selection),
    epoch: 0,
    blocked: '',
    dispatched: 0,
    calls: 0,
    embedded: {
      resourceId: 'web-1',
      documentRevision: 1,
      started: true,
      loading: false,
      url: 'https://example.test/form',
      title: '虚构页面',
    } as EmbeddedReview,
    preflight: async (record: FlowRecord): Promise<PreparedScripts> => {
      validateFlow(record.flow);
      return { scripts: {}, scriptBundles: [] };
    },
    template: { resources: [], actions: [] } as ReviewTemplate,
  };
  const open = () =>
    new RunReview(store, {
      busy: (id) => state.busy === id,
      target: (selection) => state.target(selection),
      assertAdmitting: () => {
        if (state.blocked) throw new Error(state.blocked);
        if (store.fault) throw new Error(store.fault);
      },
      epoch: () => state.epoch,
      preflight: (record) => {
        state.calls++;
        return state.preflight(record);
      },
      embedded: async () => structuredClone(state.embedded),
      template: async () => structuredClone(state.template),
      version: (record, prepared) => {
        const id = executionVersion(record, prepared);
        store.put('version', id, { ...record, ...prepared });
        return id;
      },
      dispatch: () => {
        state.dispatched++;
      },
    });
  const record: FlowRecord = {
    id: 'review-flow',
    flow: valueFlow(),
    bindings: { files: {}, credentials: [] },
    updatedAt: new Date().toISOString(),
  };
  const save = () => store.put('flow', record.id, record);
  save();
  store.put('browser', browser.id, browser);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    store,
    state,
    record,
    save,
    service: open(),
    open,
    records: () => kinds.map((kind) => [kind, store.list(kind)]),
  };
}
function web(f: ReturnType<typeof fixture>) {
  f.record.bindings.browserId = browser.id;
  f.record.flow.steps = [
    {
      id: 'navigate',
      type: 'browser',
      version: 1,
      operation: 'navigate',
      selector: '',
      value: 'https://example.test/form',
    },
  ];
  f.save();
}
function template(f: ReturnType<typeof fixture>) {
  f.record.bindings.template = {
    instanceId: 'instance',
    packageKey: 'fictional',
    entryId: 'main',
    digest: 'a'.repeat(64),
  };
  f.record.bindings.resources = {};
  f.record.bindings.grants = {};
}

test('run review IPC requires explicit confirmation, strict selection, safe task revision and private Main boundary', () => {
  for (const debug of [undefined, false, true])
    assert.doesNotThrow(() =>
      validateIPC('flow.run.preview', { id: 'flow', debug, task: { id: 'task', revision: 1 } }),
    );
  const input = { id: 'flow', token: 'a'.repeat(64), requestId: randomUUID(), reviewed: true };
  assert.deepEqual(validateIPC('flow.run.confirm', input), input);
  for (const change of [
    { reviewed: false },
    { reviewed: undefined },
    { requestId: 'new' },
    { token: 'A'.repeat(64) },
    { token: '0'.repeat(63) },
    { debug: 'true' },
    { id: '' },
    { flow: {} },
    { bindings: {} },
    { resumeFrom: 'last' },
    { task: { id: 'task', revision: 0 } },
    { task: { id: 'task', revision: Number.MAX_SAFE_INTEGER + 1 } },
    { task: { id: 'task', revision: 1, flow: {} } },
  ])
    assert.throws(() => validateIPC('flow.run.confirm', { ...input, ...change }));
  assert.throws(() => validateIPC('flow.run.preview', { id: 'flow', token: input.token }));
  assert.throws(() => validateIPC('browser.embedded.review', {}), /白名单/);
  assert.throws(
    () => validateIPC('flow.run.confirm', { ...input, extra: 'x'.repeat(2 * 1024 * 1024) }),
    /2 MiB/,
  );
});

test('preview is read-only; confirmation fixes a version and duplicate request returns the original run after session replacement', async (t) => {
  const f = fixture(t),
    before = f.records();
  const p = await f.service.preview({ id: f.record.id });
  assert.equal(p.ready, true);
  assert.match(p.token!, /^[a-f0-9]{64}$/);
  assert.deepEqual(f.records(), before);
  const args = request(p),
    run = await f.service.confirm(args);
  assert.equal(run.state, 'QUEUED');
  assert.ok(run.review);
  assert.equal(run.versionId, p.flow.versionId);
  assert.equal(f.store.events(run.id).length, 1);
  assert.equal(f.store.list('run').length, 1);
  assert.deepEqual(await f.service.confirm(args), run);
  assert.equal(f.state.dispatched, 1);
  f.state.blocked = '正在退出';
  assert.deepEqual(await f.open().confirm(args), run);
  await assert.rejects(f.open().confirm({ ...args, debug: true }), /不同/);
  f.state.blocked = '';
  await assert.rejects(f.open().confirm(request(p)), /过期/);
  assert.equal(f.store.list('run').length, 1);
});

test('forged tokens, changed flow, debug selection and suspension epoch cannot start a run', async (t) => {
  const f = fixture(t),
    p = await f.service.preview({ id: f.record.id });
  await assert.rejects(f.service.confirm({ ...request(p), token: '0'.repeat(64) }), /过期/);
  await assert.rejects(f.service.confirm({ ...request(p), debug: true }), /过期/);
  f.state.epoch++;
  await assert.rejects(f.service.confirm(request(p)), /过期/);
  const current = await f.service.preview({ id: f.record.id });
  f.record.flow.parameters.new = true;
  f.save();
  await assert.rejects(f.service.confirm(request(current)), /过期/);
  assert.equal(f.store.list('run').length, 0);
});

test('preflight failure and missing resources are real diagnostics without a confirmable token or persistent effects', async (t) => {
  const f = fixture(t);
  f.record.flow.steps = [
    {
      id: 'read',
      type: 'file',
      operation: 'read',
      version: 1,
      binding: 'work',
      name: 'input.txt',
      content: null,
    },
  ];
  f.save();
  const before = f.records(),
    missing = await f.service.preview({ id: f.record.id });
  assert.equal(missing.ready, false);
  assert.equal(missing.token, undefined);
  assert.match(missing.checks[0].detail, /目录未绑定/);
  assert.deepEqual(f.records(), before);
  f.record.bindings.files.work = f.directory;
  f.save();
  f.state.preflight = async () => {
    throw new Error('未配置凭据：fixture-key');
  };
  const failed = await f.service.preview({ id: f.record.id });
  assert.equal(failed.ready, false);
  assert.match(failed.checks[0].detail, /未配置凭据/);
  assert.equal(f.store.list('run').length, 0);
});

test('task revision, association, pending proposal and active generation must be resolved before confirmation', async (t) => {
  const f = fixture(t);
  const task = { id: 'task', revision: 1, flowId: f.record.id, status: 'draft' };
  f.store.put('ai-task', task.id, task);
  const args: RunReviewInput = { id: f.record.id, task: { id: task.id, revision: 1 } };
  const p = await f.service.preview(args);
  assert.equal(p.ready, true);
  for (const changes of [
    { revision: 2 },
    { flowId: 'other' },
    { status: 'generating' },
    { proposal: { id: 'pending' } },
  ]) {
    f.store.put('ai-task', task.id, { ...task, ...changes });
    const stale = await f.service.preview(args);
    assert.equal(stale.ready, false);
    await assert.rejects(f.service.confirm(request(p)));
  }
  assert.equal(f.store.list('run').length, 0);
});

test('asynchronous preflight rechecks flow and same-URL browser document identity', async (t) => {
  const f = fixture(t);
  web(f);
  f.state.preflight = async () => {
    f.state.embedded.documentRevision++;
    return { scripts: {}, scriptBundles: [] };
  };
  const changedWeb = await f.service.preview({ id: f.record.id });
  assert.equal(changedWeb.ready, false);
  assert.match(changedWeb.checks[0].detail, /检查期间/);
  f.state.preflight = async () => {
    f.record.flow.description += 'changed';
    f.save();
    return { scripts: {}, scriptBundles: [] };
  };
  const changedFlow = await f.service.preview({ id: f.record.id });
  assert.equal(changedFlow.ready, false);
  assert.equal(f.store.list('run').length, 0);
});

test('browser loading, document navigation, replaced resource and changed browser binding invalidate review', async (t) => {
  const f = fixture(t);
  web(f);
  const p = await f.service.preview({ id: f.record.id });
  assert.equal(p.ready, true);
  f.state.embedded.documentRevision++;
  await assert.rejects(f.service.confirm(request(p)), /过期/);
  let current = await f.service.preview({ id: f.record.id });
  f.state.embedded.resourceId = 'web-2';
  await assert.rejects(f.service.confirm(request(current)), /过期/);
  current = await f.service.preview({ id: f.record.id });
  f.store.put('browser', browser.id, { ...browser, version: 'changed' });
  await assert.rejects(f.service.confirm(request(current)), /过期/);
  f.state.embedded.loading = true;
  const loading = await f.service.preview({ id: f.record.id });
  assert.equal(loading.ready, false);
  assert.match(loading.checks[0].detail, /加载/);
  assert.equal(f.store.list('run').length, 0);
});

test('directory real identity detects same-path replacement and symlink redirection without tracking unrelated contents', async (t) => {
  const f = fixture(t),
    first = join(f.directory, 'first'),
    second = join(f.directory, 'second'),
    selected = join(f.directory, 'selected');
  mkdirSync(first);
  mkdirSync(second);
  await symlink(first, selected);
  f.record.flow.steps = [
    {
      id: 'write',
      type: 'file',
      operation: 'write',
      version: 1,
      binding: 'work',
      name: 'out.txt',
      content: 'new',
    },
  ];
  f.record.bindings.files.work = selected;
  f.save();
  const p = await f.service.preview({ id: f.record.id });
  assert.equal(p.ready, true);
  await writeFile(join(first, 'unrelated.txt'), 'keep');
  const stable = await f.service.preview({ id: f.record.id });
  assert.equal(p.token, stable.token);
  await unlink(selected);
  await symlink(second, selected);
  await assert.rejects(f.service.confirm(request(p)), /过期/);
  const redirected = await f.service.preview({ id: f.record.id });
  await rename(second, second + '-old');
  mkdirSync(second);
  await assert.rejects(f.service.confirm(request(redirected)), /过期/);
  assert.equal(f.store.list('run').length, 0);
});

test('template file content identity and action modes remain authoritative; reviewed confirm mode is not promoted', async (t) => {
  const f = fixture(t),
    path = join(f.directory, 'input.txt');
  writeFileSync(path, 'input');
  template(f);
  f.state.template = {
    resources: [{ id: 'input', name: '输入文件', kind: 'file', access: 'read', required: true }],
    actions: [{ id: 'write', name: '写入结果', description: '产生外部更改' }],
  };
  f.record.bindings.resources!.input = { path };
  f.record.bindings.grants!.write = 'confirm';
  f.save();
  const p = await f.service.preview({ id: f.record.id });
  assert.equal(p.ready, true);
  assert.equal(p.resources.find((r) => r.kind === 'action')?.access, 'confirm');
  await writeFile(path, 'modified input file');
  await assert.rejects(f.service.confirm(request(p)), /过期/);
  const current = await f.service.preview({ id: f.record.id });
  f.record.bindings.grants!.write = 'deny';
  f.save();
  await assert.rejects(f.service.confirm(request(current)), /尚未授权/);
  f.record.bindings.grants!.write = 'confirm';
  f.save();
  const approved = await f.service.preview({ id: f.record.id });
  const run = await f.service.confirm(request(approved));
  assert.equal(f.store.get<FlowRecord>('snapshot', run.id)!.bindings.grants!.write, 'confirm');
});

test('required resource kind and filesystem read/write checks do not create test files', async (t) => {
  const f = fixture(t),
    path = join(f.directory, 'resource.txt');
  writeFileSync(path, 'keep');
  template(f);
  f.state.template.resources = [
    { id: 'resource', name: '工作目录', kind: 'directory', access: 'write', required: true },
  ];
  f.record.bindings.resources!.resource = { path };
  f.save();
  assert.equal((await f.service.preview({ id: f.record.id })).ready, false);
  f.record.bindings.resources!.resource.path = f.directory;
  f.save();
  assert.equal((await f.service.preview({ id: f.record.id })).ready, true);
  f.state.template.resources[0].kind = 'file';
  f.record.bindings.resources!.resource.path = path;
  f.save();
  await chmod(path, 0o400);
  try {
    assert.equal((await f.service.preview({ id: f.record.id })).ready, process.getuid?.() === 0);
  } finally {
    await chmod(path, 0o600);
  }
  assert.equal(f.store.list('run').length, 0);
});

test('transaction failure rolls back version, snapshot, Run, event and duplicate-request record together', async (t) => {
  const f = fixture(t),
    p = await f.service.preview({ id: f.record.id }),
    before = f.records();
  const put = f.store.put.bind(f.store);
  f.store.put = (kind, id, value) => {
    if (kind === 'flow-run-request') throw new Error('fixture transaction failure');
    put(kind, id, value);
  };
  await assert.rejects(f.service.confirm(request(p)), /fixture transaction/);
  f.store.put = put;
  assert.deepEqual(f.records(), before);
  assert.equal(f.state.dispatched, 0);
  const count = (f.store as any).db.prepare('SELECT count(*) AS n FROM events').get().n;
  assert.equal(count, 0);
});

test('queued review permits later draft body changes but rejects authorization or resource identity changes', async (t) => {
  const f = fixture(t);
  web(f);
  const p = await f.service.preview({ id: f.record.id }),
    run = await f.service.confirm(request(p));
  const snapshot = f.store.get<FlowRecord>('snapshot', run.id)!;
  f.record.flow.name = 'later draft';
  f.record.flow.steps = valueFlow().steps;
  f.save();
  await assert.doesNotReject(f.service.checkExecution(run, snapshot));
  f.state.embedded.documentRevision++;
  await assert.rejects(f.service.checkExecution(run, snapshot), /资源或网页/);
  f.state.embedded.documentRevision--;
  f.record.bindings.browserId = 'another';
  f.save();
  await assert.rejects(f.service.checkExecution(run, snapshot), /浏览器绑定/);
});

test('nested effects include both branches, loops, uploads, downloads and overwrites without invented counts', async (t) => {
  const f = fixture(t);
  f.record.flow.steps = [
    {
      id: 'choose',
      type: 'condition',
      version: 1,
      actual: true,
      operator: 'equals',
      expected: true,
      then: [
        {
          id: 'write',
          type: 'file',
          operation: 'write',
          version: 1,
          binding: 'work',
          name: 'out',
          content: 'x',
        },
      ],
      else: [
        {
          id: 'each',
          type: 'loop',
          version: 1,
          items: [],
          body: [
            {
              id: 'upload',
              type: 'browser',
              version: 1,
              operation: 'upload',
              selector: '#upload',
              value: { binding: 'work', name: 'input' },
            },
            {
              id: 'download',
              type: 'browser',
              version: 1,
              operation: 'download',
              selector: '#download',
              value: null,
            },
          ],
        },
      ],
    },
  ];
  f.record.bindings.files.work = f.directory;
  f.record.bindings.browserId = browser.id;
  f.save();
  const p = await f.service.preview({ id: f.record.id });
  assert.equal(p.ready, true);
  assert.deepEqual(
    p.effects.map((e) => e.nodeId),
    ['choose', 'write', 'each', 'upload', 'download'],
  );
  assert.match(p.effects[1].detail, /覆盖/);
  assert.match(p.effects[3].detail, /上传/);
  assert.match(p.effects[4].detail, /产物目录/);
  assert.equal(p.flow.stepCount, 5);
});

test('explicit rejection differs from unknown storage and a post-commit failure still returns the created Run', async (t) => {
  const f = fixture(t),
    p = await f.service.preview({ id: f.record.id });
  const rejected = await f.service.confirmOutcome(
    { ...request(p), token: '0'.repeat(64) },
    () => {},
  );
  assert.ok('rejected' in rejected && rejected.rejected);
  assert.equal(f.store.list('run').length, 0);
  f.state.blocked = '正在退出';
  f.store.fault = 'fixture storage fault';
  await assert.rejects(
    f.service.confirmOutcome(request(p), () => {}),
    /退出/,
  );
  f.store.fault = undefined;
  f.state.blocked = '';
  (f.service as any).deps.dispatch = () => {
    throw new Error('fixture dispatch reply failure');
  };
  const input = request(p),
    created = await f.service.confirmOutcome(input, () => {});
  assert.ok('id' in created);
  assert.equal(f.store.list('run').length, 1);
  assert.deepEqual(await f.service.confirmOutcome(input, () => {}), created);
});

test('full reviewed rerun binds task and source, preserves old evidence and deduplicates confirmation', async (t) => {
  const f = fixture(t);
  f.store.put('ai-task', 'task', { id: 'task', flowId: f.record.id, revision: 1, status: 'draft' });
  const original = await f.service.confirm(
    request(await f.service.preview({ id: f.record.id, task: { id: 'task', revision: 1 } })),
  );
  assert.deepEqual(original.task, { id: 'task', revision: 1 });
  f.store.state(original.id, 'FAILED');
  const before = {
    run: f.store.get('run', original.id),
    snapshot: f.store.get('snapshot', original.id),
    events: f.store.events(original.id),
  };
  const selected: RunReviewInput = {
    id: f.record.id,
    task: { id: 'task', revision: 1 },
    rerun: { runId: original.id, reviewed: true },
  };
  assert.throws(() =>
    validateIPC('flow.run.preview', {
      ...selected,
      rerun: { runId: original.id, reviewed: false },
    }),
  );
  assert.equal((await f.service.preview({ ...selected, task: undefined })).ready, false);
  f.state.busy = original.id;
  assert.equal((await f.service.preview(selected)).ready, false);
  f.state.busy = '';
  const p = await f.service.preview(selected);
  assert.equal(p.ready, true);
  assert.equal(f.store.list('run').length, 1);
  const confirmation = request(p);
  const next = await f.service.confirm(confirmation);
  assert.equal((await f.service.confirm(confirmation)).id, next.id);
  assert.equal(next.rerun?.runId, original.id);
  assert.equal(next.rerun?.mode, 'saved');
  assert.deepEqual(next.task, { id: 'task', revision: 1 });
  assert.deepEqual(
    {
      run: f.store.get('run', original.id),
      snapshot: f.store.get('snapshot', original.id),
      events: f.store.events(original.id),
    },
    before,
  );
  assert.equal(f.store.list('run').length, 2);
  assert.ok(f.store.get<any>('snapshot', next.id).runReviewAuthorization);
});

test('adopted repair target is read from Host and revalidated during review, confirmation and queued execution', async (t) => {
  const f = fixture(t);
  const target: RepairSelection = {
    requestId: randomUUID(),
    resourceId: 'web-1',
    documentRevision: 1,
    url: 'https://example.test/form',
    title: '虚构页面',
    target: {
      selector: '#title',
      framePath: [],
      label: 'Title',
      tag: 'h1',
      inputType: '',
      structural: false,
    },
  };
  const task = {
    id: 'task',
    flowId: f.record.id,
    revision: 1,
    status: 'draft',
    appliedRepair: {
      proposalId: 'proposal',
      runId: 'source',
      nodeId: 'value',
      selection: target,
      flowHash: digest({ flow: f.record.flow, bindings: f.record.bindings }),
    },
  };
  f.store.put('ai-task', 'task', task);
  const input = { id: f.record.id, task: { id: 'task', revision: 1 } };
  const p = await f.service.preview(input);
  assert.equal(p.ready, true);
  f.state.target = async () => {
    throw new Error('target changed');
  };
  await assert.rejects(f.service.confirm(request(p)), /target changed/);
  assert.equal(f.store.list('run').length, 0);
  f.state.target = async (s) => structuredClone(s);
  const run = await f.service.confirm(request(await f.service.preview(input)));
  const snapshot = f.store.get<any>('snapshot', run.id);
  assert.deepEqual(snapshot.runReviewAuthorization.target, target);
  await f.service.checkExecution(run, snapshot);
  f.state.target = async (s) => ({ ...s, documentRevision: 2 });
  await assert.rejects(f.service.checkExecution(run, snapshot), /目标已变化/);
  f.state.target = async (s) => structuredClone(s);
  f.record.bindings.files.extra = '/manual';
  f.save();
  assert.equal((await f.service.preview(input)).ready, false);
  assert.equal(f.store.list('run').length, 1);
});
