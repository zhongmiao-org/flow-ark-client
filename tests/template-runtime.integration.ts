import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { Runtime } from '../src/host/runtime';
import { exportDefinition } from '../src/templates/export';
import { writeArchive } from '../src/templates/archive';
import { canonical, sha256, manifestDigest } from '../contracts/package-format';
async function wait(fn: () => any) {
  for (let i = 0; i < 600; i++) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('模板运行等待超时');
}
test('a custom workflow ZIP reinstalls with editable input and explicit file authorization before real execution', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'custom-zip-runtime-'));
  const runtime = new Runtime(
    dir,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  t.after(async () => {
    await runtime.shutdown();
    runtime.store.close();
    await rm(dir, { recursive: true, force: true });
  });
  await runtime.ready;
  const original: any = {
    id: 'custom',
    name: 'Custom file workflow',
    description: '',
    formatVersion: '1.0',
    parameters: { text: 'private original input' },
    requiredCapabilities: [],
    steps: [
      {
        id: 'write',
        type: 'file',
        version: 1,
        operation: 'write',
        binding: 'output',
        name: 'result.txt',
        content: { $ref: 'params.text' },
      },
    ],
  };
  const path = join(dir, 'custom.zip');
  await runtime.request('flow.export', { flow: original, reviewed: true, path });
  const installed = await runtime.request('template.install', {
    token: (await runtime.request('template.inspect', { path })).token,
  });
  const instance = await runtime.templates.create(installed.key);
  await assert.rejects(
    runtime.enqueue(instance.entryFlows.run),
    /参数|类型|数据|授权|schema|must/i,
  );
  await runtime.templates.save({
    id: instance.id,
    revision: (await runtime.templates.detail(instance.id)).revision,
    name: instance.name,
    configuration: instance.configuration,
    resources: instance.resources,
    grants: instance.grants,
    inputs: { run: { text: 'new portable input' } },
  });
  await assert.rejects(runtime.enqueue(instance.entryFlows.run), /授权/);
  const output = join(dir, 'output');
  await mkdir(output);
  const action = Object.keys(instance.grants)[0];
  await runtime.templates.save({
    id: instance.id,
    revision: (await runtime.templates.detail(instance.id)).revision,
    name: instance.name,
    configuration: instance.configuration,
    resources: { output: { path: output } },
    grants: { [action]: 'auto' },
    inputs: {},
  });
  const run = await runtime.enqueue(instance.entryFlows.run);
  await wait(() =>
    ['SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(runtime.store.get<any>('run', run.id)?.state),
  );
  assert.equal(runtime.store.get<any>('run', run.id).state, 'SUCCEEDED');
  assert.equal(await readFile(join(output, 'result.txt'), 'utf8'), 'new portable input');
  assert.equal(original.parameters.text, 'private original input');
});
test('real packaged scripts share only their instance state; human grants and persisted effects survive restart without replay', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'template-runtime-'));
  const key = randomBytes(32);
  const open = () =>
    new Runtime(dir, resolve('dist'), process.execPath, Buffer.from(key), async () => []);
  let runtime = open();
  t.after(async () => {
    await runtime.shutdown();
    runtime.store.close();
    await rm(dir, { recursive: true, force: true });
  });
  await runtime.ready;
  const code = `export default async ({template:t})=>{ const c=await t.configuration();const effect=await t.effect.prepare({action:'write',key:c.key});if(!effect.execute)return t.result({duplicate:true,state:effect.state});const s=await t.state.get();const next={count:(s.count||0)+1};await t.state.set(next);if(c.complete)await t.effect.resolve({id:effect.id,state:'confirmed',evidence:next});return t.result(next);}`;
  const pkg = await exportDefinition(
    {
      formatVersion: '1.0',
      id: 'fixture',
      name: 'Fixture',
      description: '',
      parameters: {},
      requiredCapabilities: ['script', 'state', 'effect'],
      steps: [
        {
          id: 'execute',
          type: 'script',
          version: 1,
          language: 'js',
          input: {},
          dependencies: [],
          code,
        },
      ],
    } as any,
    {
      schema: {
        type: 'object',
        properties: {
          key: { type: 'string', default: 'one' },
          complete: { type: 'boolean', default: false },
        },
        required: ['key', 'complete'],
        additionalProperties: false,
      },
    },
  );
  pkg.manifest.actions = [
    { id: 'write', name: 'Write', description: 'Test effect', default: 'deny' },
  ];
  pkg.manifest.entries[0].actions = ['write'];
  pkg.manifest.contentDigest = manifestDigest(pkg.manifest);
  pkg.files.set('manifest.json', Buffer.from(canonical(pkg.manifest)));
  const path = join(dir, 'fixture.zip');
  await writeArchive(pkg, path);
  const p = await runtime.request('template.install', {
    token: (await runtime.request('template.inspect', { path })).token,
  });
  const a = await runtime.templates.create(p.key),
    b = await runtime.templates.create(p.key);
  await assert.rejects(runtime.enqueue(a.entryFlows.run), /授权/);
  await runtime.templates.save({
    id: a.id,
    revision: (await runtime.templates.detail(a.id)).revision,
    name: a.name,
    configuration: a.configuration,
    resources: {},
    grants: { write: 'confirm' },
    inputs: {},
  });
  const run = await runtime.enqueue(a.entryFlows.run);
  const question = await wait(() =>
    runtime.store.list<any>('attention').find((x) => x.kind === 'template-input'),
  );
  await runtime.templates.answer(question.id, true);
  await wait(() => runtime.store.get<any>('run', run.id)?.state === 'SUCCEEDED');
  assert.deepEqual(runtime.store.get('template-state', a.id), { count: 1 });
  assert.deepEqual(runtime.store.get('template-state', b.id), {});
  assert.equal(runtime.store.list<any>('template-effect')[0].state, 'unknown');
  assert.deepEqual(runtime.store.get('template-result', run.id), { count: 1 });
  await runtime.shutdown();
  runtime.store.close();
  runtime = open();
  await runtime.ready;
  const next = await runtime.enqueue(a.entryFlows.run);
  await wait(() => runtime.store.get<any>('run', next.id)?.state === 'SUCCEEDED');
  assert.deepEqual(runtime.store.get('template-result', next.id), {
    duplicate: true,
    state: 'unknown',
  });
  assert.deepEqual(runtime.store.get('template-state', a.id), { count: 1 });
  const plan = await runtime.request('schedule.save', {
    flowId: a.entryFlows.run,
    intervalMinutes: 60,
    timezone: 'UTC',
  });
  const version = runtime.store.get<any>('version', plan.versionId);
  assert.equal(version.bindings.template.digest, pkg.manifest.contentDigest);
  await assert.rejects(runtime.templates.remove(p.key), /引用/);
});

test('atomic instance edits leave paused and queued runs and a fixed schedule on their original snapshot; reopen never executes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'template-editing-runtime-'));
  const key = randomBytes(32);
  const open = () =>
    new Runtime(dir, resolve('dist'), process.execPath, Buffer.from(key), async () => []);
  let runtime = open();
  t.after(async () => {
    await runtime.shutdown();
    runtime.store.close();
    await rm(dir, { recursive: true, force: true });
  });
  await runtime.ready;
  const pkg = await exportDefinition({
    id: 'fixture',
    name: 'Immutable input',
    description: '',
    formatVersion: '1.0',
    parameters: { text: 'before' },
    requiredCapabilities: ['value'],
    steps: [{ id: 'read', type: 'value', version: 1, value: { $ref: 'params.text' } }],
  } as any);
  const zip = join(dir, 'fixture.zip');
  await writeArchive(pkg, zip);
  const installed = await runtime.request('template.install', {
    token: (await runtime.request('template.inspect', { path: zip })).token,
  });
  const instance = await runtime.templates.create(installed.key);
  const first = await runtime.templates.detail(instance.id);
  const saved = await runtime.request('template.save', {
    id: instance.id,
    revision: first.revision,
    name: instance.name,
    configuration: instance.configuration,
    resources: {},
    grants: {},
    inputs: { run: { text: 'before' } },
  });
  const active = await runtime.request('flow.run', { id: instance.entryFlows.run, debug: true });
  await wait(() => runtime.store.get<any>('run', active.id)?.state === 'PAUSED');
  const queued = await runtime.request('flow.run', { id: instance.entryFlows.run });
  assert.equal(runtime.store.get<any>('run', queued.id).state, 'QUEUED');
  const plan = await runtime.request('schedule.save', {
    flowId: instance.entryFlows.run,
    intervalMinutes: 60,
    timezone: 'UTC',
  });
  const kinds = ['run', 'snapshot', 'version', 'schedule'];
  const before = kinds.map((kind) => runtime.store.list(kind));
  const changed = await runtime.request('template.save', {
    id: instance.id,
    revision: saved.revision,
    name: 'Changed instance',
    configuration: instance.configuration,
    resources: {},
    grants: {},
    inputs: { run: { text: 'after' } },
  });
  assert.deepEqual(
    kinds.map((kind) => runtime.store.list(kind)),
    before,
  );
  assert.deepEqual(runtime.store.get<any>('version', plan.versionId).flow.parameters, {
    text: 'before',
  });
  assert.deepEqual(changed.entries[0].values, { text: 'after' });
  await runtime.control(active.id, 'resume');
  await wait(() => runtime.store.get<any>('run', queued.id)?.state === 'SUCCEEDED');
  assert.equal(runtime.store.get<any>('run', active.id).state, 'SUCCEEDED');
  for (const run of [active, queued]) {
    assert.deepEqual(runtime.store.get<any>('snapshot', run.id).flow.parameters, {
      text: 'before',
    });
    assert.deepEqual(runtime.store.get('output', run.id), { read: 'before' });
  }
  const finished = runtime.store.list('run');
  await runtime.shutdown();
  runtime.store.close();
  runtime = open();
  await runtime.ready;
  assert.deepEqual(runtime.store.list('run'), finished);
  assert.deepEqual(await runtime.templates.detail(instance.id), changed);
  await assert.rejects(
    runtime.request('template.input', { id: instance.id, entryId: 'run', value: {} }),
  );
  await assert.rejects(
    runtime.request('template.configure', { id: instance.id, configuration: {} }),
  );
});

async function launchFixture(t: import('node:test').TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'template-launch-'));
  const runtime = new Runtime(
    dir,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  t.after(async () => {
    await runtime.shutdown();
    runtime.store.close();
    await rm(dir, { recursive: true, force: true });
  });
  await runtime.ready;
  const pkg = await exportDefinition({
    id: 'launch',
    name: 'Launch fixture',
    description: '',
    formatVersion: '1.0',
    parameters: { text: 'old' },
    requiredCapabilities: ['value'],
    steps: [
      { id: 'first', type: 'value', version: 1, value: { $ref: 'params.text' } },
      { id: 'last', type: 'value', version: 1, value: { $ref: 'params.text' } },
    ],
  } as any);
  pkg.manifest.entries.push({
    ...pkg.manifest.entries[0],
    id: 'manual',
    name: 'Manual only',
    schedulable: false,
  });
  pkg.manifest.contentDigest = manifestDigest(pkg.manifest);
  pkg.files.set('manifest.json', Buffer.from(canonical(pkg.manifest)));
  const zip = join(dir, 'fixture.zip');
  await writeArchive(pkg, zip);
  const installed = await runtime.templates.install(
    (await runtime.templates.library.inspect(zip)).token,
  );
  const instance = await runtime.templates.create(installed.key);
  let detail = await runtime.templates.detail(instance.id);
  detail = await runtime.templates.save({
    id: instance.id,
    revision: detail.revision,
    name: instance.name,
    configuration: instance.configuration,
    resources: instance.resources,
    grants: instance.grants,
    inputs: { run: { text: 'old' }, manual: { text: 'manual' } },
  });
  return {
    runtime,
    instance,
    detail,
    source: { instanceId: instance.id, entryId: 'run', revision: detail.revision },
  };
}
test('template-source debug pauses first, preserves its snapshot, and plan creation never starts a Run', async (t) => {
  const { runtime, instance, detail, source } = await launchFixture(t);
  const args = { id: instance.entryFlows.run, debug: true, templateSource: source };
  const debug = await runtime.request('flow.run', args);
  await wait(() => runtime.store.get<any>('run', debug.id)?.state === 'PAUSED');
  assert.equal(
    runtime.store.events(debug.id).filter((event) => event.type === 'node-start').length,
    0,
  );
  const beforePlans = runtime.store.list('run').length;
  const plan = await runtime.request('schedule.save', {
    flowId: args.id,
    intervalMinutes: 60,
    timezone: 'UTC',
    templateSource: source,
  });
  assert.equal(runtime.store.list('run').length, beforePlans);
  assert.equal(plan.enabled, true);
  assert.ok(plan.nextAt > Date.now() + 59 * 60000);
  const changed = await runtime.templates.save({
    id: instance.id,
    revision: detail.revision,
    name: instance.name,
    configuration: instance.configuration,
    resources: instance.resources,
    grants: instance.grants,
    inputs: { run: { text: 'new' } },
  });
  assert.equal(runtime.store.get<any>('version', plan.versionId).flow.parameters.text, 'old');
  assert.equal(runtime.store.get<any>('snapshot', debug.id).flow.parameters.text, 'old');
  await runtime.request('run.control', { id: debug.id, action: 'step' });
  await wait(() => runtime.store.events(debug.id).some((event) => event.type === 'node-end'));
  await wait(() => runtime.store.get<any>('run', debug.id)?.state === 'PAUSED');
  await runtime.request('run.control', { id: debug.id, action: 'resume' });
  await wait(() => runtime.store.get<any>('run', debug.id)?.state === 'SUCCEEDED');
  assert.match(JSON.stringify(runtime.store.get('output', debug.id)), /old/);
  await assert.rejects(runtime.request('flow.run', args), /实例已变化/);
  const manual = await runtime.request('flow.run', {
    id: args.id,
    templateSource: { ...source, revision: changed.revision },
  });
  await wait(() => runtime.store.get<any>('run', manual.id)?.state === 'SUCCEEDED');
  assert.match(JSON.stringify(runtime.store.get('output', manual.id)), /new/);
  await assert.rejects(
    runtime.request('schedule.save', {
      flowId: instance.entryFlows.manual,
      intervalMinutes: 60,
      timezone: 'UTC',
      templateSource: { ...source, entryId: 'manual', revision: changed.revision },
    }),
    /不支持定时/,
  );
});
test('template source changed during asynchronous run or plan admission publishes nothing', async (t) => {
  const { runtime, instance } = await launchFixture(t);
  for (const method of ['flow.run', 'schedule.save']) {
    const detail = await runtime.templates.detail(instance.id);
    const source = { instanceId: instance.id, entryId: 'run', revision: detail.revision };
    const counts = Object.fromEntries(
      ['run', 'snapshot', 'version', 'schedule'].map((kind) => [
        kind,
        runtime.store.list(kind).length,
      ]),
    );
    let release!: () => void, entered!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const original = runtime.preflight.bind(runtime);
    runtime.preflight = async (record) => {
      const prepared = await original(record);
      entered();
      await barrier;
      return prepared;
    };
    const pending = runtime.request(method, {
      ...(method === 'flow.run'
        ? { id: instance.entryFlows.run }
        : { flowId: instance.entryFlows.run, intervalMinutes: 60, timezone: 'UTC' }),
      templateSource: source,
    });
    await reached;
    await runtime.templates.save({
      id: instance.id,
      revision: detail.revision,
      name: instance.name + ' changed',
      configuration: detail.instance.configuration,
      resources: detail.instance.resources,
      grants: detail.instance.grants,
      inputs: {},
    });
    release();
    await assert.rejects(pending, /实例已变化/);
    runtime.preflight = original;
    for (const [kind, count] of Object.entries(counts))
      assert.equal(runtime.store.list(kind).length, count, kind);
  }
});
