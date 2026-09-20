import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Runtime } from '../src/host/runtime';
import type { BrowserBinding, Flow, Run, Step } from '../src/shared/types';
import type { EmbeddedCloseReceipt } from '../src/shared/embedded-lifecycle';

// Worker, script children, SQLite and localhost HTTP are real. Only Main's
// embedded-browser system boundary is injected; this is not native destruction evidence.
const browser: BrowserBinding = {
  id: 'embedded',
  product: 'embedded',
  version: 'fixture',
  executable: '/fictional/electron',
};
const base: Flow = {
  id: 'cleanup',
  formatVersion: '1.0',
  name: '虚构回收流程',
  description: '',
  parameters: {},
  requiredCapabilities: [],
  steps: [],
};
const browserStep: Step = {
  id: 'browser',
  type: 'browser',
  version: 3,
  operation: 'read',
  value: null,
  selector: '#fictional',
  framePath: [],
};
const human: Step = { id: 'human', type: 'human', version: 1, message: 'fictional wait' };
const value: Step = { id: 'value', type: 'value', version: 1, value: 'fixture' };
const terminal = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']);
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(
  check: () => boolean | Promise<boolean>,
  message = '等待真实 Worker',
  timeout = 12000,
) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(message);
    await delay(20);
  }
}
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}
function exists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'flowark-embedded-cleanup-'));
  let receipts = 0;
  const server = createServer((_request, response) => {
    receipts++;
    response.end('fictional receipt');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as any).port;
  const driver = {
    token: '',
    resourceId: '',
    starts: 0,
    performs: 0,
    closes: 0,
    close: undefined as undefined | ((args: any) => Promise<EmbeddedCloseReceipt>),
    perform: undefined as undefined | (() => Promise<unknown>),
  };
  const runtime = new Runtime(
    directory,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async (method, args) => {
      if (method === 'credentials.list') return [];
      if (method === 'browser.embedded.binding') return browser;
      if (method === 'notification' || method === 'browser.embedded.pick.cancel') return true;
      if (method === 'browser.embedded.start') {
        driver.starts++;
        driver.token = args.token;
        driver.resourceId = 'resource-' + driver.starts;
        return { state: 'ready', token: args.token, resourceId: driver.resourceId };
      }
      if (method === 'browser.embedded.perform') {
        driver.performs++;
        return driver.perform ? driver.perform() : 'fictional browser result';
      }
      if (method === 'browser.embedded.close') {
        driver.closes++;
        return driver.close
          ? driver.close(args)
          : {
              state: 'closed',
              ...(args.token ? { token: args.token, resourceId: driver.resourceId } : {}),
            };
      }
      throw new Error('unexpected fixture system method: ' + method);
    },
  );
  runtime.store.put('browser', browser.id, browser);
  const releaseOnExit: (() => void)[] = [];
  t.after(async () => {
    for (const release of releaseOnExit) release();
    try {
      await runtime.shutdown();
    } finally {
      runtime.store.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
  const save = (id: string, steps: Step[]) =>
    runtime.saveFlow(
      { ...base, id, steps },
      {
        browserId: browser.id,
        files: { work: directory },
        credentials: [],
      },
    );
  const http: Step = {
    id: 'receipt',
    type: 'http',
    version: 1,
    method: 'GET',
    url,
    headers: {},
    body: null,
  };
  const run = (id: string) => runtime.store.get<Run>('run', id)!;
  const finished = async (id: string, state: string) => {
    await until(
      () =>
        terminal.has(run(id).state) &&
        (runtime as any).active?.id !== id &&
        !(runtime as any).pendingCapabilities.has(id),
    );
    assert.equal(run(id).state, state, JSON.stringify(run(id)));
    const ends = runtime.store
      .events(id)
      .filter((e) => e.type === 'state' && terminal.has(e.data.state));
    assert.equal(ends.length, 1, 'one terminal event per Run');
    return run(id);
  };
  return {
    runtime,
    driver,
    directory,
    save,
    run,
    finished,
    http,
    releaseOnExit,
    receipts: () => receipts,
  };
}

test(
  'close never resolves: stopped real Worker and busy script die before the browser budget; queue and every admission remain blocked',
  { timeout: 35000 },
  async (t) => {
    const f = await fixture(t),
      { runtime, driver } = f;
    f.save('source', [value]);
    const source = await runtime.enqueue('source');
    await f.finished(source.id, 'SUCCEEDED');
    const preview = await runtime.request('run.rerun.preview', { id: source.id, mode: 'snapshot' });
    f.save('queued', [f.http]);
    const plan = await runtime.request('schedule.save', {
      flowId: 'queued',
      intervalMinutes: 1,
      timezone: 'Asia/Shanghai',
    });
    const pidFile = join(f.directory, 'busy-script.pid');
    const lateFile = join(f.directory, 'must-not-exist.txt');
    const busy: Step = {
      id: 'busy',
      type: 'script',
      version: 1,
      language: 'js',
      dependencies: [],
      timeoutMs: 60000,
      input: { pidFile },
      code: 'import {writeFileSync} from "node:fs"; export default ({input}) => { writeFileSync(input.pidFile,String(process.pid)); while(true){} };',
    };
    f.save('blocked', [
      browserStep,
      busy,
      {
        id: 'late',
        type: 'file',
        version: 1,
        operation: 'write',
        binding: 'work',
        name: 'must-not-exist.txt',
        content: 'unexpected',
      },
    ]);
    driver.close = async () => new Promise<never>(() => {});
    const activeRun = await runtime.enqueue('blocked');
    let scriptPid = 0;
    await until(async () => {
      scriptPid = Number(await readFile(pidFile, 'utf8').catch(() => ''));
      return scriptPid > 0;
    }, 'real script publishes its PID');
    const worker = (runtime as any).active.child as ChildProcess;
    const queued = await runtime.enqueue('queued');
    // SIGSTOP only the owned test Worker, so it cannot process cooperative cancellation.
    process.kill(worker.pid!, 'SIGSTOP');
    const cancelledAt = Date.now();
    await runtime.control(activeRun.id, 'cancel');
    await until(
      () => worker.exitCode !== null || worker.signalCode !== null,
      'Worker must exit independently of close',
      5000,
    );
    assert.ok(
      Date.now() - cancelledAt < 5000,
      'browser close budget must not delay Worker termination',
    );
    await until(() => !exists(scriptPid), 'owned busy script actually exits', 3000);
    assert.equal(f.run(queued.id).state, 'QUEUED');
    assert.equal(f.receipts(), 0);
    const ended = await f.finished(activeRun.id, 'INTERRUPTED');
    assert.match(ended.error!, /回收|关闭|确认/);
    assert.match(ended.business, /核对/);
    const bootstrap = await runtime.bootstrap();
    assert.match(bootstrap.runtimeBlock!, /回收未确认/);
    assert.equal(bootstrap.fault, undefined, 'resource failure is not a storage fault');
    assert.equal(driver.closes, 1, 'all cleanup callers join the same close');
    await assert.rejects(access(lateFile), { code: 'ENOENT' });
    assert.ok(!runtime.store.events(activeRun.id).some((e) => e.nodeInstance === 'late'));
    const count = runtime.store.list('run').length;
    await assert.rejects(runtime.enqueue('source'), /回收未确认/);
    await assert.rejects(
      runtime.request('browser.embedded.visibility', { visible: true }),
      /回收未确认/,
    );
    await assert.rejects(
      runtime.request('browser.embedded.navigate', { url: 'http://127.0.0.1/' }),
      /回收未确认/,
    );
    await assert.rejects(
      runtime.request('browser.embedded.pick.start', { requestId: 'blocked' }),
      /回收未确认/,
    );
    await assert.rejects(
      runtime.request('run.rerun.preview', { id: source.id, mode: 'snapshot' }),
      /回收未确认/,
    );
    await assert.rejects(
      runtime.request('run.rerun.confirm', {
        id: source.id,
        mode: 'snapshot',
        token: preview.token,
        requestId: randomUUID(),
        reviewed: true,
      }),
      /回收未确认/,
    );
    await assert.rejects(
      runtime.request('schedule.save', {
        flowId: 'queued',
        intervalMinutes: 1,
        timezone: 'Asia/Shanghai',
      }),
      /回收未确认/,
    );
    await runtime.request('schedule.toggle', { id: plan.id, enabled: false });
    await assert.rejects(
      runtime.request('schedule.toggle', { id: plan.id, enabled: true }),
      /回收未确认/,
    );
    runtime.store.put('schedule', plan.id, { ...plan, nextAt: Date.now() - 1 });
    await runtime.tick();
    await runtime.request('system.resume');
    await runtime.tick();
    assert.equal(runtime.store.list('run').length, count, 'no scheduled or rerun Run admitted');
    assert.equal(f.receipts(), 0);
    assert.equal(f.run(queued.id).state, 'QUEUED');
    await runtime.control(queued.id, 'cancel');
    assert.equal(f.run(queued.id).state, 'CANCELLED', 'blocked queue remains cancellable');
    assert.ok((await runtime.bootstrap()).runtimeBlock, 'resume never unlocks recovery');
  },
);

test('delayed matching close confirms cancellation before the next real HTTP side effect', async (t) => {
  const f = await fixture(t),
    { runtime, driver } = f;
  const closing = gate();
  f.releaseOnExit.push(closing.open);
  driver.close = async (args) => {
    await closing.promise;
    return { state: 'closed', token: args.token, resourceId: driver.resourceId };
  };
  f.save('first', [browserStep, human]);
  f.save('second', [browserStep, f.http, human]);
  const first = await runtime.enqueue('first');
  await until(() => f.run(first.id).state === 'WAITING_INPUT');
  const old = { token: driver.token, resourceId: driver.resourceId };
  const second = await runtime.enqueue('second');
  await Promise.all([runtime.control(first.id, 'cancel'), runtime.control(first.id, 'cancel')]);
  await until(() => driver.closes === 1);
  await delay(100);
  assert.equal(f.run(second.id).state, 'QUEUED');
  assert.equal(driver.starts, 1);
  assert.equal(f.receipts(), 0);
  closing.open();
  await f.finished(first.id, 'CANCELLED');
  await until(() => f.run(second.id).state === 'WAITING_INPUT');
  assert.equal(driver.starts, 2);
  assert.equal(f.receipts(), 1);
  await runtime.request('system.browserLost', {
    ...old,
    reason: 'late old renderer gone',
    destroyed: true,
  });
  assert.equal(
    f.run(second.id).state,
    'WAITING_INPUT',
    'stale lost notice cannot stop a new owner',
  );
  assert.equal(driver.closes, 1);
  await runtime.control(second.id, 'resume');
  await f.finished(second.id, 'SUCCEEDED');
  assert.equal(f.receipts(), 1);
  assert.equal((await runtime.bootstrap()).runtimeBlock, undefined);
});

test('node failure plus close rejection retains both causes and blocks a preflight already in flight', async (t) => {
  const f = await fixture(t),
    { runtime, driver } = f;
  const admission = gate();
  f.releaseOnExit.push(admission.open);
  const perform = gate();
  f.releaseOnExit.push(perform.open);
  driver.perform = async () => {
    await perform.promise;
    throw new Error('fictional original node failure');
  };
  driver.close = async () => {
    throw new Error('fictional native close rejection');
  };
  f.save('failure', [browserStep]);
  f.save('late', [f.http]);
  const first = await runtime.enqueue('failure');
  await until(() => driver.performs === 1);
  let entered = false;
  const preflight = runtime.preflight.bind(runtime);
  runtime.preflight = async (record) => {
    if (record.id === 'late') {
      entered = true;
      await admission.promise;
    }
    return preflight(record);
  };
  const late = runtime.enqueue('late');
  const rejected = assert.rejects(late, /回收未确认/);
  await until(() => entered);
  perform.open();
  const ended = await f.finished(first.id, 'INTERRUPTED');
  assert.match(ended.error!, /fictional original node failure/);
  assert.match(ended.error!, /fictional native close rejection/);
  admission.open();
  await rejected;
  assert.equal(runtime.store.list('run').length, 1);
  assert.equal(f.receipts(), 0);
  assert.equal(runtime.store.fault, undefined);
});

test('cancellation during normal healthy release closes the original lease and cannot commit SUCCEEDED', async (t) => {
  const f = await fixture(t),
    { runtime, driver } = f;
  const release = gate();
  f.releaseOnExit.push(release.open);
  let reached = false;
  const original = runtime.sessions.release.bind(runtime.sessions);
  runtime.sessions.release = async (id, destroy) => {
    const result = await original(id, destroy);
    if (!destroy) {
      reached = true;
      await release.promise;
    }
    return result;
  };
  f.save('success-race', [browserStep, value]);
  const run = await runtime.enqueue('success-race');
  await until(() => reached, 'real Worker result enters successful release gate');
  assert.ok(
    runtime.store
      .events(run.id)
      .some((event) => event.type === 'node-end' && event.nodeInstance === 'value'),
  );
  await runtime.control(run.id, 'cancel');
  await until(() => driver.closes === 1);
  release.open();
  await f.finished(run.id, 'CANCELLED');
  assert.equal(
    runtime.store.get('output', run.id),
    undefined,
    'cancelled result not published as success',
  );
  assert.equal((await runtime.bootstrap()).runtimeBlock, undefined);
});

test('matching unexpected page loss is INTERRUPTED, repeated notices and cancel do not duplicate final state or attention', async (t) => {
  const f = await fixture(t),
    { runtime, driver } = f;
  const closing = gate();
  f.releaseOnExit.push(closing.open);
  driver.close = async (args) => {
    await closing.promise;
    return { state: 'closed', token: args.token, resourceId: driver.resourceId };
  };
  f.save('lost', [browserStep, human]);
  const run = await runtime.enqueue('lost');
  await until(() => f.run(run.id).state === 'WAITING_INPUT');
  const notice = {
    token: driver.token,
    resourceId: driver.resourceId,
    reason: 'fictional renderer crash',
    destroyed: false,
  };
  // The notification must return even though Main's close reply is gated.
  await Promise.race([
    runtime.request('system.browserLost', notice),
    delay(500).then(() => {
      throw new Error('lost notification waited on close');
    }),
  ]);
  await runtime.request('system.browserLost', notice);
  await runtime.control(run.id, 'cancel');
  assert.equal(driver.closes, 1);
  closing.open();
  const ended = await f.finished(run.id, 'INTERRUPTED');
  assert.match(ended.error!, /fictional renderer crash/);
  assert.equal(
    runtime.store.list<any>('attention').filter((a) => a.dedupeKey === 'browser-lost:' + run.id)
      .length,
    1,
  );
  assert.equal(
    (await runtime.bootstrap()).runtimeBlock,
    undefined,
    'confirmed crash cleanup does not become unknown',
  );
});

test('preview cleanup failure interrupts an unrelated active Run without awaiting Main and remains sticky after late confirmation', async (t) => {
  const f = await fixture(t),
    { runtime } = f;
  f.save('data-only', [human]);
  f.save('queued', [f.http]);
  const active = await runtime.enqueue('data-only');
  await until(() => f.run(active.id).state === 'WAITING_INPUT');
  const queued = await runtime.enqueue('queued');
  const notice = { resourceId: 'unleased-preview', error: 'fictional preview native close failed' };
  await runtime.request('system.browserCleanupFailed', notice);
  await runtime.request('system.browserCleanupFailed', notice);
  const ended = await f.finished(active.id, 'INTERRUPTED');
  assert.match(ended.error!, /fictional preview native close failed/);
  await runtime.request('system.browserLost', {
    resourceId: 'unleased-preview',
    reason: 'late destroyed',
    destroyed: true,
  });
  assert.ok((await runtime.bootstrap()).runtimeBlock);
  assert.equal(f.run(queued.id).state, 'QUEUED');
  assert.equal(f.receipts(), 0);
  assert.equal(
    runtime.store.list<any>('attention').filter((a) => a.dedupeKey === 'runtime-resource-block')
      .length,
    1,
  );
});

test('cancelling during active preflight stops the real Worker before a late preflight can execute', async (t) => {
  const f = await fixture(t),
    { runtime } = f;
  const validation = gate();
  f.releaseOnExit.push(validation.open);
  const preflight = runtime.preflight.bind(runtime);
  let calls = 0,
    entered = false;
  runtime.preflight = async (record) => {
    if (++calls === 2) {
      entered = true;
      await validation.promise;
    }
    return preflight(record);
  };
  f.save('preflight', [f.http]);
  const run = await runtime.enqueue('preflight');
  await until(() => entered);
  const worker = (runtime as any).active.child as ChildProcess;
  await runtime.control(run.id, 'cancel');
  await f.finished(run.id, 'CANCELLED');
  assert.ok(worker.exitCode !== null || worker.signalCode !== null);
  validation.open();
  await delay(100);
  assert.equal(f.receipts(), 0);
  assert.ok(!runtime.store.events(run.id).some((event) => event.type === 'node-start'));
});

test('SQLite write failure does not skip Worker or session shutdown when native close also fails', async (t) => {
  const f = await fixture(t),
    { runtime, driver } = f;
  f.save('write-failure', [browserStep, human]);
  const run = await runtime.enqueue('write-failure');
  await until(() => f.run(run.id).state === 'WAITING_INPUT');
  const worker = (runtime as any).active.child as ChildProcess;
  driver.close = async () => {
    throw new Error('fictional close failure with readonly database');
  };
  let shutdownCalled = false;
  const shutdown = runtime.sessions.shutdown.bind(runtime.sessions);
  runtime.sessions.shutdown = async () => {
    shutdownCalled = true;
    return shutdown();
  };
  (runtime.store as any).db.exec('PRAGMA query_only=ON');
  try {
    await assert.rejects(runtime.shutdown(), /本地记录错误/);
    assert.equal(shutdownCalled, true);
    assert.ok(
      worker.exitCode !== null || worker.signalCode !== null,
      'actual Worker exited despite state write rejection',
    );
    assert.ok(runtime.store.fault);
    assert.ok((await runtime.bootstrap()).runtimeBlock);
    assert.ok(
      !terminal.has(f.run(run.id).state),
      'failed terminal write is never reported as persisted',
    );
    assert.equal(driver.closes, 1);
  } finally {
    // Restore only this temporary database so the fixture can close normally.
    (runtime.store as any).db.exec('PRAGMA query_only=OFF');
    runtime.store.fault = undefined;
  }
});
