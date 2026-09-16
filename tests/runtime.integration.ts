import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, realpath } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Runtime } from '../src/host/runtime';
import type { Flow, Run } from '../src/shared/types';
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
    assert.equal(
      await runtime.request('artifact.resolve', { id: output.artifactId }),
      join(path, 'filled.xlsx'),
    );
    const zip = await JSZip.loadAsync(await readFile(join(path, 'archive.zip')));
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load((await zip.file('filled.xlsx')!.async('nodebuffer')) as any);
    assert.equal(restored.worksheets[0].getCell('A1').value, 'after');
    assert.equal(restored.worksheets[0].getCell('B1').value, 9);
    await rm(join(path, 'filled.xlsx'));
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
    await symlink(join(path, 'template.xlsx'), join(path, 'filled.xlsx'));
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
    await until(() =>
      runs.every((r) => runtime.store.get<Run>('run', r.id)!.state === 'SUCCEEDED'),
    );
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
      flowId: 'hello',
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
