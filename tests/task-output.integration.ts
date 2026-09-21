import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  mkdtemp,
  realpath,
  mkdir,
  readFile,
  rm,
  writeFile,
  rename,
  access,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Runtime } from '../src/host/runtime';
import { OUTPUT_BINDING, OUTPUT_CONTEXT_ID } from '../src/shared/task-output';
import type { Run, FlowRecord } from '../src/shared/types';
import type { TaskDetail } from '../src/shared/planning';

async function until(check: () => boolean | Promise<boolean>) {
  const end = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('output runtime timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}
const identity = (d: TaskDetail) => ({ id: d.task.id, revision: d.task.revision });
async function fixture(t: TestContext) {
  const data = await realpath(await mkdtemp(join(tmpdir(), 'flowark-task-output-worker-')));
  const output = join(data, 'output');
  await mkdir(output);
  const control = {
    human: false,
    text: 'real Worker output 🧭',
    selected: output as string | null,
  };
  const requests: any[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const input = JSON.parse(JSON.parse(init.body as string).messages[1].content).request;
    requests.push(input);
    const choice = JSON.parse(input.context.find((c: any) => c.id === OUTPUT_CONTEXT_ID).text);
    const result = {
      formatVersion: '1.0',
      kind: 'plan',
      summary: 'local provider fixture',
      questions: [],
      limitations: [],
      flow: {
        id: input.flowId,
        formatVersion: '1.0',
        name: 'output selection integration',
        description: '',
        parameters: {},
        requiredCapabilities: [
          'human',
          choice.onConflict === 'number' ? 'file-create-numbered-v1' : 'file',
        ],
        steps: [
          ...(control.human
            ? [{ id: 'wait', type: 'human', version: 1, message: 'wait for fixture' }]
            : []),
          {
            id: 'save',
            type: 'file',
            binding: OUTPUT_BINDING,
            name: choice.name,
            content: control.text,
            ...(choice.onConflict === 'number'
              ? { version: 4, operation: 'create', onConflict: 'number' }
              : { version: 1, operation: 'write' }),
          },
        ],
      },
    };
    return Response.json({
      choices: [
        {
          finish_reason: 'stop',
          message: { content: JSON.stringify({ resultJson: JSON.stringify(result) }) },
        },
      ],
    });
  });
  const key = randomBytes(32);
  const system = async (method: string) => {
    if (method === 'task.output.directory') return control.selected;
    if (method === 'credentials.list') return ['deepseek'];
    if (method === 'credentials.get') return 'sk-local-fixture';
    if (method === 'notification' || method === 'browser.embedded.pick.cancel') return true;
    throw new Error('unexpected system call: ' + method);
  };
  let runtime = new Runtime(data, resolve('dist'), process.execPath, Buffer.from(key), system);
  await runtime.ready;
  t.after(async () => {
    await runtime.shutdown();
    runtime.store.close();
    key.fill(0);
    await rm(data, { recursive: true, force: true });
  });
  const call = (method: string, args: any = {}) => runtime.request(method, args);
  let d: TaskDetail = await call('task.create');
  d = await call('task.save', {
    ...identity(d),
    description: 'write selected text',
    context: [],
    answers: {},
  });
  d = await call('task.output.choose', {
    ...identity(d),
    name: 'result.txt',
    onConflict: 'number',
  });
  const adopt = async (d: TaskDetail) => {
    await call('task.generate', {
      ...identity(d),
      provider: 'deepseek',
      model: 'fixture',
      reviewed: true,
    });
    await until(() => runtime.planning.detail(d.task.id).task.status !== 'generating');
    const proposal = runtime.planning.detail(d.task.id);
    assert.equal(proposal.task.status, 'plan', proposal.task.error);
    return call('task.adopt', { ...identity(proposal), proposalId: proposal.proposal!.id });
  };
  const finished = async (run: Run, state = 'SUCCEEDED') => {
    await until(() =>
      ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(
        runtime.store.get<Run>('run', run.id)!.state,
      ),
    );
    assert.equal(
      runtime.store.get<Run>('run', run.id)!.state,
      state,
      JSON.stringify(await call('run.detail', { id: run.id })),
    );
    await until(async () => !(await call('bootstrap')).execution.active);
  };
  return {
    get runtime() {
      return runtime;
    },
    call,
    d,
    adopt,
    finished,
    output,
    data,
    control,
    requests,
    async reopen() {
      await runtime.shutdown();
      runtime.store.close();
      runtime = new Runtime(data, resolve('dist'), process.execPath, Buffer.from(key), system);
      await runtime.ready;
    },
  };
}

test('selected output reaches real Worker through adoption and run confirmation; numbering, explicit overwrite, history and restart keep actual bytes', async (t) => {
  const f = await fixture(t);
  let d = await f.adopt(f.d);
  assert.equal(
    d.flow.bindings.files[OUTPUT_BINDING],
    f.output,
    'no test flow.save binding shortcut',
  );
  assert.equal(JSON.stringify(f.requests).includes(f.output), false);
  await writeFile(join(f.output, 'result.txt'), 'original');
  const args = { id: d.flow.id, task: identity(d) };
  const preview = await f.call('flow.run.preview', args);
  assert.equal(preview.ready, true, JSON.stringify(preview));
  assert.match(JSON.stringify(preview), /同名自动加序号/);
  const confirmed = { ...args, token: preview.token, requestId: randomUUID(), reviewed: true };
  const run = await f.call('flow.run.confirm', confirmed);
  assert.equal(run.rejected, undefined, run.message);
  assert.equal((await f.call('flow.run.confirm', confirmed)).id, run.id);
  await f.finished(run);
  assert.equal(await readFile(join(f.output, 'result.txt'), 'utf8'), 'original');
  assert.equal(await readFile(join(f.output, 'result (1).txt'), 'utf8'), f.control.text);
  const artifacts = (await f.call('run.detail', { id: run.id })).artifacts;
  assert.equal(artifacts[0].name, 'result (1).txt');
  assert.equal(
    (await f.call('artifact.preview', { id: artifacts[0].artifactId })).text,
    f.control.text,
  );
  const snapshot = f.runtime.store.get<FlowRecord>('snapshot', run.id)!;
  assert.deepEqual(snapshot.outputTarget, d.task.outputTarget);
  d = await f.call('task.output.configure', {
    ...identity(d),
    name: 'result.txt',
    onConflict: 'overwrite',
  });
  await assert.rejects(f.call('flow.run', { id: snapshot.id }), /更换|撤销/);
  await assert.rejects(
    f.call('schedule.save', { flowId: snapshot.id, intervalMinutes: 1, timezone: 'UTC' }),
    /更换|撤销/,
  );
  await assert.rejects(f.call('run.rerun.preview', { id: run.id, mode: 'snapshot' }), /更换|撤销/);
  f.control.text = 'explicit replacement';
  d = await f.adopt(d);
  const replaceReview = await f.call('flow.run.preview', { id: d.flow.id, task: identity(d) });
  assert.equal(replaceReview.ready, true);
  assert.match(JSON.stringify(replaceReview), /覆盖/);
  const replacement = await f.call('flow.run.confirm', {
    id: d.flow.id,
    task: identity(d),
    token: replaceReview.token,
    requestId: randomUUID(),
    reviewed: true,
  });
  await f.finished(replacement);
  assert.equal(await readFile(join(f.output, 'result.txt'), 'utf8'), 'explicit replacement');
  assert.equal(await readFile(join(f.output, 'result (1).txt'), 'utf8'), 'real Worker output 🧭');
  assert.deepEqual(f.runtime.store.get('snapshot', run.id), snapshot);
  const stored = structuredClone(d.task.outputTarget);
  await f.reopen();
  assert.deepEqual((await f.call('task.detail', { id: d.task.id })).task.outputTarget, stored);
  assert.equal(f.requests.length, 2, 'reopen never requests generation');
  assert.equal(f.runtime.store.count('run'), 2);
  assert.equal(
    (await f.call('artifact.preview', { id: artifacts[0].artifactId })).text,
    'real Worker output 🧭',
  );
});

test('active and queued output changes are rejected; real Worker checks directory identity after human wait and manual save cannot strip output constraints', async (t) => {
  const f = await fixture(t);
  f.control.human = true;
  const d = await f.adopt(f.d);
  const run = await f.call('flow.run', { id: d.flow.id });
  await until(() => f.runtime.store.get<Run>('run', run.id)?.state === 'WAITING_INPUT');
  const queued = await f.call('flow.run', { id: d.flow.id });
  await assert.rejects(f.call('task.output.clear', identity(d)), /运行和收尾/);
  await assert.rejects(
    f.call('task.output.configure', { ...identity(d), name: 'other.txt', onConflict: 'overwrite' }),
    /运行和收尾/,
  );
  const record = f.runtime.saveFlow({ ...d.flow.flow, name: 'manual title' }, d.flow.bindings);
  assert.deepEqual(record.outputTarget, d.task.outputTarget);
  await rename(f.output, f.output + '-previous');
  await mkdir(f.output);
  await f.call('run.control', { id: run.id, action: 'resume' });
  await f.finished(run, 'FAILED');
  await f.finished(queued, 'FAILED');
  await assert.rejects(access(join(f.output, 'result.txt')));
  await assert.rejects(access(join(f.output + '-previous', 'result.txt')));
  await rm(f.output, { recursive: true });
  await rename(f.output + '-previous', f.output);
  const bad = structuredClone(record.flow);
  (bad.steps[1] as any).name = 'different.txt';
  f.runtime.saveFlow(bad, record.bindings);
  await assert.rejects(f.call('flow.run', { id: record.id }), /固定文件名/);
  assert.equal(f.runtime.store.count('run'), 2, 'invalid manual edit must not create a run');
});
