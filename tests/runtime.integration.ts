import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Runtime } from '../src/host/runtime';
import type { Flow, Run } from '../src/shared/types';
import { Store } from '../src/host/store';
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
    assert.ok(!runtime.store.events(r.id).some((e) => e.nodeInstance === 'never'));
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
