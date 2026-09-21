import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  realpath,
  mkdir,
  writeFile,
  access,
  readdir,
} from 'node:fs/promises';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { Runtime } from '../src/host/runtime';
import type { Flow, Run, Step } from '../src/shared/types';
import { Store } from '../src/host/store';
import { child, killOwnedTree } from '../src/host/processes';
import { Rpc } from '../src/shared/rpc';
const base: Flow = {
  id: 'test',
  formatVersion: '1.0',
  name: '虚构测试流程',
  description: '',
  parameters: {},
  requiredCapabilities: [],
  steps: [],
};
async function until(fn: () => boolean, timeout = 12000) {
  const end = Date.now() + timeout;
  while (!fn()) {
    if (Date.now() > end) throw new Error('等待条件超时');
    await new Promise((r) => setTimeout(r, 20));
  }
}
test('AI proposal adoption shares the real workflow while active snapshots stay fixed; suspend and quit abort planning', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'flowark-planning-runtime-'));
  const requests: any[] = [];
  const signals: AbortSignal[] = [];
  let value = 'first',
    hold = false;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const input = JSON.parse(body.messages[1].content).request;
    requests.push(input);
    signals.push(init.signal!);
    if (hold)
      return new Promise((_resolve, reject) =>
        init.signal!.addEventListener('abort', () => reject(new Error('fixture aborted')), {
          once: true,
        }),
      );
    const flow = {
      ...base,
      id: input.flowId,
      steps: [
        { id: 'value', type: 'value', version: 1, value },
        { id: 'wait', type: 'human', version: 1, message: 'review test boundary' },
        { id: 'finish', type: 'value', version: 1, value: { $ref: 'steps.value' } },
      ],
    };
    const output = {
      formatVersion: '1.0',
      kind: 'plan',
      summary: 'fixture proposal',
      flow,
      questions: [],
      limitations: [],
    };
    return Response.json({
      choices: [
        {
          finish_reason: 'stop',
          message: { content: JSON.stringify({ resultJson: JSON.stringify(output) }) },
        },
      ],
    });
  });
  const runtime = new Runtime(
    directory,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async (method) => (method === 'credentials.get' ? 'sk-fictional-planning-runtime-key' : []),
  );
  let shut = false;
  try {
    const created = await runtime.request('task.create', {});
    let d = await runtime.request('task.save', {
      id: created.task.id,
      revision: 1,
      description: 'only this selected task',
      context: [],
      answers: {},
    });
    const generate = async () => {
      await runtime.request('task.generate', {
        id: d.task.id,
        revision: d.task.revision,
        provider: 'deepseek',
        model: 'fixture',
        reviewed: true,
      });
      await until(() => runtime.planning.detail(d.task.id).task.status !== 'generating');
      d = runtime.planning.detail(d.task.id);
    };
    await generate();
    assert.equal(d.task.status, 'plan');
    assert.equal(runtime.store.count('run'), 0);
    assert.equal(runtime.store.count('flow'), 0);
    const adopt = async () => {
      d = await runtime.request('task.adopt', {
        id: d.task.id,
        revision: d.task.revision,
        proposalId: d.proposal.id,
      });
    };
    await adopt();
    const run = await runtime.enqueue(d.task.flowId);
    await until(() => runtime.store.get<Run>('run', run.id)?.state === 'WAITING_INPUT');
    value = 'second';
    await generate();
    assert.equal(runtime.store.count('run'), 1);
    await adopt();
    assert.equal(runtime.store.get<any>('flow', d.task.flowId).flow.steps[0].value, 'second');
    await runtime.control(run.id, 'resume');
    await until(() => runtime.store.get<Run>('run', run.id)?.state === 'SUCCEEDED');
    assert.equal((await runtime.request('run.detail', { id: run.id })).output.finish, 'first');
    hold = true;
    await runtime.request('task.generate', {
      id: d.task.id,
      revision: d.task.revision,
      provider: 'deepseek',
      model: 'fixture',
      reviewed: true,
    });
    await until(() => requests.length === 3);
    await runtime.request('system.suspend');
    assert.equal(signals[2].aborted, true);
    assert.equal(runtime.planning.detail(d.task.id).task.status, 'cancelled');
    await runtime.request('system.resume');
    assert.equal(requests.length, 3, 'resume cannot retry a planning request');
    await runtime.request('task.generate', {
      id: d.task.id,
      revision: d.task.revision,
      provider: 'deepseek',
      model: 'fixture',
      reviewed: true,
    });
    await until(() => requests.length === 4);
    await runtime.shutdown();
    shut = true;
    assert.equal(signals[3].aborted, true);
    assert.equal(runtime.store.count('run'), 1);
    assert.equal(runtime.planning.detail(d.task.id).task.status, 'cancelled');
  } finally {
    if (!shut) await runtime.shutdown();
    runtime.store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test('real Worker enforces human, branch and whole-loop deadlines then releases its run slot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowark-node-timeout-'));
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    setTimeout(() => response.end('fictional response'), 100);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as any).port;
  const runtime = new Runtime(
    directory,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  const wait: Step = { id: 'wait', type: 'human', version: 1, message: 'timeout fixture' };
  const cases: Step[] = [
    { ...wait, timeoutMs: 200 },
    {
      id: 'branch',
      type: 'condition',
      version: 1,
      timeoutMs: 200,
      actual: true,
      operator: 'equals',
      expected: true,
      then: [wait],
      else: [],
    },
    {
      id: 'loop',
      type: 'loop',
      version: 1,
      timeoutMs: 400,
      items: [1, 2, 3, 4, 5, 6],
      body: [
        {
          id: 'request',
          type: 'http',
          version: 1,
          method: 'GET',
          url,
          headers: {},
          body: null,
          timeoutMs: 2000,
        },
      ],
    },
  ];
  try {
    runtime.saveFlow(
      { ...base, id: 'recovery', steps: [{ id: 'value', type: 'value', version: 1, value: true }] },
      { files: {}, credentials: [] },
    );
    for (const node of cases) {
      runtime.saveFlow(
        {
          ...base,
          steps: [
            node,
            {
              id: 'never',
              type: 'file',
              version: 1,
              operation: 'write',
              binding: 'work',
              name: 'must-not-write.txt',
              content: 'unexpected',
            },
          ],
        },
        { files: { work: directory }, credentials: [] },
      );
      const run = await runtime.enqueue(base.id);
      await until(() =>
        ['FAILED', 'INTERRUPTED', 'SUCCEEDED'].includes(
          runtime.store.get<Run>('run', run.id)!.state,
        ),
      );
      const finished = runtime.store.get<Run>('run', run.id)!;
      assert.equal(finished.state, 'FAILED', JSON.stringify(finished));
      assert.match(finished.error!, new RegExp(`节点超时：${node.id}（${node.timeoutMs} 毫秒）`));
      assert.ok(!runtime.store.events(run.id).some((event) => event.nodeInstance === 'never'));
      assert.ok(
        !runtime.store
          .events(run.id)
          .some((event) => event.nodeInstance === node.id && event.type === 'node-end'),
      );
      await assert.rejects(access(join(directory, 'must-not-write.txt')), { code: 'ENOENT' });
      const next = await runtime.enqueue('recovery');
      await until(() => runtime.store.get<Run>('run', next.id)?.state === 'SUCCEEDED');
    }
    assert.ok(requests > 0 && requests < 6, `loop must stop before all six requests: ${requests}`);
  } finally {
    await runtime.shutdown();
    runtime.store.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});

test('real Worker leaves unconfigured human waiting and still records user cancellation as CANCELLED', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowark-human-no-deadline-'));
  const runtime = new Runtime(
    directory,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  try {
    runtime.saveFlow(
      { ...base, steps: [{ id: 'wait', type: 'human', version: 1, message: 'fixture' }] },
      { files: {}, credentials: [] },
    );
    const unlimited = await runtime.enqueue(base.id);
    await until(() => runtime.store.get<Run>('run', unlimited.id)?.state === 'WAITING_INPUT');
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(runtime.store.get<Run>('run', unlimited.id)?.state, 'WAITING_INPUT');
    await runtime.control(unlimited.id, 'resume');
    await until(() => runtime.store.get<Run>('run', unlimited.id)?.state === 'SUCCEEDED');
    runtime.saveFlow(
      {
        ...base,
        steps: [{ id: 'wait', type: 'human', version: 1, message: 'fixture', timeoutMs: 10000 }],
      },
      { files: {}, credentials: [] },
    );
    const cancelled = await runtime.enqueue(base.id);
    await until(() => runtime.store.get<Run>('run', cancelled.id)?.state === 'WAITING_INPUT');
    await runtime.control(cancelled.id, 'cancel');
    await until(() => runtime.store.get<Run>('run', cancelled.id)?.state === 'CANCELLED');
    assert.ok(!runtime.store.events(cancelled.id).some((event) => event.type === 'node-end'));
  } finally {
    await runtime.shutdown();
    runtime.store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('parent deadline terminates its real script process and does not execute following side effects', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowark-timeout-script-'));
  const pidFile = join(directory, 'owned.pid');
  const lateFile = join(directory, 'late.txt');
  const runtime = new Runtime(
    directory,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  let pid = 0;
  try {
    runtime.saveFlow(
      {
        ...base,
        steps: [
          {
            id: 'branch',
            type: 'condition',
            version: 1,
            timeoutMs: 2000,
            actual: true,
            operator: 'equals',
            expected: true,
            else: [],
            then: [
              {
                id: 'script',
                type: 'script',
                version: 1,
                language: 'js',
                dependencies: [],
                timeoutMs: 10000,
                input: { pidFile, lateFile },
                code: 'import {writeFile} from "node:fs/promises"; export default async ({input}) => { await writeFile(input.pidFile,String(process.pid)); await new Promise(r=>setTimeout(r,4000)); await writeFile(input.lateFile,"unexpected"); }',
              },
              { id: 'never', type: 'value', version: 1, value: 'unexpected' },
            ],
          },
        ],
      },
      { files: {}, credentials: [] },
    );
    const run = await runtime.enqueue(base.id);
    for (let attempt = 0; attempt < 100 && !pid; attempt++) {
      pid = Number(await readFile(pidFile, 'utf8').catch(() => ''));
      if (!pid) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(pid, 'the real script must start before its parent deadline');
    await until(() =>
      ['FAILED', 'INTERRUPTED', 'SUCCEEDED'].includes(runtime.store.get<Run>('run', run.id)!.state),
    );
    const result = runtime.store.get<Run>('run', run.id)!;
    assert.equal(result.state, 'FAILED', JSON.stringify(result));
    assert.match(result.error!, /branch（2000 毫秒）/);
    await until(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    });
    await assert.rejects(access(lateFile), { code: 'ENOENT' });
    assert.ok(
      !runtime.store
        .events(run.id)
        .some((event) => event.type === 'node-end' || event.nodeInstance.endsWith('/never')),
    );
  } finally {
    await runtime.shutdown();
    runtime.store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('upload-only directories and parameter descriptors are checked before admission without requiring future output files', async () => {
  const path = await mkdtemp(join(tmpdir(), 'flowark-upload-admission-'));
  const browser = { id: 'embedded', product: 'embedded', version: 'fixture' };
  const runtime = new Runtime(
    path,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => browser,
  );
  runtime.store.put('browser', browser.id, browser);
  const bindings = { browserId: browser.id, files: { work: path }, credentials: [] };
  const upload: Extract<Flow['steps'][number], { type: 'browser' }> = {
    id: 'upload',
    type: 'browser',
    version: 3,
    operation: 'upload',
    selector: '#attachment',
    framePath: [],
    value: null,
  };
  const write: Extract<Flow['steps'][number], { type: 'file' }> = {
    id: 'write',
    type: 'file',
    version: 1,
    operation: 'write',
    binding: 'work',
    name: 'must-not-write.txt',
    content: 'unexpected',
  };
  try {
    await writeFile(join(path, 'not-directory'), 'fixture');
    const variants: {
      value: unknown;
      parameters?: Flow['parameters'];
      files: Record<string, string>;
      pattern: RegExp;
    }[] = [
      { value: { binding: 'missing', name: 'x' }, files: {}, pattern: /未绑定.*missing/ },
      {
        value: { $ref: 'params.source' },
        parameters: { source: { binding: 'missing', name: 'x' } },
        files: {},
        pattern: /未绑定.*missing/,
      },
      {
        value: { binding: { $ref: 'params.folder' }, name: 'x' },
        parameters: { folder: 'missing' },
        files: {},
        pattern: /未绑定.*missing/,
      },
      {
        value: { binding: 'bad', name: 'x' },
        files: { bad: join(path, 'not-directory') },
        pattern: /重新选择.*bad/,
      },
      {
        value: { binding: 'bad', name: 'x' },
        files: { bad: join(path, 'does-not-exist') },
        pattern: /重新选择.*bad/,
      },
      { value: { binding: 'work', name: '../escape.txt' }, files: {}, pattern: /已绑定目录/ },
      { value: { binding: 'work', name: 7 }, files: {}, pattern: /文件名.*非空文本/ },
      { value: 'not a descriptor', files: {}, pattern: /binding,name/ },
    ];
    for (const [index, variant] of variants.entries()) {
      const flow: Flow = {
        ...base,
        id: 'upload-invalid-' + index,
        parameters: (variant.parameters ?? {}) as any,
        steps: [
          write,
          {
            id: 'branch',
            type: 'condition',
            version: 1,
            actual: true,
            expected: true,
            operator: 'equals',
            else: [],
            then: [{ ...upload, value: variant.value as any }],
          },
        ],
      };
      runtime.saveFlow(flow, { ...bindings, files: { ...bindings.files, ...variant.files } });
      await assert.rejects(runtime.request('flow.run', { id: flow.id }), variant.pattern);
      await assert.rejects(
        runtime.request('schedule.save', { flowId: flow.id, intervalMinutes: 1, timezone: 'UTC' }),
        variant.pattern,
      );
    }
    assert.equal(runtime.store.list('run').length, 0);
    assert.equal(runtime.store.list('schedule').length, 0);
    assert.equal(runtime.store.list('snapshot').length, 0);
    await assert.rejects(access(join(path, 'must-not-write.txt')), { code: 'ENOENT' });
    const valid: Flow = {
      ...base,
      id: 'generated-upload',
      parameters: { source: { binding: 'work', name: 'future.txt' } },
      steps: [
        { ...write, name: 'future.txt', content: 'generated bytes' },
        { ...upload, value: { $ref: 'params.source' } },
      ],
    };
    let uploaded = '';
    runtime.sessions.use = async (_binding, _runId, command) => {
      uploaded = await readFile(String(command.value), 'utf8');
      return { uploaded: true };
    };
    runtime.saveFlow(valid, bindings);
    const run = await runtime.request('flow.run', { id: valid.id });
    await until(() =>
      ['SUCCEEDED', 'FAILED'].includes(runtime.store.get<Run>('run', run.id)!.state),
    );
    assert.equal(runtime.store.get<Run>('run', run.id)!.state, 'SUCCEEDED');
    assert.equal(uploaded, 'generated bytes');
  } finally {
    await runtime.shutdown();
    runtime.store.close();
  }
});

test('dynamic upload failures and directory changes after queuing never reach the browser driver', async () => {
  const path = await mkdtemp(join(tmpdir(), 'flowark-upload-boundary-'));
  const root = join(path, 'files');
  await mkdir(root);
  await mkdir(join(root, 'directory'));
  await writeFile(join(path, 'outside.txt'), 'outside');
  await symlink(join(path, 'outside.txt'), join(root, 'escape.txt'));
  const browser = { id: 'embedded', product: 'embedded', version: 'fixture' };
  const runtime = new Runtime(
    path,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => browser,
  );
  runtime.store.put('browser', browser.id, browser);
  const bindings = { browserId: browser.id, files: { work: root }, credentials: [] };
  let browserCalls = 0;
  runtime.sessions.use = async () => {
    browserCalls++;
    throw new Error('must not reach browser');
  };
  const upload: Extract<Flow['steps'][number], { type: 'browser' }> = {
    id: 'upload',
    type: 'browser',
    version: 3,
    operation: 'upload',
    selector: '#attachment',
    framePath: [],
    value: { $ref: 'steps.source' },
  };
  try {
    for (const [index, source] of [
      { binding: 'missing', name: 'x' },
      { binding: 'work', name: 'missing.txt' },
      { binding: 'work', name: 'directory' },
      { binding: 'work', name: 'escape.txt' },
      { binding: 'work', name: 7 },
    ].entries()) {
      const flow: Flow = {
        ...base,
        id: 'dynamic-' + index,
        steps: [{ id: 'source', type: 'value', version: 1, value: source }, upload],
      };
      runtime.saveFlow(flow, bindings);
      const run = await runtime.request('flow.run', { id: flow.id });
      await until(() =>
        ['FAILED', 'SUCCEEDED'].includes(runtime.store.get<Run>('run', run.id)!.state),
      );
      assert.equal(runtime.store.get<Run>('run', run.id)!.state, 'FAILED');
      assert.equal(
        runtime.store
          .events(run.id)
          .filter((e) => e.type === 'node-start' && e.nodeInstance === 'upload').length,
        1,
      );
    }
    await writeFile(join(root, 'deleted.txt'), 'fixture');
    const pausedFlow: Flow = {
      ...base,
      id: 'deleted-after-pause',
      steps: [{ ...upload, value: { binding: 'work', name: 'deleted.txt' } }],
    };
    runtime.saveFlow(pausedFlow, bindings);
    const paused = await runtime.request('flow.run', { id: pausedFlow.id, debug: true });
    await until(() => runtime.store.get<Run>('run', paused.id)!.state === 'PAUSED');
    await rm(join(root, 'deleted.txt'));
    await runtime.control(paused.id, 'resume');
    await until(() => runtime.store.get<Run>('run', paused.id)!.state === 'FAILED');
    const hold = {
      ...base,
      id: 'hold-slot',
      steps: [{ id: 'human', type: 'human' as const, version: 1 as const, message: 'fixture' }],
    };
    runtime.saveFlow(hold, { files: {}, credentials: [] });
    const holding = await runtime.enqueue(hold.id);
    await until(() => runtime.store.get<Run>('run', holding.id)!.state === 'WAITING_INPUT');
    const queued = await runtime.enqueue(pausedFlow.id);
    assert.equal(runtime.store.get<Run>('run', queued.id)!.state, 'QUEUED');
    await rm(root, { recursive: true });
    await runtime.control(holding.id, 'cancel');
    await until(() => runtime.store.get<Run>('run', queued.id)!.state === 'FAILED');
    assert.match(runtime.store.get<Run>('run', queued.id)!.error ?? '', /重新选择.*work/);
    assert.equal(runtime.store.events(queued.id).filter((e) => e.type === 'node-start').length, 0);
    assert.equal(browserCalls, 0);
  } finally {
    await runtime.shutdown();
    runtime.store.close();
  }
});
test('invalid legacy HTTP body references cannot save, enter a run or schedule, while scoped requests reach the real server', async () => {
  const path = await mkdtemp(join(tmpdir(), 'flowark-http-references-'));
  const received: unknown[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received.push(JSON.parse(body));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ received: true }));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(server.address() as any).port}/`;
  const runtime = new Runtime(
    path,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  const bindings = { files: { work: path }, credentials: [] };
  const request: Extract<Flow['steps'][number], { type: 'http' }> = {
    id: 'send',
    type: 'http',
    version: 1,
    method: 'POST',
    url,
    headers: {},
    body: null,
  };
  const bad: Flow = {
    ...base,
    id: 'invalid-old',
    steps: [
      {
        id: 'write',
        type: 'file',
        version: 1,
        operation: 'write',
        binding: 'work',
        name: 'must-not-write.txt',
        content: 'unexpected',
      },
      { ...request, body: { nested: [{ $ref: 'steps.missing' }] } },
    ],
  };
  try {
    await assert.rejects(
      runtime.request('flow.save', { flow: bad, bindings }),
      /steps.missing.*send/,
    );
    assert.equal(runtime.store.get('flow', bad.id), undefined);
    // Simulate a definition accepted and persisted by an older client.
    const record = { id: bad.id, flow: bad, bindings, updatedAt: 'legacy' };
    runtime.store.put('flow', bad.id, record);
    runtime.store.put('version', 'legacy-version', { ...record, versionId: 'legacy-version' });
    await assert.rejects(runtime.request('flow.run', { id: bad.id }), /steps.missing.*send/);
    await assert.rejects(runtime.enqueue(bad.id, 'legacy-version'), /steps.missing.*send/);
    await assert.rejects(
      runtime.request('schedule.save', { flowId: bad.id, intervalMinutes: 1, timezone: 'UTC' }),
      /steps.missing.*send/,
    );
    assert.equal(runtime.store.list('run').length, 0);
    assert.equal(runtime.store.list('schedule').length, 0);
    assert.equal(runtime.store.list('snapshot').length, 0);
    assert.deepEqual(runtime.store.get('flow', bad.id), record);
    assert.deepEqual(received, []);
    await assert.rejects(access(join(path, 'must-not-write.txt')), { code: 'ENOENT' });
    const good: Flow = {
      ...base,
      id: 'scoped-http',
      parameters: { label: 'fixture' },
      steps: [
        { id: 'source', type: 'value', version: 1, value: 42 },
        {
          id: 'choose',
          type: 'condition',
          version: 1,
          actual: true,
          expected: true,
          operator: 'equals',
          else: [],
          then: [
            {
              id: 'loop',
              type: 'loop',
              version: 1,
              items: ['a', 'b'],
              body: [
                {
                  ...request,
                  body: {
                    values: [
                      { $ref: 'params.label' },
                      { $ref: 'steps.source' },
                      { $ref: 'item' },
                      { $ref: 'index' },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    runtime.saveFlow(good, bindings);
    const run = await runtime.request('flow.run', { id: good.id });
    await until(() =>
      ['SUCCEEDED', 'FAILED'].includes(runtime.store.get<Run>('run', run.id)!.state),
    );
    assert.equal(runtime.store.get<Run>('run', run.id)!.state, 'SUCCEEDED');
    assert.deepEqual(received, [
      { values: ['fixture', 42, 'a', 0] },
      { values: ['fixture', 42, 'b', 1] },
    ]);
    const { execution: beforeObservation, ...history } = await runtime.request('run.detail', {
      id: run.id,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await assert.rejects(runtime.request('flow.run', { id: bad.id }), /steps.missing/);
    const { execution: afterObservation, ...afterHistory } = await runtime.request('run.detail', {
      id: run.id,
    });
    assert.deepEqual(afterHistory, history);
    for (const observation of [beforeObservation, afterObservation]) {
      assert.equal(new Date(observation.observedAt).toISOString(), observation.observedAt);
      if (observation.active !== null) {
        assert.equal(observation.active.runId, run.id);
        assert.ok(['executing', 'closing'].includes(observation.active.phase));
      }
    }
    assert.ok(Date.parse(afterObservation.observedAt) > Date.parse(beforeObservation.observedAt));
  } finally {
    await runtime.shutdown();
    runtime.store.close();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
test('real debug Worker steps into branches and loops, freezes the draft, rejects duplicate controls and cancels before effects', async () => {
  const path = await mkdtemp(join(tmpdir(), 'flowark-debug-runtime-'));
  const runtime = new Runtime(
    path,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  const flow: Flow = {
    ...base,
    steps: [
      { id: 'first', type: 'value', version: 1, value: 'original' },
      {
        id: 'branch',
        type: 'condition',
        version: 1,
        actual: true,
        operator: 'equals',
        expected: true,
        then: [
          {
            id: 'loop',
            type: 'loop',
            version: 1,
            items: [1, 2],
            body: [{ id: 'item', type: 'value', version: 1, value: { $ref: 'item' } }],
          },
        ],
        else: [],
      },
      {
        id: 'write',
        type: 'file',
        version: 1,
        operation: 'write',
        binding: 'work',
        name: 'must-not-write.txt',
        content: 'unexpected',
      },
    ],
  };
  try {
    runtime.saveFlow(flow, { files: { work: path }, credentials: [] });
    const run = await runtime.request('flow.run', { id: flow.id, debug: true });
    const pausedAt = async (location: string) =>
      until(
        () =>
          runtime.store.get<Run>('run', run.id)?.state === 'PAUSED' &&
          runtime.store
            .events(run.id)
            .filter((e) => e.type === 'debug-pause')
            .at(-1)?.nodeInstance === location,
      );
    await pausedAt('first');
    assert.equal(runtime.store.events(run.id).filter((e) => e.type === 'node-start').length, 0);
    runtime.saveFlow(
      { ...flow, steps: [{ id: 'changed', type: 'value', version: 1, value: 'changed' }] },
      { files: { work: path }, credentials: [] },
    );
    const one = runtime.control(run.id, 'step');
    await assert.rejects(runtime.control(run.id, 'step'), /尚未处理/);
    await one;
    await pausedAt('branch');
    assert.equal(
      runtime.store.events(run.id).find((e) => e.nodeInstance === 'first' && e.type === 'node-end')
        ?.data.outputPreview,
      '"original"',
    );
    for (const next of ['branch/loop', 'branch/loop[0]/item', 'branch/loop[1]/item', 'write']) {
      await runtime.control(run.id, 'step');
      await pausedAt(next);
    }
    assert.deepEqual(
      runtime.store
        .events(run.id)
        .filter((e) => e.type === 'node-start')
        .map((e) => e.nodeInstance),
      ['first', 'branch', 'branch/loop', 'branch/loop[0]/item', 'branch/loop[1]/item'],
    );
    await runtime.control(run.id, 'cancel');
    await until(() => runtime.store.get<Run>('run', run.id)?.state === 'CANCELLED');
    await assert.rejects(readFile(join(path, 'must-not-write.txt')), { code: 'ENOENT' });
    const next = await runtime.request('flow.run', { id: flow.id, debug: true });
    await until(() => runtime.store.get<Run>('run', next.id)?.state === 'PAUSED');
    await runtime.control(next.id, 'resume');
    await until(() => runtime.store.get<Run>('run', next.id)?.state === 'SUCCEEDED');
    assert.deepEqual((await runtime.request('run.detail', { id: next.id })).output, {
      changed: 'changed',
    });
  } finally {
    await runtime.shutdown();
    runtime.store.close();
  }
});
test('pause requested during worker startup reaches the first boundary before any node starts', async () => {
  const runtime = new Runtime(
    await mkdtemp(join(tmpdir(), 'flowark-early-pause-')),
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  const original = runtime.preflight.bind(runtime);
  let calls = 0;
  runtime.preflight = async (record) => {
    if (++calls === 2) await new Promise((resolve) => setTimeout(resolve, 250));
    return original(record);
  };
  try {
    runtime.saveFlow(
      { ...base, steps: [{ id: 'first', type: 'value', version: 1, value: 'must-not-run' }] },
      { files: {}, credentials: [] },
    );
    const run = await runtime.enqueue(base.id);
    await until(() => runtime.store.get<Run>('run', run.id)?.state === 'RUNNING');
    await runtime.control(run.id, 'pause');
    await until(() => runtime.store.get<Run>('run', run.id)?.state === 'PAUSED');
    assert.equal(runtime.store.events(run.id).filter((e) => e.type === 'node-start').length, 0);
    await runtime.control(run.id, 'cancel');
    await until(() => runtime.store.get<Run>('run', run.id)?.state === 'CANCELLED');
  } finally {
    await runtime.shutdown();
    runtime.store.close();
  }
});

test('real Worker preserves Excel row and column positions through referenced read-write-read', async () => {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'flowark-excel-rows-runtime-')));
  const runtime = new Runtime(
    path,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  try {
    const source = new ExcelJS.Workbook();
    const sheet = source.addWorksheet('Source');
    sheet.getCell('C3').value = 'C3';
    sheet.getCell('E3').value = 0;
    sheet.getCell('F3').value = false;
    sheet.getCell('G3').value = '';
    const date = new Date('2024-01-02T03:04:05.000Z');
    sheet.getCell('B5').value = date;
    sheet.getCell('D5').value = { formula: '1+2', result: 3 };
    sheet.getCell('H12').value = 'H12';
    sheet.getRow(14).height = 24;
    source.addWorksheet('Ignored').getCell('A1').value = 'other worksheet';
    await source.xlsx.writeFile(join(path, 'source.xlsx'));
    const sourceBytes = await readFile(join(path, 'source.xlsx'));
    const read: Step = {
      id: 'read',
      type: 'excel',
      version: 1,
      operation: 'read',
      binding: 'workspace',
      name: 'source.xlsx',
      rows: [],
    };
    runtime.saveFlow(
      {
        ...base,
        steps: [
          read,
          {
            ...read,
            id: 'write',
            operation: 'write',
            name: 'copy.xlsx',
            rows: { $ref: 'steps.read' },
          },
          { ...read, id: 'reread', name: 'copy.xlsx' },
          {
            id: 'verifyRows',
            type: 'assert',
            version: 1,
            actual: { $ref: 'steps.reread' },
            operator: 'equals',
            expected: { $ref: 'steps.read' },
          },
          {
            id: 'verifyEmptyA3',
            type: 'assert',
            version: 1,
            actual: { $ref: 'steps.reread.2.0' },
            operator: 'equals',
            expected: null,
          },
          {
            id: 'verifyH12',
            type: 'assert',
            version: 1,
            actual: { $ref: 'steps.reread.11.7' },
            operator: 'equals',
            expected: 'H12',
          },
        ],
      },
      { files: { workspace: path }, credentials: [] },
    );
    const run = await runtime.enqueue(base.id);
    await until(() =>
      ['SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(
        runtime.store.get<Run>('run', run.id)?.state ?? '',
      ),
    );
    const detail = await runtime.request('run.detail', { id: run.id });
    assert.equal(detail.run.state, 'SUCCEEDED', detail.run.error);
    for (const name of ['read', 'reread']) {
      const rows = detail.output[name];
      assert.equal(rows.length, 14);
      assert.deepEqual(rows[0], []);
      assert.deepEqual(rows[1], []);
      assert.deepEqual(rows[2], [null, null, 'C3', null, 0, false, '']);
      assert.deepEqual(rows[3], []);
      assert.deepEqual(rows[4], [null, date.toISOString(), null, { formula: '1+2', result: 3 }]);
      assert.deepEqual(rows[11], [null, null, null, null, null, null, null, 'H12']);
      assert.deepEqual(rows[12], []);
      assert.deepEqual(rows[13], []);
    }
    for (const name of ['verifyRows', 'verifyEmptyA3', 'verifyH12'])
      assert.deepEqual(detail.output[name], { verified: true });
    assert.equal(detail.artifacts.length, 1);
    const artifact = detail.artifacts[0];
    assert.equal(artifact.name, 'copy.xlsx');
    assert.equal(artifact.available, true);
    assert.equal(artifact.integrity, 'verified');
    assert.equal(
      await runtime.request('artifact.resolve', { id: artifact.artifactId }),
      artifact.path,
    );
    assert.notEqual(artifact.path, join(path, 'copy.xlsx'));
    assert.deepEqual(await readFile(artifact.path), await readFile(join(path, 'copy.xlsx')));
    const copy = new ExcelJS.Workbook();
    await copy.xlsx.readFile(artifact.path);
    const copied = copy.worksheets[0];
    assert.equal(copied.rowCount, 14);
    assert.equal(copied.getCell('A1').value, null);
    assert.equal(copied.getCell('B3').value, null);
    assert.equal(copied.getCell('C3').value, 'C3');
    assert.equal(copied.getCell('E3').value, 0);
    assert.equal(copied.getCell('F3').value, false);
    assert.equal(copied.getCell('G3').value, '');
    assert.ok(copied.getCell('B5').value instanceof Date);
    assert.deepEqual(copied.getCell('B5').value, date);
    assert.deepEqual(copied.getCell('D5').value, { formula: '1+2', result: 3 });
    assert.equal(copied.getCell('H12').value, 'H12');
    assert.equal(copied.getCell('G12').value, null);
    assert.deepEqual(await readFile(join(path, 'source.xlsx')), sourceBytes);
  } finally {
    await runtime.shutdown();
    runtime.store.close();
    await rm(path, { recursive: true, force: true });
  }
});
test('real Worker fills workbook, archives it and preserves run history when artifacts disappear', async () => {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'flowark-workbook-runtime-')));
  const runtime = new Runtime(
    path,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  try {
    const book = new ExcelJS.Workbook();
    book.addWorksheet('Sheet1').getCell('A1').value = 'before';
    await book.xlsx.writeFile(join(path, 'template.xlsx'));
    runtime.saveFlow(
      {
        ...base,
        parameters: { cells: { A1: 'after', B1: 9 } },
        steps: [
          {
            id: 'fill',
            type: 'excel',
            version: 2,
            operation: 'fill',
            binding: 'workspace',
            name: 'filled.xlsx',
            templateName: 'template.xlsx',
            sheet: '',
            cells: { $ref: 'params.cells' },
          },
          {
            id: 'zip',
            type: 'file',
            version: 2,
            operation: 'archive',
            binding: 'workspace',
            name: 'archive.zip',
            files: ['filled.xlsx'],
          },
        ],
      },
      { files: { workspace: path }, credentials: [] },
    );
    const run = await runtime.enqueue('test');
    await until(() =>
      ['SUCCEEDED', 'FAILED'].includes(runtime.store.get<Run>('run', run.id)?.state ?? ''),
    );
    let detail = await runtime.request('run.detail', { id: run.id });
    assert.equal(detail.run.state, 'SUCCEEDED', detail.run.error);
    assert.equal(detail.artifacts.length, 2);
    assert.ok(detail.artifacts.every((a: any) => a.available));
    const output = detail.artifacts.find((a: any) => a.name === 'filled.xlsx');
    assert.equal(await runtime.request('artifact.resolve', { id: output.artifactId }), output.path);
    assert.notEqual(output.path, join(path, 'filled.xlsx'));
    const zip = await JSZip.loadAsync(await readFile(join(path, 'archive.zip')));
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load((await zip.file('filled.xlsx')!.async('nodebuffer')) as any);
    assert.equal(restored.worksheets[0].getCell('A1').value, 'after');
    assert.equal(restored.worksheets[0].getCell('B1').value, 9);
    await rm(join(path, 'filled.xlsx'));
    assert.equal(
      (await runtime.request('run.detail', { id: run.id })).artifacts.find(
        (a: any) => a.artifactId === output.artifactId,
      ).integrity,
      'verified',
    );
    await rm(output.path);
    detail = await runtime.request('run.detail', { id: run.id });
    assert.equal(detail.run.state, 'SUCCEEDED');
    assert.equal(
      detail.artifacts.find((a: any) => a.artifactId === output.artifactId).available,
      false,
    );
    await assert.rejects(
      runtime.request('artifact.resolve', { id: output.artifactId }),
      /移动、删除/,
    );
    await assert.rejects(runtime.request('artifact.resolve', { id: 'unknown' }), /不存在/);
    await symlink(join(path, 'template.xlsx'), output.path);
    await assert.rejects(
      runtime.request('artifact.resolve', { id: output.artifactId }),
      /移动、删除/,
    );
    assert.equal(runtime.store.get<Run>('run', run.id)?.state, 'SUCCEEDED');
  } finally {
    await runtime.shutdown();
    runtime.store.close();
    await rm(path, { recursive: true, force: true });
  }
});
test('real Worker FIFO, immutable snapshot, human wait, queued cancellation and restart history', async () => {
  const path = await mkdtemp(join(tmpdir(), 'flowark-runtime-'));
  const key = randomBytes(32);
  const runtime = new Runtime(
    path,
    resolve('dist'),
    process.execPath,
    Buffer.from(key),
    async () => [],
  );
  try {
    runtime.saveFlow(
      {
        ...base,
        steps: [
          { id: 'human', type: 'human', version: 1, message: '测试等待' },
          { id: 'value', type: 'value', version: 1, value: 'original' },
        ],
      },
      { files: {}, credentials: [] },
    );
    const first = await runtime.enqueue('test');
    await until(() => runtime.store.get<Run>('run', first.id)?.state === 'WAITING_INPUT');
    runtime.saveFlow(
      {
        ...base,
        steps: [{ id: 'value', type: 'value', version: 1, value: 'edited' }],
      },
      { files: {}, credentials: [] },
    );
    const second = await runtime.enqueue('test');
    assert.equal(runtime.store.get<Run>('run', second.id)?.state, 'QUEUED');
    await runtime.control(second.id, 'cancel');
    assert.equal(runtime.store.get<Run>('run', second.id)?.state, 'CANCELLED');
    await runtime.control(first.id, 'resume');
    await until(() => runtime.store.get<Run>('run', first.id)?.state === 'SUCCEEDED');
    assert.equal(runtime.store.get('output', first.id).value, 'original');
    const third = await runtime.enqueue('test');
    await until(() => runtime.store.get<Run>('run', third.id)?.state === 'SUCCEEDED');
    assert.equal(runtime.store.get('output', third.id).value, 'edited');
  } finally {
    await runtime.shutdown();
    runtime.store.close();
  }
  const reopened = new Runtime(
    path,
    resolve('dist'),
    process.execPath,
    Buffer.from(key),
    async () => [],
  );
  assert.equal(reopened.store.list<Run>('run').filter((r) => r.state === 'SUCCEEDED').length, 2);
  await reopened.shutdown();
  reopened.store.close();
});
test('real TypeScript script runs in isolated process, progress and artifacts persist', async () => {
  const path = await mkdtemp(join(tmpdir(), 'flowark-script-'));
  const runtime = new Runtime(
    path,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  try {
    runtime.saveFlow(
      {
        ...base,
        steps: [
          {
            id: 'script',
            type: 'script',
            version: 1,
            language: 'ts',
            dependencies: [],
            input: { number: 4 },
            code: 'export default async ({input,progress,artifact}) => { const n: number = input.number; progress(1,1); const file = await artifact("test.txt", "fictional"); return {result:n*2,file}; }',
          },
        ],
      },
      { files: {}, credentials: [] },
    );
    const r = await runtime.enqueue('test');
    await until(() =>
      ['SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(runtime.store.get<Run>('run', r.id)!.state),
    );
    assert.equal(
      runtime.store.get<Run>('run', r.id)!.state,
      'SUCCEEDED',
      JSON.stringify(runtime.store.events(r.id)),
    );
    assert.equal(runtime.store.get('output', r.id).script.result, 8);
    assert.ok(runtime.store.events(r.id).some((e) => e.type === 'progress'));
    const artifact = runtime.store.list<any>('artifact')[0];
    assert.equal(await readFile(artifact.path, 'utf8'), 'fictional');
  } finally {
    await runtime.shutdown();
    runtime.store.close();
  }
});
test('unresponsive script is cancelled and releases the device slot', async () => {
  const path = await mkdtemp(join(tmpdir(), 'flowark-cancel-'));
  const runtime = new Runtime(
    path,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  try {
    runtime.saveFlow(
      {
        ...base,
        steps: [
          {
            id: 'hang',
            type: 'script',
            version: 1,
            language: 'js',
            dependencies: [],
            input: null,
            code: 'export default () => { while(true) {} }',
          },
        ],
      },
      { files: {}, credentials: [] },
    );
    const r = await runtime.enqueue('test');
    await until(() => runtime.store.events(r.id).some((e) => e.type === 'node-start'));
    await runtime.control(r.id, 'cancel');
    await until(() => runtime.store.get<Run>('run', r.id)?.state === 'CANCELLED');
    runtime.saveFlow(
      {
        ...base,
        steps: [{ id: 'ok', type: 'value', version: 1, value: true }],
      },
      { files: {}, credentials: [] },
    );
    const second = await runtime.enqueue('test');
    await until(() => runtime.store.get<Run>('run', second.id)?.state === 'SUCCEEDED');
  } finally {
    await runtime.shutdown();
    runtime.store.close();
  }
});
test('schedule sleep gap skips missed runs and keeps original version', async () => {
  const path = await mkdtemp(join(tmpdir(), 'flowark-schedule-'));
  const runtime = new Runtime(
    path,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  try {
    runtime.saveFlow(
      { ...base, steps: [{ id: 'v', type: 'value', version: 1, value: 1 }] },
      { files: {}, credentials: [] },
    );
    const plan = await runtime.request('schedule.save', {
      flowId: 'test',
      intervalMinutes: 1,
      timezone: 'Asia/Shanghai',
    });
    runtime.saveFlow(
      { ...base, steps: [{ id: 'v', type: 'value', version: 1, value: 2 }] },
      { files: {}, credentials: [] },
    );
    runtime.store.put('schedule', plan.id, {
      ...plan,
      nextAt: Date.now() - 100000,
    });
    await runtime.tick(Date.now() + 20000);
    assert.equal(runtime.store.list('run').length, 0);
    assert.ok(runtime.store.list('schedule-log').length);
    assert.equal(runtime.store.get('version', plan.versionId).flow.steps[0].value, 1);
  } finally {
    await runtime.shutdown();
    runtime.store.close();
  }
});

test('script errors are FAILED, worker loss is INTERRUPTED, and secrets never reach run outputs', async () => {
  const secret = 'fictional-private-key-123456';
  const runtime = new Runtime(
    await mkdtemp(join(tmpdir(), 'flowark-faults-')),
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async (method) => (method === 'credentials.list' ? ['deepseek'] : secret),
  );
  const script = (code: string): Flow => ({
    ...base,
    steps: [
      { id: 's', type: 'script', version: 1, language: 'js', dependencies: [], input: null, code },
    ],
  });
  try {
    runtime.saveFlow(script('export default () => { throw new Error("fictional failure"); }'), {
      files: {},
      credentials: [],
    });
    const failed = await runtime.enqueue('test');
    await until(() =>
      ['FAILED', 'INTERRUPTED'].includes(runtime.store.get<Run>('run', failed.id)!.state),
    );
    assert.equal(runtime.store.get<Run>('run', failed.id)!.state, 'FAILED');
    runtime.saveFlow(
      { ...base, steps: [{ id: 'wait', type: 'human', version: 1, message: 'test' }] },
      { files: {}, credentials: [] },
    );
    const lost = await runtime.enqueue('test');
    await until(() => runtime.store.get<Run>('run', lost.id)!.state === 'WAITING_INPUT');
    (runtime as any).active.child.kill('SIGKILL');
    await until(() => runtime.store.get<Run>('run', lost.id)!.state === 'INTERRUPTED');
    runtime.saveFlow(
      script(
        'export default async ({credential,logger}) => { const value = await credential("deepseek"); logger.info(value); return {innocentField:value}; }',
      ),
      { files: {}, credentials: ['deepseek'] },
    );
    const privateRun = await runtime.enqueue('test');
    await until(() => runtime.store.get<Run>('run', privateRun.id)!.state === 'SUCCEEDED');
    assert.ok(
      !JSON.stringify(await runtime.request('run.detail', { id: privateRun.id })).includes(secret),
    );
  } finally {
    await runtime.shutdown();
    runtime.store.close();
  }
});

test('step-boundary pause prevents next side effect, cancel works from paused and waiting states', async () => {
  const runtime = new Runtime(
    await mkdtemp(join(tmpdir(), 'flowark-pause-')),
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  try {
    runtime.saveFlow(
      {
        ...base,
        steps: [
          {
            id: 'delay',
            type: 'script',
            version: 1,
            language: 'js',
            dependencies: [],
            input: null,
            code: 'export default async () => { await new Promise(r=>setTimeout(r,600)); return true; }',
          },
          { id: 'never', type: 'value', version: 1, value: 'must-not-run' },
        ],
      },
      { files: {}, credentials: [] },
    );
    const r = await runtime.enqueue('test');
    await until(() => runtime.store.events(r.id).some((e) => e.type === 'node-start'));
    await runtime.control(r.id, 'pause');
    await until(() => runtime.store.get<Run>('run', r.id)!.state === 'PAUSED');
    assert.ok(
      !runtime.store
        .events(r.id)
        .some((e) => e.nodeInstance === 'never' && e.type === 'node-start'),
    );
    assert.equal(
      runtime.store
        .events(r.id)
        .filter((e) => e.type === 'debug-pause')
        .at(-1)?.nodeInstance,
      'never',
    );
    await runtime.control(r.id, 'cancel');
    await until(() => runtime.store.get<Run>('run', r.id)!.state === 'CANCELLED');
    runtime.saveFlow(
      { ...base, steps: [{ id: 'wait', type: 'human', version: 1, message: 'test' }] },
      { files: {}, credentials: [] },
    );
    const wait = await runtime.enqueue('test');
    await until(() => runtime.store.get<Run>('run', wait.id)!.state === 'WAITING_INPUT');
    await runtime.shutdown();
    assert.equal(runtime.store.get<Run>('run', wait.id)!.state, 'CANCELLED');
  } finally {
    await runtime.shutdown();
    runtime.store.close();
  }
});

test('SQLite event write failure stops admissions and preserves existing history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowark-storage-fault-'));
  const key = randomBytes(32);
  const runtime = new Runtime(
    root,
    resolve('dist'),
    process.execPath,
    Buffer.from(key),
    async () => [],
  );
  runtime.saveFlow({ ...base, id: 'hello' }, { files: {}, credentials: [] });
  const original = runtime.store.list('flow');
  // Actual SQLite write rejection, rather than a mock store that cannot exercise rollback.
  (runtime.store as any).db.exec('PRAGMA query_only=ON');
  assert.throws(() => runtime.store.event('fake-run', 'log', '', { sample: true }));
  assert.ok(runtime.store.fault);
  await assert.rejects(() => runtime.enqueue((original[0] as any).id), /存储写入失败/);
  await runtime.shutdown();
  runtime.store.close();
  const reopened = new Store(join(root, 'flowark.sqlite'), Buffer.from(key));
  assert.deepEqual(reopened.list('flow'), original);
  assert.equal(reopened.events('fake-run').length, 0);
  reopened.close();
});

test('concurrent manual requests stay FIFO and retain content captured before slow admission', async () => {
  const runtime = new Runtime(
    await mkdtemp(join(tmpdir(), 'flowark-admission-')),
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  let release!: () => void;
  let entered = false;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const original = runtime.preflight.bind(runtime);
  runtime.preflight = async (record) => {
    if (record.id === 'slow' && !entered) {
      entered = true;
      await gate;
    }
    return original(record);
  };
  try {
    const flow = (id: string, value: string): Flow => ({
      ...base,
      id,
      steps: [{ id: 'v', type: 'value', version: 1, value }],
    });
    runtime.saveFlow(flow('slow', 'first'), { files: {}, credentials: [] });
    runtime.saveFlow(flow('fast', 'requested'), { files: {}, credentials: [] });
    const first = runtime.enqueue('slow');
    await until(() => entered);
    const second = runtime.enqueue('fast');
    runtime.saveFlow(flow('fast', 'edited-after-request'), { files: {}, credentials: [] });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(runtime.store.list('run').length, 0);
    release();
    const runs = await Promise.all([first, second]);
    await until(() => {
      const states = runs.map((r) => runtime.store.get<Run>('run', r.id)!);
      const failed = states.find((r) => ['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(r.state));
      assert.equal(failed, undefined, 'FIFO execution stopped: ' + JSON.stringify(failed));
      return states.every((r) => r.state === 'SUCCEEDED');
    });
    assert.deepEqual(
      runtime.store.list<Run>('run').map((r) => r.flowId),
      ['slow', 'fast'],
    );
    assert.equal(runtime.store.get('output', runs[1].id).v, 'requested');
  } finally {
    release();
    await runtime.shutdown();
    runtime.store.close();
  }
});

test('shutdown during preflight rejects a late admission without creating a run', async () => {
  const runtime = new Runtime(
    await mkdtemp(join(tmpdir(), 'flowark-admission-exit-')),
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  let release!: () => void;
  let entered = false;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const original = runtime.preflight.bind(runtime);
  runtime.preflight = async (record) => {
    entered = true;
    await gate;
    return original(record);
  };
  try {
    runtime.saveFlow({ ...base, id: 'hello' }, { files: {}, credentials: [] });
    const pending = runtime.enqueue('hello');
    const rejected = assert.rejects(pending, /退出/);
    await until(() => entered);
    await runtime.shutdown();
    release();
    await rejected;
    assert.equal(runtime.store.list('run').length, 0);
  } finally {
    release();
    await runtime.shutdown();
    runtime.store.close();
  }
});

test('schedule occupancy and duplicate triggers never create additional runs; pause revokes pending admission', async () => {
  const runtime = new Runtime(
    await mkdtemp(join(tmpdir(), 'flowark-schedule-races-')),
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  let release: (() => void) | undefined;
  try {
    runtime.saveFlow(
      { ...base, steps: [{ id: 'wait', type: 'human', version: 1, message: 'fixture' }] },
      { files: {}, credentials: [] },
    );
    const plan = await runtime.request('schedule.save', {
      flowId: 'test',
      intervalMinutes: 1,
      timezone: 'Asia/Shanghai',
    });
    const time = Date.now();
    const due = time - 1;
    runtime.store.put('schedule', plan.id, { ...plan, nextAt: due });
    await runtime.tick(time);
    const first = runtime.store.list<Run>('run')[0];
    await until(() => runtime.store.get<Run>('run', first.id)!.state === 'WAITING_INPUT');
    runtime.store.put('schedule', plan.id, {
      ...runtime.store.get('schedule', plan.id),
      nextAt: time + 1,
    });
    await runtime.tick(time + 2);
    assert.equal(runtime.store.list('run').length, 1);
    assert.ok(runtime.store.list<any>('schedule-log').some((log) => log.reason === 'occupied'));
    await assert.rejects(
      runtime.enqueue('test', plan.versionId, plan.id, plan.id + ':' + due, plan.revision),
      /重复计划/,
    );
    await runtime.control(first.id, 'cancel');
    await until(() => runtime.store.get<Run>('run', first.id)!.state === 'CANCELLED');
    let entered = false;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const original = runtime.preflight.bind(runtime);
    runtime.preflight = async (record) => {
      entered = true;
      await gate;
      return original(record);
    };
    runtime.store.put('schedule', plan.id, {
      ...runtime.store.get('schedule', plan.id),
      nextAt: time + 3,
    });
    const tick = runtime.tick(time + 4);
    await until(() => entered);
    await runtime.request('schedule.toggle', { id: plan.id, enabled: false });
    release!();
    await tick;
    assert.equal(runtime.store.list('run').length, 1);
    assert.ok(runtime.store.list<any>('schedule-log').some((log) => log.reason.includes('已暂停')));
  } finally {
    release?.();
    await runtime.shutdown();
    runtime.store.close();
  }
});

test('large wall-clock gaps skip missed windows using the observed clock', async () => {
  const runtime = new Runtime(
    await mkdtemp(join(tmpdir(), 'flowark-clock-')),
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  try {
    const plan = await runtime.request('schedule.save', {
      flowId: runtime.saveFlow({ ...base, id: 'hello' }, { files: {}, credentials: [] }).id,
      intervalMinutes: 1,
      timezone: 'Asia/Shanghai',
    });
    const time = Date.now() + 3600000;
    await runtime.tick(time);
    assert.equal(runtime.store.list('run').length, 0);
    assert.equal(runtime.store.get('schedule', plan.id).nextAt, time + 60000);
  } finally {
    await runtime.shutdown();
    runtime.store.close();
  }
});

test('SIGKILL of actual host stops its script and recovers active/queued runs without replay', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowark-host-crash-'));
  const key = randomBytes(32);
  const pidFile = join(root, 'owned-script.pid');
  const marker = join(root, 'starts.txt');
  async function launch() {
    const proc = child(resolve('dist/host.cjs'), process.execPath);
    const rpc = new Rpc(
      (m) => proc.send(m),
      async () => [],
    );
    proc.on('message', (m) => void rpc.receive(m as any));
    proc.on('exit', () => rpc.close());
    proc.on('error', () => rpc.close());
    await rpc.call('init', {
      dataPath: root,
      executable: process.execPath,
      key: key.toString('base64'),
    });
    return { proc, rpc };
  }
  let host = await launch();
  let scriptPid = 0;
  try {
    const flow: Flow = {
      ...base,
      steps: [
        {
          id: 'owned',
          type: 'script',
          version: 1,
          language: 'js',
          dependencies: [],
          input: { pidFile, marker },
          code: 'import {writeFile,appendFile} from "node:fs/promises"; export default async ({input}) => { await writeFile(input.pidFile,String(process.pid)); await appendFile(input.marker,"started\\n"); await new Promise(()=>{}); }',
        },
      ],
    };
    await host.rpc.call('flow.save', { flow, bindings: { files: {}, credentials: [] } });
    const first = await host.rpc.call('flow.run', { id: 'test' });
    const second = await host.rpc.call('flow.run', { id: 'test' });
    for (let attempt = 0; attempt < 200 && !scriptPid; attempt++) {
      scriptPid = Number(await readFile(pidFile, 'utf8').catch(() => ''));
      if (!scriptPid) await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(scriptPid);
    const exited = new Promise((resolve) => host.proc.once('exit', resolve));
    host.proc.kill('SIGKILL');
    await exited;
    await until(() => {
      try {
        process.kill(scriptPid, 0);
        return false;
      } catch {
        return true;
      }
    });
    host = await launch();
    const data = await host.rpc.call('bootstrap');
    assert.equal(data.runs.find((r: Run) => r.id === first.id).state, 'INTERRUPTED');
    assert.equal(data.runs.find((r: Run) => r.id === second.id).state, 'INTERRUPTED');
    assert.equal(await readFile(marker, 'utf8'), 'started\n');
    await host.rpc.call('shutdown');
  } finally {
    if (host.proc.connected) host.proc.disconnect();
    await killOwnedTree(host.proc);
    host.rpc.close();
  }
});

test('queued scripts and reopened schedules retain frozen local dependencies while new runs adopt changed code', async () => {
  const path = await mkdtemp(join(tmpdir(), 'flowark-frozen-package-'));
  const pkg = join(path, 'local-package');
  const key = randomBytes(32);
  const open = () =>
    new Runtime(path, resolve('dist'), process.execPath, Buffer.from(key), async () => []);
  let runtime = open();
  const completed = async (id: string) => {
    await until(() =>
      ['SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(
        runtime.store.get<Run>('run', id)?.state ?? '',
      ),
    );
    const detail = await runtime.request('run.detail', { id });
    assert.equal(detail.run.state, 'SUCCEEDED', detail.run.error);
    return detail;
  };
  try {
    await mkdir(pkg);
    await writeFile(
      join(pkg, 'package.json'),
      JSON.stringify({ name: 'fixture-package', version: '1.0.0', main: 'index.cjs' }),
    );
    await writeFile(join(pkg, 'index.cjs'), 'module.exports = { value: "original" };');
    const declaration = { name: 'fixture-package', version: '1.0.0' };
    const bindings = {
      files: {},
      credentials: [],
      scriptPackages: { 'fixture-package': { path: pkg, version: '1.0.0' } },
    };
    runtime.saveFlow(
      {
        ...base,
        steps: [
          { id: 'wait', type: 'human', version: 1, message: 'wait for package mutation' },
          {
            id: 'script',
            type: 'script',
            version: 1,
            language: 'ts',
            dependencies: [declaration],
            input: null,
            code: 'import pkg from "fixture-package"; export default async()=>pkg.value;',
          },
        ],
      },
      bindings,
    );
    const schedule = await runtime.request('schedule.save', {
      flowId: base.id,
      intervalMinutes: 60,
      timezone: 'UTC',
    });
    const first = await runtime.enqueue(base.id);
    await until(() => runtime.store.get<Run>('run', first.id)?.state === 'WAITING_INPUT');
    const queued = await runtime.enqueue(base.id);
    await writeFile(join(pkg, 'index.cjs'), 'module.exports = { value: "updated" };');
    const fresh = await runtime.enqueue(base.id);
    assert.equal(first.versionId, queued.versionId);
    assert.notEqual(first.versionId, fresh.versionId);
    assert.equal(schedule.versionId, first.versionId);
    for (const [run, expected] of [
      [first, 'original'],
      [queued, 'original'],
      [fresh, 'updated'],
    ] as const) {
      await until(() => runtime.store.get<Run>('run', run.id)?.state === 'WAITING_INPUT');
      await runtime.control(run.id, 'resume');
      const detail = await completed(run.id);
      assert.equal(detail.output.script, expected);
      assert.deepEqual(detail.scriptBundles[0].dependencies, [declaration]);
    }
    await assert.rejects(
      runtime.request('flow.export', {
        flow: runtime.store.get<any>('flow', base.id).flow,
        reviewed: true,
        path: join(path, 'export.zip'),
      }),
      /静态打包/,
    );
    await writeFile(
      join(pkg, 'package.json'),
      JSON.stringify({ name: 'fixture-package', version: '2.0.0', main: 'index.cjs' }),
    );
    await assert.rejects(runtime.enqueue(base.id), /版本不匹配/);
    await runtime.shutdown();
    runtime.store.close();
    runtime = open();
    await rm(pkg, { recursive: true });
    const scheduled = await runtime.enqueue(
      base.id,
      schedule.versionId,
      schedule.id,
      'frozen-test-trigger',
      schedule.revision,
    );
    await until(() => runtime.store.get<Run>('run', scheduled.id)?.state === 'WAITING_INPUT');
    await runtime.control(scheduled.id, 'resume');
    assert.equal((await completed(scheduled.id)).output.script, 'original');
  } finally {
    await runtime.shutdown();
    runtime.store.close();
    await rm(path, { recursive: true, force: true });
  }
});

test('missing or tampered compiled code is never rebuilt or executed after a wait or in the queue', async () => {
  for (const mutation of ['missing', 'tampered']) {
    const path = await mkdtemp(join(tmpdir(), 'flowark-bundle-integrity-'));
    const marker = join(path, 'side-effect');
    const runtime = new Runtime(
      path,
      resolve('dist'),
      process.execPath,
      randomBytes(32),
      async () => [],
    );
    try {
      runtime.saveFlow(
        {
          ...base,
          steps: [
            { id: 'wait', type: 'human', version: 1, message: 'wait for integrity test' },
            {
              id: 'script',
              type: 'script',
              version: 1,
              language: 'js',
              dependencies: [],
              input: null,
              code: `import fs from 'node:fs'; export default async()=>{fs.writeFileSync(${JSON.stringify(marker)},'ran');return true;};`,
            },
          ],
        },
        { files: {}, credentials: [] },
      );
      const active = await runtime.enqueue(base.id);
      await until(() => runtime.store.get<Run>('run', active.id)?.state === 'WAITING_INPUT');
      const queued = await runtime.enqueue(base.id);
      const artifact = runtime.store.get<any>('snapshot', active.id).scripts.script;
      if (mutation === 'missing') await rm(artifact);
      else
        await writeFile(
          artifact,
          `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)},'tampered'); export default()=>true;`,
        );
      await runtime.control(active.id, 'resume');
      for (const run of [active, queued]) {
        await until(() =>
          ['SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(
            runtime.store.get<Run>('run', run.id)?.state ?? '',
          ),
        );
        const state = runtime.store.get<Run>('run', run.id)!;
        assert.equal(state.state, 'FAILED', JSON.stringify(state));
        assert.match(state.error ?? '', /丢失|摘要不匹配/);
      }
      await assert.rejects(access(marker));
      if (mutation === 'missing') await assert.rejects(access(artifact));
      else assert.match(await readFile(artifact, 'utf8'), /tampered/);
    } finally {
      await runtime.shutdown();
      runtime.store.close();
      await rm(path, { recursive: true, force: true });
    }
  }
});

test('legacy fixed source without dependencies remains runnable and legacy unfrozen dependency plans require resaving', async () => {
  const path = await mkdtemp(join(tmpdir(), 'flowark-legacy-script-'));
  const runtime = new Runtime(
    path,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  try {
    const record = runtime.saveFlow(
      {
        ...base,
        steps: [
          {
            id: 'script',
            type: 'script',
            version: 1,
            language: 'ts',
            dependencies: [],
            input: null,
            code: 'export default async()=>42',
          },
        ],
      },
      { files: {}, credentials: [] },
    );
    runtime.store.put('version', 'legacy', { ...record, versionId: 'legacy' });
    const run = await runtime.enqueue(base.id, 'legacy');
    await until(() =>
      ['SUCCEEDED', 'FAILED'].includes(runtime.store.get<Run>('run', run.id)?.state ?? ''),
    );
    assert.equal(runtime.store.get<Run>('run', run.id)?.state, 'SUCCEEDED');
    assert.equal(runtime.store.get('output', run.id).script, 42);
    const bad = structuredClone(record);
    (bad.flow.steps[0] as any).dependencies = [{ name: 'fixture-package', version: '1.0.0' }];
    runtime.store.put('version', 'legacy-deps', { ...bad, versionId: 'legacy-deps' });
    await assert.rejects(runtime.enqueue(base.id, 'legacy-deps'), /重新保存计划/);
  } finally {
    await runtime.shutdown();
    runtime.store.close();
    await rm(path, { recursive: true, force: true });
  }
});

test('system suspend cancels active and queued work and resume never replays either run', async () => {
  const path = await mkdtemp(join(tmpdir(), 'flowark-suspend-runtime-'));
  const runtime = new Runtime(
    path,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  try {
    const flow: Flow = {
      ...base,
      steps: [
        { id: 'wait', type: 'human', version: 1, message: 'fixture' },
        {
          id: 'write',
          type: 'file',
          version: 1,
          operation: 'write',
          binding: 'work',
          name: 'must-not-write.txt',
          content: 'unexpected',
        },
      ],
    };
    runtime.saveFlow(flow, { files: { work: path }, credentials: [] });
    const active = await runtime.enqueue(flow.id);
    await until(() => runtime.store.get<Run>('run', active.id)?.state === 'WAITING_INPUT');
    const queued = await runtime.enqueue(flow.id);
    await runtime.request('system.suspend');
    await until(() => runtime.store.get<Run>('run', active.id)?.state === 'CANCELLED');
    assert.equal(runtime.store.get<Run>('run', queued.id)?.state, 'CANCELLED');
    await assert.rejects(runtime.enqueue(flow.id), /休眠/);
    assert.ok(runtime.store.events(active.id).some((e) => e.type === 'system-suspend'));
    assert.equal(
      runtime.store.list<any>('attention').filter((a) => a.title.includes('休眠')).length,
      1,
    );
    await runtime.request('system.resume');
    await runtime.tick();
    assert.equal(runtime.store.get<Run>('run', active.id)?.state, 'CANCELLED');
    assert.equal(runtime.store.get<Run>('run', queued.id)?.state, 'CANCELLED');
    await assert.rejects(access(join(path, 'must-not-write.txt')));
    const fresh = await runtime.enqueue(flow.id);
    await until(() => runtime.store.get<Run>('run', fresh.id)?.state === 'WAITING_INPUT');
    await runtime.control(fresh.id, 'cancel');
    await until(() => runtime.store.get<Run>('run', fresh.id)?.state === 'CANCELLED');
  } finally {
    await runtime.shutdown();
  }
});

test('picker requests require a paused boundary and resume clears picking before releasing the Worker', async () => {
  const path = await mkdtemp(join(tmpdir(), 'flowark-picker-policy-'));
  let release!: () => void;
  let cancellingPicker = false;
  const cancelled = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  const runtime = new Runtime(
    path,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async (method) => {
      calls.push(method);
      if (method === 'browser.embedded.pick.cancel') {
        cancellingPicker = true;
        await cancelled;
      }
      return [];
    },
  );
  try {
    runtime.saveFlow(
      { ...base, steps: [{ id: 'value', type: 'value', version: 1, value: 'test' }] },
      { files: {}, credentials: [] },
    );
    const run = await runtime.request('flow.run', { id: base.id, debug: true });
    await until(() => runtime.store.get<Run>('run', run.id)?.state === 'PAUSED');
    await runtime.request('browser.embedded.pick.start', { requestId: 'editor' });
    assert.ok(calls.includes('browser.embedded.pick.start'));
    const resume = runtime.control(run.id, 'resume');
    await until(() => cancellingPicker);
    await assert.rejects(
      runtime.request('browser.embedded.pick.start', { requestId: 'racing' }),
      /先暂停/,
    );
    await assert.rejects(
      runtime.request('browser.embedded.pick.validate', { selector: '#test', framePath: [] }),
      /先暂停/,
    );
    assert.equal(runtime.store.events(run.id).filter((e) => e.type === 'node-start').length, 0);
    release();
    await resume;
    await until(() => runtime.store.get<Run>('run', run.id)?.state === 'SUCCEEDED');
  } finally {
    release();
    await runtime.shutdown();
  }
});

test('real Worker preserves each registration across repeated outputs, later runs and host restart; legacy files remain unverified', async () => {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'flowark-history-copies-')));
  const key = randomBytes(32);
  const start = () =>
    new Runtime(path, resolve('dist'), process.execPath, Buffer.from(key), async () => []);
  let runtime = start();
  try {
    const steps: Flow['steps'] = ['first', 'later'].map((content, i) => ({
      id: 'write' + i,
      type: 'file',
      version: 1,
      operation: 'write',
      binding: 'work',
      name: 'result.txt',
      content,
    }));
    runtime.saveFlow({ ...base, steps }, { files: { work: path }, credentials: [] });
    const run = await runtime.enqueue(base.id);
    await until(() =>
      ['SUCCEEDED', 'FAILED'].includes(runtime.store.get<Run>('run', run.id)?.state ?? ''),
    );
    let detail = await runtime.request('run.detail', { id: run.id });
    assert.equal(detail.run.state, 'SUCCEEDED', detail.run.error);
    const [first, later] = detail.artifacts;
    assert.equal(detail.artifacts.length, 2);
    assert.notEqual(first.path, later.path);
    assert.equal(await readFile(first.path, 'utf8'), 'first');
    assert.equal(await readFile(later.path, 'utf8'), 'later');
    runtime.saveFlow(
      { ...base, steps: [{ ...steps[0], content: 'third' } as any] },
      { files: { work: path }, credentials: [] },
    );
    const next = await runtime.enqueue(base.id);
    await until(() =>
      ['SUCCEEDED', 'FAILED'].includes(runtime.store.get<Run>('run', next.id)?.state ?? ''),
    );
    assert.equal(runtime.store.get<Run>('run', next.id)?.state, 'SUCCEEDED');
    assert.equal(await readFile(join(path, 'result.txt'), 'utf8'), 'third');
    assert.equal(await readFile(first.path, 'utf8'), 'first');
    assert.equal(await readFile(later.path, 'utf8'), 'later');
    runtime.store.put('artifact', 'legacy', {
      artifactId: 'legacy',
      runId: run.id,
      name: 'legacy.txt',
      path: join(path, 'legacy.txt'),
      size: 4,
      time: new Date().toISOString(),
    });
    await writeFile(join(path, 'legacy.txt'), 'then');
    await rm(join(path, 'result.txt'));
    const events = runtime.store.events(run.id);
    await runtime.shutdown();
    runtime.store.close();
    runtime = start();
    detail = await runtime.request('run.detail', { id: run.id });
    assert.equal(detail.run.state, 'SUCCEEDED');
    assert.deepEqual(
      detail.artifacts.map((a: any) => a.integrity),
      ['verified', 'verified', 'unverified'],
    );
    await writeFile(join(path, 'legacy.txt'), 'now!');
    assert.equal(
      await runtime.request('artifact.resolve', { id: 'legacy' }),
      join(path, 'legacy.txt'),
    );
    await writeFile(first.path, 'other');
    detail = await runtime.request('run.detail', { id: run.id });
    assert.equal(detail.artifacts[0].integrity, 'changed');
    await assert.rejects(
      runtime.request('artifact.resolve', { id: first.artifactId }),
      /副本内容已改动/,
    );
    await rm(join(path, 'legacy.txt'));
    await assert.rejects(runtime.request('artifact.resolve', { id: 'legacy' }), /移动、删除/);
    await symlink(later.path, join(path, 'legacy.txt'));
    assert.equal(
      (await runtime.request('run.detail', { id: run.id })).artifacts[2].available,
      false,
    );
    assert.deepEqual(runtime.store.events(run.id), events);
    assert.equal(runtime.store.get<Run>('run', run.id)?.state, 'SUCCEEDED');
  } finally {
    await runtime.shutdown();
    runtime.store.close();
    key.fill(0);
    await rm(path, { recursive: true, force: true });
  }
});

test('artifact event failure rolls back its index and removes only the unpublished copy', async () => {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'flowark-artifact-transaction-')));
  const runtime = new Runtime(
    path,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  const files = (runtime as any).artifactFiles;
  const capture = files.capture.bind(files);
  let copied: any;
  files.capture = async (...args: any[]) => (copied = await capture(...args));
  const event = runtime.store.event.bind(runtime.store);
  runtime.store.event = (...args) => {
    if (args[1] === 'artifact') throw new Error('fixture artifact event failure');
    return event(...args);
  };
  try {
    runtime.saveFlow(
      {
        ...base,
        steps: [
          {
            id: 'output',
            type: 'file',
            version: 1,
            operation: 'write',
            binding: 'work',
            name: 'result.txt',
            content: 'keep',
          },
          {
            id: 'later',
            type: 'file',
            version: 1,
            operation: 'write',
            binding: 'work',
            name: 'later.txt',
            content: 'must not run',
          },
        ],
      },
      { files: { work: path }, credentials: [] },
    );
    const run = await runtime.enqueue(base.id);
    await until(() => runtime.store.get<Run>('run', run.id)?.state === 'FAILED');
    assert.match(runtime.store.get<Run>('run', run.id)!.error!, /fixture artifact event failure/);
    assert.equal(runtime.store.list('artifact').length, 0);
    assert.equal(runtime.store.events(run.id).filter((e) => e.type === 'artifact').length, 0);
    assert.equal(await readFile(join(path, 'result.txt'), 'utf8'), 'keep');
    await assert.rejects(access(copied.path), { code: 'ENOENT' });
    await assert.rejects(access(join(path, 'later.txt')), { code: 'ENOENT' });
  } finally {
    await runtime.shutdown();
    runtime.store.close();
    await rm(path, { recursive: true, force: true });
  }
});

test('cancelled registration discards a late completed copy without publishing or replaying the business file', async () => {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'flowark-artifact-cancel-')));
  const runtime = new Runtime(
    path,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  const files = (runtime as any).artifactFiles;
  const capture = files.capture.bind(files),
    discard = files.discard.bind(files);
  let copied: any,
    discarded = false,
    release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  files.capture = async (...args: any[]) => {
    copied = await capture(...args);
    await gate;
    return copied;
  };
  files.discard = async (...args: any[]) => {
    await discard(...args);
    discarded = true;
  };
  try {
    runtime.saveFlow(
      {
        ...base,
        steps: [
          {
            id: 'output',
            type: 'file',
            version: 1,
            operation: 'write',
            binding: 'work',
            name: 'result.txt',
            content: 'keep',
          },
          { id: 'later', type: 'value', version: 1, value: 'must not run' },
        ],
      },
      { files: { work: path }, credentials: [] },
    );
    const run = await runtime.enqueue(base.id);
    await until(() => !!copied);
    await runtime.control(run.id, 'cancel');
    await until(
      () =>
        runtime.store.get<Run>('run', run.id)?.state === 'CANCELLED' && !(runtime as any).active,
    );
    await assert.rejects(runtime.request('run.artifacts.preview', { id: run.id }), /仍在收尾/);
    release();
    await until(() => discarded && runtime.store.get<Run>('run', run.id)?.state === 'CANCELLED');
    await until(() => !(runtime as any).pendingCapabilities.has(run.id));
    assert.equal((await runtime.request('run.artifacts.preview', { id: run.id })).count, 0);
    assert.equal(runtime.store.list('artifact').length, 0);
    assert.equal(runtime.store.events(run.id).filter((e) => e.type === 'artifact').length, 0);
    assert.ok(!runtime.store.events(run.id).some((e) => e.nodeInstance === 'later'));
    assert.equal(await readFile(join(path, 'result.txt'), 'utf8'), 'keep');
    await assert.rejects(access(copied.path), { code: 'ENOENT' });
  } finally {
    release();
    await runtime.shutdown();
    runtime.store.close();
    await rm(path, { recursive: true, force: true });
  }
});

test('real Worker artifacts can be cleared only after completion; history, later run and business output survive restart', async () => {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'flowark-cleanup-runtime-')));
  const key = randomBytes(32);
  const start = () =>
    new Runtime(path, resolve('dist'), process.execPath, Buffer.from(key), async () => []);
  let runtime = start();
  try {
    const write: Flow['steps'][number] = {
      id: 'write',
      type: 'file',
      version: 1,
      operation: 'write',
      binding: 'work',
      name: 'result.txt',
      content: 'first',
    };
    runtime.saveFlow(
      {
        ...base,
        steps: [write, { id: 'human', type: 'human', version: 1, message: 'fixture wait' }],
      },
      { files: { work: path }, credentials: [] },
    );
    const first = await runtime.enqueue(base.id);
    await until(() => runtime.store.get<Run>('run', first.id)?.state === 'WAITING_INPUT');
    await assert.rejects(runtime.request('run.artifacts.preview', { id: first.id }), /尚未结束/);
    await runtime.control(first.id, 'resume');
    await until(
      () =>
        runtime.store.get<Run>('run', first.id)?.state === 'SUCCEEDED' && !(runtime as any).active,
    );
    runtime.saveFlow(
      { ...base, steps: [{ ...write, content: 'later' } as any] },
      { files: { work: path }, credentials: [] },
    );
    const second = await runtime.enqueue(base.id);
    await until(
      () =>
        runtime.store.get<Run>('run', second.id)?.state === 'SUCCEEDED' && !(runtime as any).active,
    );
    const before = await runtime.request('run.detail', { id: first.id });
    const other = await runtime.request('run.detail', { id: second.id });
    const preview = await runtime.request('run.artifacts.preview', { id: first.id });
    assert.equal(preview.count, 1);
    const result = await runtime.request('run.artifacts.clear', {
      id: first.id,
      token: preview.token,
      reviewed: true,
    });
    assert.equal(result.state, 'completed');
    await assert.rejects(
      runtime.request('artifact.resolve', { id: before.artifacts[0].artifactId }),
      /已清理/,
    );
    assert.equal(await readFile(other.artifacts[0].path, 'utf8'), 'later');
    assert.equal(await readFile(join(path, 'result.txt'), 'utf8'), 'later');
    await runtime.shutdown();
    runtime.store.close();
    runtime = start();
    const after = await runtime.request('run.detail', { id: first.id });
    assert.deepEqual(after.run, before.run);
    assert.deepEqual(after.snapshot, before.snapshot);
    assert.deepEqual(after.output, before.output);
    assert.deepEqual(after.events.slice(0, -1), before.events);
    assert.equal(after.events.at(-1).data.action, 'cleanup');
    assert.equal(after.artifacts[0].integrity, 'cleared');
    assert.equal(after.artifacts[0].available, false);
    assert.equal(after.artifactCleanup.state, 'completed');
    assert.equal(
      (await runtime.request('run.detail', { id: second.id })).artifacts[0].integrity,
      'verified',
    );
  } finally {
    await runtime.shutdown();
    runtime.store.close();
    key.fill(0);
    await rm(path, { recursive: true, force: true });
  }
});

test('real waiting Worker stays visible beyond 200 queued runs and history reaches its old result', async () => {
  const path = await mkdtemp(join(tmpdir(), 'flowark-history-runtime-'));
  const runtime = new Runtime(
    path,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  try {
    runtime.saveFlow(
      {
        ...base,
        id: 'older-flow',
        steps: [{ id: 'result', type: 'value', version: 1, value: 'older result' }],
      },
      { files: {}, credentials: [] },
    );
    const older = await runtime.enqueue('older-flow');
    await until(
      () =>
        runtime.store.get<Run>('run', older.id)?.state === 'SUCCEEDED' && !(runtime as any).active,
    );
    runtime.saveFlow(
      { ...base, steps: [{ id: 'wait', type: 'human', version: 1, message: 'fixture' }] },
      { files: {}, credentials: [] },
    );
    const active = await runtime.enqueue(base.id);
    await until(() => runtime.store.get<Run>('run', active.id)?.state === 'WAITING_INPUT');
    for (let i = 0; i < 205; i++) await runtime.enqueue(base.id);
    const data = await runtime.bootstrap();
    assert.equal(data.runs.length, 200);
    assert.ok(!data.runs.some((r) => r.id === active.id));
    assert.equal(data.runOverview.active?.id, active.id);
    assert.equal(data.runOverview.queued, 205);
    assert.equal(data.runOverview.total, 207);
    assert.equal(data.runOverview.latest.find((r) => r.flowId === 'older-flow')?.id, older.id);
    const page = await runtime.request('run.list', { state: 'WAITING_INPUT' });
    assert.deepEqual(
      page.runs.map((r: Run) => r.id),
      [active.id],
    );
    const history = await runtime.request('run.list', { query: older.id });
    assert.equal(history.runs[0].id, older.id);
    assert.equal(
      (await runtime.request('run.detail', { id: older.id })).output.result,
      'older result',
    );
  } finally {
    await runtime.shutdown();
    runtime.store.close();
    await rm(path, { recursive: true, force: true });
  }
});

test('schedule edits preserve paused state and frozen queued work; adopting a saved draft is explicit', async () => {
  const path = await mkdtemp(join(tmpdir(), 'flowark-schedule-edit-'));
  const key = randomBytes(32);
  let runtime = new Runtime(
    path,
    resolve('dist'),
    process.execPath,
    Buffer.from(key),
    async () => [],
  );
  const bindings = { files: {}, credentials: [] };
  const flow = (value: string): Flow => ({
    ...base,
    steps: [
      { id: 'value', type: 'value', version: 1, value },
      { id: 'wait', type: 'human', version: 1, message: 'fixture' },
    ],
  });
  try {
    runtime.saveFlow(flow('original'), bindings);
    const plan = await runtime.request('schedule.save', {
      flowId: base.id,
      intervalMinutes: 30,
      timezone: 'UTC',
    });
    const first = await runtime.enqueue(base.id, plan.versionId, plan.id, 'first', plan.revision);
    await until(() => runtime.store.get<Run>('run', first.id)?.state === 'WAITING_INPUT');
    const queued = await runtime.enqueue(base.id, plan.versionId, plan.id, 'second', plan.revision);
    const saved = runtime.saveFlow(flow('updated'), bindings);
    await runtime.request('schedule.toggle', { id: plan.id, enabled: false });
    const paused = runtime.store.get('schedule', plan.id);
    const unchanged = await runtime.request('schedule.update', {
      id: plan.id,
      revision: paused.revision,
      intervalMinutes: 5,
      timezone: 'Asia/Tokyo',
      adoptLatest: false,
    });
    assert.equal(unchanged.enabled, false);
    assert.equal(unchanged.versionId, plan.versionId);
    assert.notEqual(unchanged.revision, paused.revision);
    const beforeAdopt = Date.now();
    const changed = await runtime.request('schedule.update', {
      id: plan.id,
      revision: unchanged.revision,
      intervalMinutes: 6,
      timezone: 'Asia/Shanghai',
      adoptLatest: true,
      flowUpdatedAt: saved.updatedAt,
    });
    assert.equal(changed.enabled, false);
    assert.notEqual(changed.versionId, plan.versionId);
    assert.ok(changed.nextAt >= beforeAdopt + 360000);
    assert.equal(runtime.store.get('snapshot', first.id).versionId, plan.versionId);
    assert.equal(runtime.store.get('snapshot', queued.id).versionId, plan.versionId);
    assert.equal(runtime.store.list('run').length, 2);
    for (const id of [first.id, queued.id]) {
      await until(() => runtime.store.get<Run>('run', id)?.state === 'WAITING_INPUT');
      await runtime.control(id, 'resume');
      await until(() => runtime.store.get<Run>('run', id)?.state === 'SUCCEEDED');
      assert.equal((await runtime.request('run.detail', { id })).output.value, 'original');
    }
    await assert.rejects(
      runtime.request('schedule.update', {
        id: plan.id,
        revision: unchanged.revision,
        intervalMinutes: 10,
        timezone: 'UTC',
        adoptLatest: false,
      }),
      /计划已改变/,
    );
    assert.deepEqual(runtime.store.get('schedule', plan.id), changed);
    await runtime.request('schedule.toggle', { id: plan.id, enabled: true });
    const enabled = runtime.store.get('schedule', plan.id);
    const updated = await runtime.request('schedule.update', {
      id: plan.id,
      revision: enabled.revision,
      intervalMinutes: 12,
      timezone: 'UTC',
      adoptLatest: false,
    });
    assert.equal(updated.enabled, true);
    assert.equal(updated.versionId, changed.versionId);
    const latest = await runtime.enqueue(
      base.id,
      changed.versionId,
      plan.id,
      'third',
      updated.revision,
    );
    await until(() => runtime.store.get<Run>('run', latest.id)?.state === 'WAITING_INPUT');
    await runtime.control(latest.id, 'resume');
    await until(() => runtime.store.get<Run>('run', latest.id)?.state === 'SUCCEEDED');
    assert.equal((await runtime.request('run.detail', { id: latest.id })).output.value, 'updated');
    await runtime.shutdown();
    runtime.store.close();
    runtime = new Runtime(
      path,
      resolve('dist'),
      process.execPath,
      Buffer.from(key),
      async () => [],
    );
    assert.deepEqual(runtime.store.get('schedule', plan.id), updated);
    const legacy = { ...updated };
    delete legacy.revision;
    runtime.store.put('schedule', plan.id, legacy);
    const migrated = await runtime.request('schedule.update', {
      id: plan.id,
      revision: null,
      intervalMinutes: 12,
      timezone: 'UTC',
      adoptLatest: false,
    });
    assert.ok(migrated.revision);
    assert.equal(migrated.versionId, updated.versionId);
  } finally {
    await runtime.shutdown();
    runtime.store.close();
    key.fill(0);
  }
});

test('schedule update rejects failed preflight and invalid input without replacing the original plan', async () => {
  const runtime = new Runtime(
    await mkdtemp(join(tmpdir(), 'flowark-schedule-invalid-')),
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  try {
    runtime.saveFlow(
      { ...base, steps: [{ id: 'v', type: 'value', version: 1, value: 'old' }] },
      { files: {}, credentials: [] },
    );
    const plan = await runtime.request('schedule.save', {
      flowId: base.id,
      intervalMinutes: 30,
      timezone: 'UTC',
    });
    const args = {
      id: plan.id,
      revision: plan.revision,
      intervalMinutes: 5,
      timezone: 'UTC',
      adoptLatest: false,
    };
    for (const change of [
      { timezone: 'Invalid/Zone' },
      { intervalMinutes: -1 },
      { enabled: false },
      { id: 'missing' },
    ]) {
      await assert.rejects(runtime.request('schedule.update', { ...args, ...change }));
      assert.deepEqual(runtime.store.get('schedule', plan.id), plan);
    }
    const record = runtime.saveFlow(
      {
        ...base,
        steps: [
          {
            id: 'open',
            type: 'browser',
            version: 3,
            operation: 'navigate',
            selector: '',
            framePath: [],
            value: 'http://127.0.0.1',
          },
        ],
      },
      { files: {}, credentials: [] },
    );
    await assert.rejects(
      runtime.request('schedule.update', {
        ...args,
        adoptLatest: true,
        flowUpdatedAt: record.updatedAt,
      }),
      /浏览器/,
    );
    assert.deepEqual(runtime.store.get('schedule', plan.id), plan);
    const preserved = await runtime.request('schedule.update', args);
    assert.equal(
      preserved.versionId,
      plan.versionId,
      'timing-only edit must not preflight a different draft',
    );
    assert.equal(runtime.store.list('run').length, 0);
  } finally {
    await runtime.shutdown();
    runtime.store.close();
  }
});

test('schedule update cannot overwrite a pause, competing edit, timer trigger, or saved-flow change during preflight', async () => {
  const runtime = new Runtime(
    await mkdtemp(join(tmpdir(), 'flowark-schedule-update-races-')),
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  const original = runtime.preflight.bind(runtime);
  let release = () => {};
  try {
    for (const scenario of ['pause', 'edit', 'trigger', 'draft'] as const) {
      runtime.preflight = original;
      const record = runtime.saveFlow(
        { ...base, steps: [{ id: 'v', type: 'value', version: 1, value: scenario }] },
        { files: {}, credentials: [] },
      );
      const plan = await runtime.request('schedule.save', {
        flowId: base.id,
        intervalMinutes: 30,
        timezone: 'UTC',
      });
      if (scenario === 'trigger') {
        plan.nextAt = Date.now() - 1;
        runtime.store.put('schedule', plan.id, plan);
      }
      let entered = false;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      runtime.preflight = async (r) => {
        entered = true;
        await gate;
        return original(r);
      };
      const pending = runtime.request('schedule.update', {
        id: plan.id,
        revision: plan.revision,
        intervalMinutes: 10,
        timezone: 'UTC',
        adoptLatest: true,
        flowUpdatedAt: record.updatedAt,
      });
      const rejected = assert.rejects(
        pending,
        scenario === 'draft' ? /流程已改变/ : /计划已改变/,
        scenario,
      );
      await until(() => entered);
      if (scenario === 'pause')
        await runtime.request('schedule.toggle', { id: plan.id, enabled: false });
      if (scenario === 'edit')
        await runtime.request('schedule.update', {
          id: plan.id,
          revision: plan.revision,
          intervalMinutes: 7,
          timezone: 'Asia/Tokyo',
          adoptLatest: false,
        });
      if (scenario === 'draft')
        runtime.saveFlow({ ...record.flow, name: 'different saved draft' }, record.bindings);
      if (scenario === 'trigger') {
        // Actual tick, but an injected due time: race test, not wall-clock acceptance.
        runtime.preflight = original;
        await runtime.tick();
      }
      const expected = runtime.store.get('schedule', plan.id);
      release();
      await rejected;
      assert.deepEqual(runtime.store.get('schedule', plan.id), expected);
      await runtime.request('schedule.toggle', { id: plan.id, enabled: false });
    }
  } finally {
    release();
    await runtime.shutdown();
    runtime.store.close();
  }
});

test('real Worker creates text from a fixed snapshot; repeated explicit runs fail without overwriting or reporting artifacts', async (t) => {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'flowark-create-worker-')));
  const output = join(path, 'output');
  await mkdir(output);
  const runtime = new Runtime(
    path,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  t.after(async () => {
    await runtime.shutdown();
    runtime.store.close();
    await rm(path, { recursive: true, force: true });
  });
  const flow: Flow = {
    ...base,
    parameters: { title: '已核对的网页标题 💡' },
    requiredCapabilities: ['file-create-v1'],
    steps: [
      { id: 'title', type: 'value', version: 1, value: { $ref: 'params.title' } },
      { id: 'wait', type: 'human', version: 1, message: '固定快照验收' },
      {
        id: 'save',
        type: 'file',
        version: 3,
        operation: 'create',
        binding: 'output',
        name: 'title.txt',
        content: { $ref: 'steps.title' },
      },
      { id: 'after', type: 'value', version: 1, value: 'reached only after success' },
    ],
  };
  const bindings = { files: { output }, credentials: [] };
  runtime.saveFlow(flow, bindings);
  const run = await runtime.enqueue(flow.id);
  await until(() => runtime.store.get<Run>('run', run.id)?.state === 'WAITING_INPUT');
  const before = runtime.store.get<any>('snapshot', run.id);
  runtime.saveFlow({ ...flow, parameters: { title: '下一次的文字' } }, bindings);
  await runtime.control(run.id, 'resume');
  await until(() => ['SUCCEEDED', 'FAILED'].includes(runtime.store.get<Run>('run', run.id)!.state));
  assert.equal(
    runtime.store.get<Run>('run', run.id)!.state,
    'SUCCEEDED',
    JSON.stringify(runtime.store.events(run.id)),
  );
  assert.equal(await readFile(join(output, 'title.txt'), 'utf8'), flow.parameters.title);
  assert.deepEqual(runtime.store.get('snapshot', run.id), before);
  const first = (await runtime.request('run.detail', { id: run.id })).artifacts;
  assert.equal(first.length, 1);
  assert.equal(first[0].integrity, 'verified');
  const second = await runtime.enqueue(flow.id);
  await until(() => runtime.store.get<Run>('run', second.id)?.state === 'WAITING_INPUT');
  await runtime.control(second.id, 'resume');
  await until(() =>
    ['SUCCEEDED', 'FAILED'].includes(runtime.store.get<Run>('run', second.id)!.state),
  );
  assert.equal(runtime.store.get<Run>('run', second.id)!.state, 'FAILED');
  assert.match(runtime.store.get<Run>('run', second.id)!.error!, /已存在/);
  assert.equal((await runtime.request('run.detail', { id: second.id })).artifacts.length, 0);
  assert.ok(
    !runtime.store
      .events(second.id)
      .some((e) => e.type === 'node-start' && e.nodeInstance === 'after'),
  );
  assert.equal(await readFile(join(output, 'title.txt'), 'utf8'), flow.parameters.title);
  assert.equal(runtime.store.list('run').length, 2);
  assert.equal(await readFile(first[0].path, 'utf8'), flow.parameters.title);
});

test('numbered Worker output keeps its fixed conflict policy and actual artifact across draft edits and explicit runs', async (t) => {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'flowark-numbered-worker-')));
  const output = join(path, 'output');
  await mkdir(output);
  await writeFile(join(output, 'title.txt'), 'original protected bytes');
  const runtime = new Runtime(
    path,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async () => [],
  );
  t.after(async () => {
    await runtime.shutdown();
    runtime.store.close();
    await rm(path, { recursive: true, force: true });
  });
  const save: Step = {
    id: 'save',
    type: 'file',
    version: 4,
    operation: 'create',
    onConflict: 'number',
    binding: 'output',
    name: { $ref: 'params.name' },
    content: { $ref: 'steps.title' },
  };
  const flow: Flow = {
    ...base,
    parameters: { name: 'title.txt', title: '固定序号策略的网页标题 💡' },
    requiredCapabilities: ['file-create-numbered-v1'],
    steps: [
      { id: 'title', type: 'value', version: 1, value: { $ref: 'params.title' } },
      { id: 'wait', type: 'human', version: 1, message: '等待修改下一次策略' },
      save,
    ],
  };
  const { onConflict: _, ...stop } = save;
  const stopFlow: Flow = {
    ...flow,
    requiredCapabilities: ['file-create-v1'],
    steps: [...flow.steps.slice(0, 2), { ...stop, version: 3 }],
  };
  const bindings = { files: { output }, credentials: [] };
  runtime.saveFlow(flow, bindings);
  const first = await runtime.enqueue(flow.id);
  await until(() => runtime.store.get<Run>('run', first.id)?.state === 'WAITING_INPUT');
  const snapshot = runtime.store.get('snapshot', first.id);
  runtime.saveFlow(stopFlow, bindings);
  await runtime.control(first.id, 'resume');
  await until(() =>
    ['SUCCEEDED', 'FAILED'].includes(runtime.store.get<Run>('run', first.id)!.state),
  );
  const firstDetail = await runtime.request('run.detail', { id: first.id });
  assert.equal(firstDetail.run.state, 'SUCCEEDED', firstDetail.run.error);
  assert.deepEqual(runtime.store.get('snapshot', first.id), snapshot);
  assert.equal(firstDetail.artifacts.length, 1);
  assert.equal(firstDetail.artifacts[0].name, 'title (1).txt');
  assert.equal(firstDetail.artifacts[0].integrity, 'verified');
  assert.equal(await readFile(join(output, 'title (1).txt'), 'utf8'), flow.parameters.title);
  const second = await runtime.enqueue(flow.id);
  await until(() => runtime.store.get<Run>('run', second.id)?.state === 'WAITING_INPUT');
  const stopSnapshot = runtime.store.get('snapshot', second.id);
  runtime.saveFlow({ ...flow, parameters: { ...flow.parameters, title: '显式新运行' } }, bindings);
  await runtime.control(second.id, 'resume');
  await until(() =>
    ['SUCCEEDED', 'FAILED'].includes(runtime.store.get<Run>('run', second.id)!.state),
  );
  const secondDetail = await runtime.request('run.detail', { id: second.id });
  assert.equal(secondDetail.run.state, 'FAILED');
  assert.match(secondDetail.run.error!, /已存在/);
  assert.equal(secondDetail.artifacts.length, 0);
  assert.deepEqual(runtime.store.get('snapshot', second.id), stopSnapshot);
  const third = await runtime.enqueue(flow.id);
  await until(() => runtime.store.get<Run>('run', third.id)?.state === 'WAITING_INPUT');
  await runtime.control(third.id, 'resume');
  await until(() =>
    ['SUCCEEDED', 'FAILED'].includes(runtime.store.get<Run>('run', third.id)!.state),
  );
  const thirdDetail = await runtime.request('run.detail', { id: third.id });
  assert.equal(thirdDetail.run.state, 'SUCCEEDED', thirdDetail.run.error);
  assert.equal(thirdDetail.artifacts.length, 1);
  assert.equal(thirdDetail.artifacts[0].name, 'title (2).txt');
  assert.equal(thirdDetail.artifacts[0].integrity, 'verified');
  assert.equal(await readFile(join(output, 'title (2).txt'), 'utf8'), '显式新运行');
  assert.equal(await readFile(thirdDetail.artifacts[0].path, 'utf8'), '显式新运行');
  await writeFile(join(output, 'title (1).txt'), 'external later edit');
  assert.equal(await readFile(firstDetail.artifacts[0].path, 'utf8'), flow.parameters.title);
  assert.equal(await readFile(join(output, 'title.txt'), 'utf8'), 'original protected bytes');
  assert.deepEqual((await readdir(output)).sort(), ['title (1).txt', 'title (2).txt', 'title.txt']);
  assert.equal(runtime.store.list('run').length, 3);
});
