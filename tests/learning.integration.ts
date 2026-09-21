import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Runtime } from '../src/host/runtime';
import type { Run } from '../src/shared/types';

async function until(check: () => boolean | Promise<boolean>) {
  const end = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('learning runtime timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}
test('real planning, confirmed Worker output and authenticated preview alone complete learning; restart retains history and ignores late old previews', async (t) => {
  const data = await mkdtemp(join(tmpdir(), 'flowark-learning-worker-'));
  const output = join(data, 'output');
  await mkdir(output);
  const requests: any[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const input = JSON.parse(JSON.parse(init.body as string).messages[1].content).request;
    requests.push(input);
    const result = {
      formatVersion: '1.0',
      kind: 'plan',
      summary: 'local provider fixture',
      questions: [],
      limitations: [],
      flow: {
        id: input.flowId,
        formatVersion: '1.0',
        name: 'learning real output',
        description: '',
        parameters: {},
        requiredCapabilities: ['file-create-numbered-v1'],
        steps: [
          {
            id: 'save',
            type: 'file',
            version: 4,
            operation: 'create',
            onConflict: 'number',
            binding: 'output',
            name: 'title.txt',
            content: 'real learning output 💡',
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
  let page = {
    started: true,
    loading: false,
    resourceId: 'learning-main-fixture',
    documentRevision: 1,
    url: 'https://example.com/learning',
    title: 'learning',
  };
  const key = randomBytes(32);
  const system = async (method: string) => {
    if (method === 'browser.embedded.review') return structuredClone(page);
    if (method === 'credentials.list') return ['deepseek'];
    if (method === 'credentials.get') return 'sk-local-fixture';
    if (method === 'notification' || method === 'browser.embedded.pick.cancel') return true;
    throw new Error('unexpected system call: ' + method);
  };
  let runtime = new Runtime(data, resolve('dist'), process.execPath, Buffer.from(key), system);
  t.after(async () => {
    await runtime.shutdown();
    runtime.store.close();
    await rm(data, { recursive: true, force: true });
  });
  const call = (method: string, args: any = {}) => runtime.request(method, args);
  const attempts = await Promise.allSettled([
    call('learning.start', { revision: 0, mode: 'continue' }),
    call('learning.start', { revision: 0, mode: 'continue' }),
  ]);
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((r) => r.status === 'rejected').length, 1);
  const started = (attempts.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>)
    .value;
  assert.equal(runtime.store.count('ai-task'), 1);
  const task = started.detail.task;
  assert.equal(requests.length, 0);
  assert.equal(runtime.store.count('flow'), 0);
  let identity = { id: task.id, revision: task.revision };
  const preview = await call('task.web.preview', identity);
  assert.deepEqual((await call('learning.status')).achieved, {});
  const failSelection = t.mock.method(runtime.learning, 'target', () => {
    throw new Error('learning target write failure');
  });
  await assert.rejects(
    call('task.web.select', { ...identity, token: preview.token }),
    /target write/,
  );
  assert.equal((await call('task.detail', { id: task.id })).task.webTarget, undefined);
  assert.deepEqual((await call('learning.status')).achieved, {});
  failSelection.mock.restore();
  let detail = await call('task.web.select', { ...identity, token: preview.token });
  assert.ok((await call('learning.status')).achieved.target);
  identity = { id: task.id, revision: detail.task.revision };
  await call('task.generate', {
    ...identity,
    provider: 'deepseek',
    model: 'fixture',
    reviewed: true,
  });
  await until(
    async () => (await call('task.detail', { id: task.id })).task.status !== 'generating',
  );
  detail = await call('task.detail', { id: task.id });
  assert.equal(detail.task.status, 'plan', detail.task.error);
  assert.equal((await call('learning.status')).achieved.plan, undefined);
  const failPlan = t.mock.method(runtime.learning, 'plan', () => {
    throw new Error('learning plan write failure');
  });
  await assert.rejects(
    call('task.adopt', { ...identity, proposalId: detail.proposal.id }),
    /plan write/,
  );
  assert.equal(runtime.store.count('flow'), 0);
  assert.ok((await call('task.detail', { id: task.id })).proposal);
  assert.equal((await call('learning.status')).achieved.plan, undefined);
  failPlan.mock.restore();
  detail = await call('task.adopt', { ...identity, proposalId: detail.proposal.id });
  assert.ok((await call('learning.status')).achieved.plan);
  const record = runtime.saveFlow(detail.flow.flow, { ...detail.flow.bindings, files: { output } });
  const ordinary = await call('flow.run', { id: record.id });
  await until(() => runtime.store.get<Run>('run', ordinary.id)?.state === 'SUCCEEDED');
  await until(async () => !(await call('bootstrap')).execution.active);
  const a = (await call('run.detail', { id: ordinary.id })).artifacts[0];
  assert.equal((await call('artifact.preview', { id: a.artifactId })).status, 'text');
  assert.equal((await call('learning.status')).achieved.result, undefined);
  assert.equal((await call('learning.status')).achieved.trial, undefined);
  const args = { id: record.id, task: { id: task.id, revision: detail.task.revision } };
  const reviewed = await call('flow.run.preview', args);
  assert.equal(reviewed.ready, true, JSON.stringify(reviewed.checks));
  assert.equal((await call('learning.status')).achieved.trial, undefined);
  const confirmation = { ...args, token: reviewed.token, requestId: randomUUID(), reviewed: true };
  const failTrial = t.mock.method(runtime.learning, 'trial', () => {
    throw new Error('learning trial write failure');
  });
  const rejected = await call('flow.run.confirm', confirmation);
  assert.equal(rejected.rejected, true);
  assert.equal(runtime.store.count('run'), 1);
  assert.equal(runtime.store.count('flow-run-request'), 0);
  assert.equal((await call('learning.status')).achieved.trial, undefined);
  failTrial.mock.restore();
  const run = await call('flow.run.confirm', confirmation);
  assert.equal(run.rejected, undefined, run.message);
  assert.equal((await call('flow.run.confirm', confirmation)).id, run.id);
  await until(() => runtime.store.get<Run>('run', run.id)?.state === 'SUCCEEDED');
  await until(async () => !(await call('bootstrap')).execution.active);
  const result = await call('run.detail', { id: run.id }),
    artifact = result.artifacts[0];
  assert.equal(artifact.name, 'title (1).txt');
  assert.equal((await call('learning.status')).status, 'active');
  const bytes = await readFile(artifact.path);
  await writeFile(artifact.path, 'tampered');
  assert.equal((await call('artifact.preview', { id: artifact.artifactId })).status, 'unavailable');
  assert.equal((await call('learning.status')).status, 'active');
  await writeFile(artifact.path, bytes);
  const text = await call('artifact.preview', { id: artifact.artifactId });
  assert.equal(text.status, 'text');
  const completed = await call('learning.status');
  assert.equal(completed.status, 'completed');
  assert.deepEqual(Object.keys(completed.achieved), ['target', 'plan', 'trial', 'result']);
  assert.equal(completed.achieved.result.artifactId, artifact.artifactId);
  await runtime.shutdown();
  runtime.store.close();
  page = { ...page, resourceId: 'fresh-main', documentRevision: 1 };
  runtime = new Runtime(data, resolve('dist'), process.execPath, Buffer.from(key), system);
  assert.deepEqual(await call('learning.status'), completed);
  assert.equal(requests.length, 1, 'reopen must not resend a model request');
  const continued = await call('learning.start', {
    revision: completed.revision,
    mode: 'continue',
  });
  assert.equal(continued.detail.task.id, task.id);
  assert.equal(runtime.store.count('run'), 2);
  await assert.rejects(call('flow.run', { id: record.id }), /刷新|切换|打开/);
  const files = (runtime as any).artifactFiles,
    original = files.preview.bind(files);
  let entered = false,
    release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  t.mock.method(files, 'preview', async (item: any) => {
    const result = await original(item);
    entered = true;
    await gate;
    return result;
  });
  const delayed = call('artifact.preview', { id: artifact.artifactId });
  await until(() => entered);
  const restarted = await call('learning.start', {
    revision: continued.learning.revision,
    mode: 'restart',
  });
  release();
  await delayed;
  assert.notEqual(restarted.detail.task.id, task.id);
  assert.deepEqual((await call('learning.status')).achieved, {});
  assert.equal(runtime.store.count('ai-task'), 2);
  assert.equal(runtime.store.count('run'), 2);
  assert.equal(await readFile(artifact.path, 'utf8'), text.text);
  assert.doesNotMatch(JSON.stringify(requests), /attemptId|achieved|learningProgress/);
});
