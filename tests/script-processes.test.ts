import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { Store } from '../src/host/store';
import {
  ScriptProcesses,
  validScriptLease,
  type ScriptProcessSystem,
} from '../src/host/script-processes';
import {
  SCRIPT_LEASE_KIND,
  ScriptProcessInterruptedError,
  type ScriptExecution,
  type ScriptLease,
} from '../src/shared/script-supervision';

const boot = 'darwin:1800000000:0';
const request = (id = 'one'): ScriptExecution => ({
  runId: 'run',
  invocationId: id,
  nodeId: 'script',
  nodeInstance: 'script',
  compiled: '/unused/bundle.mjs',
  sha256: 'fixed-digest',
  input: { fixture: true },
});
const lease = (change: Partial<ScriptLease> = {}): ScriptLease => ({
  ...request(),
  recordVersion: 1,
  nonce: 'lease',
  bootId: boot,
  createdAt: new Date().toISOString(),
  phase: 'executing',
  pid: 9010,
  pgid: 9010,
  ...change,
});
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class FakeChild extends EventEmitter {
  connected = true;
  exitCode: number | null = null;
  signalCode: string | null = null;
  nonce = '';
  sent: any[] = [];
  autoReady = true;
  autoResult = false;
  autoClose = true;
  groupPresent = true;
  constructor(readonly pid: number) {
    super();
  }
  send(message: any, callback?: (error: Error | null) => void) {
    this.sent.push(message);
    callback?.(null);
    if (message.kind === 'script-init') {
      this.nonce = message.nonce;
      if (this.autoReady) queueMicrotask(() => this.emitReady());
    }
    if (message.kind === 'script-stop' && this.autoClose) queueMicrotask(() => this.exit());
    if (message.kind === 'script-rpc' && message.message.method === 'execute' && this.autoResult)
      queueMicrotask(() => this.result('result'));
    return true;
  }
  emitReady() {
    this.emit('message', {
      kind: 'script-ready',
      nonce: this.nonce,
      pid: this.pid,
      pgid: this.pid,
    });
  }
  result(value: unknown) {
    const execute = this.sent.find(
      (m) => m.kind === 'script-rpc' && m.message.method === 'execute',
    );
    assert.ok(execute);
    this.emit('message', {
      kind: 'script-rpc',
      nonce: this.nonce,
      message: { rpc: execute.message.rpc, reply: true, result: value },
    });
  }
  exit(groupPresent = false) {
    this.groupPresent = groupPresent;
    this.connected = false;
    this.signalCode = 'SIGKILL';
    this.emit('disconnect');
    this.emit('exit', null, 'SIGKILL');
  }
}

function fixture(initial: any[] = []) {
  const data = new Map(initial.map((item) => [item.nonce, structuredClone(item)]));
  const writes: string[] = [];
  const store = {
    fault: undefined as string | undefined,
    failPhase: undefined as string | undefined,
    list(kind: string) {
      assert.equal(kind, SCRIPT_LEASE_KIND);
      return [...data.values()];
    },
    get(_kind: string, id: string) {
      return data.get(id);
    },
    put(_kind: string, id: string, value: any) {
      if (this.fault) throw new Error(this.fault);
      if (this.failPhase === value.phase) {
        this.fault = 'fixture-write-failed';
        throw new Error(this.fault);
      }
      writes.push(value.phase);
      data.set(id, structuredClone(value));
    },
    remove(_kind: string, id: string) {
      if (this.fault) throw new Error(this.fault);
      data.delete(id);
    },
    tx<T>(fn: () => T) {
      return fn();
    },
  };
  const children: FakeChild[] = [];
  let active = true;
  let childSetup = (_child: FakeChild) => {};
  let call = async (_method: string, _args: any): Promise<unknown> => true;
  const system: ScriptProcessSystem = {
    platform: 'darwin',
    bootId: async () => boot,
    spawn: () => {
      const child = new FakeChild(10000 + children.length);
      childSetup(child);
      children.push(child);
      return child as unknown as ChildProcess;
    },
    groupExists: (pgid) => children.find((c) => c.pid === pgid)?.groupPresent ?? false,
  };
  const options = {
    dir: '/unused',
    executable: '/unused',
    store: store as unknown as Store,
    assertOwner: () => {
      if (!active) throw new Error('owner-revoked');
    },
    call: async (_owner: any, method: any, args: any) => call(method, args),
  };
  return {
    data,
    writes,
    store,
    children,
    system,
    options,
    setup: (fn: typeof childSetup) => {
      childSetup = fn;
    },
    sdk: (fn: typeof call) => {
      call = fn;
    },
    revoke: () => {
      active = false;
    },
    manager: () => new ScriptProcesses(options, system),
  };
}

test('cancel before execute is a tombstone and late ready cannot grant execution', async () => {
  const f = fixture();
  f.setup((child) => {
    child.autoReady = false;
  });
  const scripts = f.manager();
  await scripts.cancel('run', 'before');
  await assert.rejects(scripts.execute(request('before')), /取消/);
  assert.equal(f.children.length, 0);
  const pending = assert.rejects(scripts.execute(request()), /停止|取消/);
  await turn();
  assert.equal(f.children.length, 1);
  const closing = scripts.cancel('run', 'one');
  f.children[0].emitReady();
  assert.equal((await closing).confirmed, true);
  await pending;
  assert.equal(
    f.children[0].sent.some((m) => m.message?.method === 'execute'),
    false,
  );
  assert.equal(f.data.size, 0);
});

test('results wait for exact exit and group disappearance; duplicate execute never forks twice', async () => {
  const f = fixture();
  f.setup((child) => {
    child.autoClose = false;
  });
  const scripts = f.manager();
  const first = scripts.execute(request());
  assert.equal(scripts.execute(request()), first);
  let settled = false;
  void first.then(() => {
    settled = true;
  });
  await turn();
  f.children[0].result('kept');
  await turn();
  assert.equal(settled, false);
  assert.equal(f.children[0].sent.at(-1).kind, 'script-stop');
  assert.equal(f.children[0].sent.at(-1).cooperative, false);
  f.children[0].exit(true);
  await new Promise<void>((resolve) => setTimeout(resolve, 40));
  assert.equal(settled, false, 'supervisor exit alone does not prove its descendants exited');
  assert.equal(f.data.size, 1, 'the lease remains while any same-group descendant can exist');
  f.children[0].groupPresent = false;
  assert.equal(await first, 'kept');
  assert.equal(f.children.length, 1);
  assert.equal(f.data.size, 0);
});

test('repeated cancel, Run stop and shutdown join one close and send one stop request', async () => {
  const f = fixture();
  f.setup((child) => {
    child.autoClose = false;
  });
  const scripts = f.manager();
  const stopped = assert.rejects(scripts.execute(request()), /停止|取消|断开/);
  await turn();
  const first = scripts.cancel('run', 'one');
  const repeated = scripts.cancel('run', 'one');
  assert.equal(repeated, first, 'matching cancellation reuses the exact close Promise');
  const runStop = scripts.stopRun('run');
  const shutdown = scripts.shutdown();
  assert.equal(scripts.shutdown(), shutdown);
  assert.equal(f.children[0].sent.filter((message) => message.kind === 'script-stop').length, 1);
  f.children[0].exit();
  for (const result of await Promise.all([first, repeated, runStop, shutdown]))
    assert.equal(result.confirmed, true);
  await stopped;
  assert.equal(f.children[0].sent.filter((message) => message.kind === 'script-stop').length, 1);
});

test('late cancellation of an old invocation cannot stop the next script', async () => {
  const f = fixture();
  f.setup((child) => {
    child.autoResult = true;
  });
  const scripts = f.manager();
  assert.equal(await scripts.execute(request('old')), 'result');
  f.setup(() => {});
  const next = scripts.execute(request('new'));
  await turn();
  await scripts.cancel('run', 'old');
  assert.equal(
    f.children[1].sent.some((m) => m.kind === 'script-stop'),
    false,
  );
  f.children[1].result('new-result');
  assert.equal(await next, 'new-result');
});

test('loss with actual group disappearance interrupts only that run and keeps admission usable', async () => {
  const f = fixture();
  const scripts = f.manager();
  const failed = assert.rejects(scripts.execute(request()), ScriptProcessInterruptedError);
  await turn();
  f.children[0].exit();
  await failed;
  assert.equal(scripts.recoveryError, undefined);
  assert.equal(f.data.size, 0);
  f.setup((child) => {
    child.autoResult = true;
  });
  assert.equal(await scripts.execute({ ...request('next'), runId: 'next-run' }), 'result');
});

test('unknown cleanup persists and repeated cancel never invents a confirmation', async () => {
  const f = fixture();
  const scripts = f.manager();
  const failed = assert.rejects(scripts.execute(request()), ScriptProcessInterruptedError);
  await turn();
  f.system.groupExists = () => {
    throw Object.assign(new Error('permission denied'), { code: 'EPERM' });
  };
  f.children[0].exit(true);
  await failed;
  assert.match(scripts.recoveryError!, /无法核对/);
  assert.equal(f.data.size, 1);
  assert.equal((await scripts.cancel('run', 'one')).confirmed, false);
  assert.equal(scripts.hasRun('run'), true);
  assert.equal((await scripts.shutdown()).confirmed, false);
});

test('permission persistence failure never starts user code and still sends stop despite Store fault', async () => {
  const f = fixture();
  f.store.failPhase = 'executing';
  const scripts = f.manager();
  await assert.rejects(scripts.execute(request()), /fixture-write-failed/);
  assert.equal(
    f.children[0].sent.some((m) => m.message?.method === 'execute'),
    false,
  );
  assert.equal(
    f.children[0].sent.some((m) => m.kind === 'script-stop'),
    true,
  );
  assert.equal(f.children[0].groupPresent, false);
  assert.equal(f.data.size, 1, 'failed cleanup writes must leave the initial lease');
});

test('startup waits for a same-boot group to disappear and never sends terminating signals', async () => {
  const f = fixture([lease()]);
  let probes = 0;
  f.system.groupExists = () => ++probes < 3;
  const scripts = f.manager();
  await scripts.ready;
  assert.equal(probes, 3);
  assert.equal(scripts.recoveryError, undefined);
  assert.equal(f.data.size, 0);
  assert.equal(f.children.length, 0);
});

test('new boot clears old allocation; malformed identity or same-boot missing PID remains blocked', async () => {
  for (const record of [
    lease({ bootId: 'not-a-boot' }),
    lease({ pid: undefined, pgid: undefined, phase: 'allocating' }),
  ]) {
    const f = fixture([record]);
    f.system.groupExists = () => {
      throw new Error('must not probe');
    };
    const scripts = f.manager();
    await scripts.ready;
    assert.ok(scripts.recoveryError);
    assert.equal(f.data.size, 1);
  }
  const f = fixture([
    lease({ bootId: 'darwin:1790000000:0', pid: undefined, pgid: undefined, phase: 'allocating' }),
  ]);
  f.system.groupExists = () => {
    throw new Error('must not probe across boots');
  };
  const scripts = f.manager();
  await scripts.ready;
  assert.equal(scripts.recoveryError, undefined);
  assert.equal(f.data.size, 0);
  assert.equal(validScriptLease(lease({ pid: 1, pgid: 1 })), false);
  assert.equal(validScriptLease(lease({ bootId: 'darwin:1800000000:1000000' })), false);
});

test('unsupported platform with no lease does not block unrelated flows or inspect boot identity', async () => {
  const f = fixture();
  f.system.platform = 'win32';
  f.system.bootId = async () => {
    throw new Error('must not read');
  };
  const scripts = f.manager();
  await scripts.ready;
  assert.equal(scripts.recoveryError, undefined);
  await assert.rejects(scripts.execute(request()), /当前平台尚不支持/);
  assert.equal(f.children.length, 0);
});

test('stopRun during boot read forbids later spawn, and retirement releases completed records', async () => {
  const f = fixture();
  const bootRead = deferred<string>();
  f.system.bootId = () => bootRead.promise;
  const scripts = f.manager();
  const stopped = assert.rejects(scripts.execute(request()), /取消/);
  await turn();
  assert.equal((await scripts.stopRun('run')).confirmed, true);
  bootRead.resolve(boot);
  await stopped;
  assert.equal(f.children.length, 0);
  f.revoke();
  scripts.finishRun('run');
  assert.equal((scripts as any).invocations.size, 0);
  await assert.rejects(scripts.execute(request('late')), /owner-revoked/);
  assert.equal((scripts as any).invocations.size, 0);
});

test('a capability response arriving after cancellation is never delivered to the old process', async () => {
  const f = fixture();
  const answer = deferred<unknown>();
  f.sdk(() => answer.promise);
  const scripts = f.manager();
  const stopped = assert.rejects(scripts.execute(request()), /停止|取消|断开/);
  await turn();
  const child = f.children[0];
  child.emit('message', {
    kind: 'script-rpc',
    nonce: child.nonce,
    message: { rpc: 'credential-call', method: 'credential', args: { id: 'fixture' } },
  });
  await scripts.cancel('run', 'one');
  answer.resolve('private-value');
  await stopped;
  await turn();
  assert.equal(
    child.sent.some((message) => message.message?.rpc === 'credential-call'),
    false,
  );
});
