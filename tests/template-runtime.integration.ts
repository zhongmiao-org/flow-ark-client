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
  await runtime.templates.input(instance.id, 'run', { text: 'new portable input' });
  await assert.rejects(runtime.enqueue(instance.entryFlows.run), /授权/);
  const output = join(dir, 'output');
  await mkdir(output);
  const action = Object.keys(instance.grants)[0];
  await runtime.templates.configure(
    instance.id,
    instance.configuration,
    { output: { path: output } },
    { [action]: 'auto' },
  );
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
  await runtime.templates.configure(a.id, a.configuration, {}, { write: 'confirm' });
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
