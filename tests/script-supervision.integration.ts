import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import childProcess, { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Runtime } from '../src/host/runtime';
import { Rpc } from '../src/shared/rpc';
import type { Flow, Run, Step } from '../src/shared/types';

const exec = promisify(execFile);
const terminal = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']);
const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const options = { timeout: 60000, skip: process.platform === 'win32' };
const secret = 'fictional-supervision-key-123456';
const candidateExecutable = process.env.FLOWARK_TEST_EXECUTABLE;
if (candidateExecutable)
  assert.ok(isAbsolute(candidateExecutable), 'candidate executable must be an absolute path');
const executable = candidateExecutable || process.execPath;
const entryDir = candidateExecutable
  ? resolve(dirname(candidateExecutable), '..', 'Resources', 'app.asar', 'dist')
  : resolve('dist');
const candidateEsbuild = candidateExecutable
  ? resolve(
      dirname(candidateExecutable),
      '..',
      'Resources',
      'app.asar.unpacked',
      'node_modules',
      '@esbuild',
      `${process.platform}-${process.arch}`,
      'bin',
      'esbuild',
    )
  : undefined;
type ProcessEvidence = {
  pid: number;
  state: 'running' | 'zombie' | 'absent';
  ppid?: number;
  pgid?: number;
  started?: string;
  command?: string;
};
type OwnedScript = { marker: string; before: ProcessEvidence };
type Invocation = {
  owner: { runId: string; invocationId: string; nodeId: string; nodeInstance: string };
  child?: ChildProcess;
  lease?: { nonce: string; pid?: number; pgid?: number; phase: string };
};
type Receipt = { path?: string; scripts: ProcessEvidence[]; groupsAbsent: boolean[]; time: number };
async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 15000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() >= end) throw new Error(label);
    await delay(20);
  }
}
async function bounded<T>(pending: Promise<T>, label: string, timeout = 12000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
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
function groupAbsent(pgid: number) {
  assert.ok(Number.isSafeInteger(pgid) && pgid > 1);
  return !exists(-pgid); // Read-only group probe. Never signal a historical group.
}
async function probe(pid: number): Promise<ProcessEvidence> {
  if (!exists(pid)) return { pid, state: 'absent' };
  let stdout: string;
  try {
    ({ stdout } = await exec('/bin/ps', [
      '-ww',
      '-p',
      String(pid),
      '-o',
      'pid=,ppid=,pgid=,stat=,lstart=,command=',
    ]));
  } catch (error: any) {
    if (error.code === 1 && !exists(pid)) return { pid, state: 'absent' };
    throw error;
  }
  const row = stdout.trim().split(/\s+/);
  assert.equal(Number(row[0]), pid, stdout);
  assert.ok(row.length >= 9, stdout);
  return {
    pid,
    state: row[3].includes('Z') ? 'zombie' : 'running',
    ppid: Number(row[1]),
    pgid: Number(row[2]),
    started: row.slice(4, 9).join(' '),
    command: row.slice(9).join(' '),
  };
}
async function jsonFile(path: string) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error: any) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return undefined;
    throw error;
  }
}
function invocations(runtime: Runtime) {
  return [...((runtime.scripts as any).invocations as Map<string, Invocation>).values()];
}
async function system(method: string, args: any) {
  if (method === 'credentials.list') return ['deepseek'];
  if (method === 'credentials.get' && args.id === 'deepseek') return secret;
  if (method === 'notification' || method === 'browser.embedded.pick.cancel') return true;
  throw new Error('Unexpected fixture system method: ' + method);
}
const base: Flow = {
  id: 'fixture',
  formatVersion: '1.0',
  name: 'Script supervision fixture',
  description: '',
  parameters: {},
  requiredCapabilities: [],
  steps: [],
};
function script(code: string): Step {
  return {
    id: 'script',
    type: 'script',
    version: 1,
    language: 'js',
    dependencies: [],
    input: null,
    timeoutMs: 60000,
    code,
  };
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'flowark-script-supervision-'));
  const key = randomBytes(32);
  const nonce = randomUUID();
  const ownedScripts: OwnedScript[] = [];
  const scriptTargets: { marker: string; path: string }[] = [];
  const observedSupervisors: ProcessEvidence[] = [];
  const ownedChildren = new Set<ChildProcess>();
  const runtimes = new Set<Runtime>();
  const closedRuntimes = new Set<Runtime>();
  const expectedShutdownFailures = new Set<Runtime>();
  const receipts: Receipt[] = [];
  const groups = new Set<number>();
  const evidence: any = {
    test: t.name,
    directory,
    mode: candidateExecutable
      ? 'candidate-processes-with-source-runtime'
      : 'built-processes-with-source-runtime',
    entryDir,
    executable,
    fixtureRuntime:
      'imported source Runtime; the Host SIGKILL cases additionally fork the selected host.cjs',
    processes: [],
    receipts,
    cleanup: [],
  };
  const server = createServer((request, response) => {
    void (async () => {
      receipts.push({
        path: request.url,
        time: Date.now(),
        scripts: await Promise.all(ownedScripts.map(({ before }) => probe(before.pid))),
        groupsAbsent: [...groups].map(groupAbsent),
      });
      response.end('fictional local receipt');
    })().catch((error) => {
      response.statusCode = 500;
      response.end(String(error));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const url = 'http://127.0.0.1:' + (server.address() as any).port;
  const sentinelFile = join(directory, 'sentinel.json');
  const sentinel = spawn(
    process.execPath,
    [
      '-e',
      `const fs=require('node:fs');let tick=0;const target=${JSON.stringify(sentinelFile)};
    const beat=()=>{fs.writeFileSync(target+'.tmp',JSON.stringify({pid:process.pid,nonce:${JSON.stringify(nonce)},tick:++tick}));fs.renameSync(target+'.tmp',target);};
    beat();setInterval(beat,50);`,
    ],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      detached: true,
      stdio: 'ignore',
    },
  );
  ownedChildren.add(sentinel);
  let sentinelError: Error | undefined;
  sentinel.on('error', (error) => {
    sentinelError = error;
  });

  async function stopExact(owned: OwnedScript) {
    const current = await probe(owned.before.pid);
    evidence.cleanup.push({ role: 'fixture-script', before: current });
    if (current.state === 'running') {
      assert.equal(current.started, owned.before.started, 'refuse a reused fixture PID');
      assert.equal(current.pgid, owned.before.pgid);
      assert.ok(
        current.command?.includes(owned.marker),
        'refuse a process without the fixture nonce',
      );
      process.kill(current.pid, 'SIGKILL');
    }
    await until(
      async () => (await probe(current.pid)).state !== 'running',
      'fixture script cleanup failed',
      5000,
    );
    evidence.cleanup.push({ role: 'fixture-script', after: await probe(current.pid) });
  }
  async function close(runtime: Runtime) {
    if (closedRuntimes.has(runtime)) return;
    try {
      await bounded(runtime.shutdown(), 'Runtime shutdown timed out');
    } finally {
      runtime.store.close();
      closedRuntimes.add(runtime);
    }
  }
  t.after(async () => {
    const errors: unknown[] = [];
    // Recover a fixture-published PID even if an earlier assertion failed before
    // capture(). Its nonce and observed parent chain must still match our fixture.
    for (const target of scriptTargets) {
      try {
        const identity = await jsonFile(target.path);
        if (
          identity?.marker !== target.marker ||
          ownedScripts.some(({ before }) => before.pid === identity.pid)
        )
          continue;
        const before = await probe(identity.pid);
        if (before.state === 'running') {
          assert.ok(before.command?.includes(target.marker));
          ownedScripts.push({ marker: target.marker, before });
        }
      } catch (error) {
        errors.push(error);
      }
    }
    for (const owned of ownedScripts) {
      try {
        const parentPid = owned.before.ppid!;
        if (
          ownedChildrenHasPid(parentPid) ||
          observedSupervisors.some((item) => item.pid === parentPid)
        )
          continue;
        const parent = await probe(parentPid);
        if (
          parent.state === 'running' &&
          parent.pgid === parent.pid &&
          ownedChildrenHasPid(parent.ppid!)
        )
          observedSupervisors.push(parent);
      } catch (error) {
        errors.push(error);
      }
    }
    for (const runtime of runtimes) {
      for (const invocation of invocations(runtime))
        if (invocation.child) ownedChildren.add(invocation.child);
      const worker = (runtime as any).active?.child;
      if (worker) ownedChildren.add(worker);
      if (!closedRuntimes.has(runtime)) {
        try {
          await bounded(runtime.shutdown(), 'fixture Runtime shutdown timed out');
        } catch (error) {
          evidence.cleanup.push({ role: 'runtime-shutdown', error: String(error) });
          if (!expectedShutdownFailures.has(runtime)) errors.push(error);
        }
      }
    }
    // Product assertions precede this fallback. Teardown cannot turn an orphan into a pass.
    for (const owned of ownedScripts) {
      try {
        await stopExact(owned);
      } catch (error) {
        errors.push(error);
      }
    }
    // A supervisor created inside the independently forked Host has no local
    // ChildProcess handle. Its exact Host-parent/PGID identity was observed alive.
    for (const before of observedSupervisors) {
      try {
        const current = await probe(before.pid);
        if (current.state === 'running') {
          assert.equal(current.started, before.started);
          assert.equal(current.pgid, before.pgid);
          assert.equal(current.command, before.command);
          process.kill(current.pid, 'SIGKILL');
        }
        await until(
          async () => (await probe(before.pid)).state !== 'running',
          'fixture supervisor did not stop',
          5000,
        );
        evidence.cleanup.push({
          role: 'fixture-observed-supervisor',
          before,
          after: await probe(before.pid),
        });
      } catch (error) {
        errors.push(error);
      }
    }
    for (const proc of ownedChildren) {
      if (!proc.pid) continue;
      try {
        if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
        await until(
          () => proc.exitCode !== null || proc.signalCode !== null,
          'fixture child did not exit',
          5000,
        );
        evidence.cleanup.push({
          role: 'fixture-owned-child',
          pid: proc.pid,
          exitCode: proc.exitCode,
          signalCode: proc.signalCode,
        });
      } catch (error) {
        errors.push(error);
      }
    }
    for (const runtime of runtimes)
      if (!closedRuntimes.has(runtime)) {
        try {
          runtime.store.close();
        } catch (error) {
          errors.push(error);
        }
      }
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    evidence.cleanupErrors = errors.map(String);
    await writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2));
    t.diagnostic('Process evidence: ' + join(directory, 'evidence.json'));
    if (errors.length) throw new AggregateError(errors, 'fixture cleanup incomplete');
  });
  let heartbeat: { nonce: string; pid: number; tick: number } | undefined;
  await until(async () => {
    if (sentinelError) throw sentinelError;
    heartbeat = await jsonFile(sentinelFile);
    return (
      heartbeat?.nonce === nonce &&
      heartbeat.pid === sentinel.pid &&
      Number.isSafeInteger(heartbeat.tick)
    );
  }, 'sentinel startup failed');
  let lastTick = heartbeat!.tick;
  function ownedChildrenHasPid(pid: number) {
    return [...ownedChildren].some((proc) => proc.pid === pid);
  }

  const open = async () => {
    const runtime = new Runtime(directory, entryDir, executable, Buffer.from(key), system);
    runtimes.add(runtime);
    await runtime.ready;
    return runtime;
  };
  const save = (runtime: Runtime, id: string, steps: Step[], credentials: string[] = []) =>
    runtime.saveFlow({ ...base, id, steps }, { files: { work: directory }, credentials });
  const http = (id: string): Step => ({
    id: 'receipt',
    type: 'http',
    version: 1,
    method: 'GET',
    url: url + '/' + id,
    headers: {},
    body: null,
  });
  const busy = (name: string, topLevel = false) => {
    const marker = 'flowark-test-' + randomUUID();
    const path = join(directory, name + '.json');
    const publish = `process.title=${JSON.stringify(marker)};writeFileSync(${JSON.stringify(path)},JSON.stringify({pid:process.pid,ppid:process.ppid,marker:${JSON.stringify(marker)}}));`;
    scriptTargets.push({ marker, path });
    return {
      marker,
      path,
      step: script(
        topLevel
          ? `import {writeFileSync} from 'node:fs';${publish}while(true){};export default()=>null;`
          : `import {writeFileSync} from 'node:fs';export default()=>{${publish}while(true){}};`,
      ),
    };
  };
  const capture = async (target: { marker: string; path: string }) => {
    await until(
      async () => (await jsonFile(target.path))?.marker === target.marker,
      'script PID not published',
    );
    const identity = await jsonFile(target.path);
    const before = await probe(identity.pid);
    assert.equal(before.state, 'running');
    assert.ok(before.command?.includes(target.marker));
    const owned = { marker: target.marker, before };
    ownedScripts.push(owned);
    evidence.processes.push({ identity, before });
    return owned;
  };
  const invocation = async (runtime: Runtime, id: string) => {
    let found: Invocation | undefined;
    await until(
      () =>
        !!(found = invocations(runtime).find((item) => item.owner.runId === id && item.child?.pid)),
      'supervisor not created',
    );
    ownedChildren.add(found!.child!);
    groups.add(found!.child!.pid!);
    return found!;
  };
  const finished = async (runtime: Runtime, id: string, state: string) => {
    await until(
      () =>
        terminal.has(runtime.store.get<Run>('run', id)!.state) &&
        (runtime as any).active?.id !== id &&
        !(runtime as any).pendingCapabilities.has(id),
      'Run did not settle',
    );
    const run = runtime.store.get<Run>('run', id)!;
    assert.equal(run.state, state, JSON.stringify(run));
    assert.equal(
      runtime.store
        .events(id)
        .filter((event) => event.type === 'state' && terminal.has(event.data.state)).length,
      1,
    );
    return run;
  };
  const sentinelAlive = async () => {
    assert.equal((await probe(sentinel.pid!)).state, 'running');
    await until(async () => {
      heartbeat = await jsonFile(sentinelFile);
      return (
        heartbeat?.nonce === nonce &&
        heartbeat.pid === sentinel.pid &&
        Number.isSafeInteger(heartbeat.tick) &&
        heartbeat.tick > lastTick
      );
    }, 'sentinel heartbeat stopped');
    lastTick = heartbeat!.tick;
    evidence.sentinel = {
      process: await probe(sentinel.pid!),
      heartbeat,
    };
  };
  const assertReceiptsStopped = () => {
    for (const receipt of receipts) {
      assert.ok(
        receipt.scripts.every((item) => item.state !== 'running'),
        JSON.stringify(receipt),
      );
      assert.ok(receipt.groupsAbsent.every(Boolean), JSON.stringify(receipt));
    }
  };
  return {
    directory,
    key,
    nonce,
    ownedChildren,
    ownedScripts,
    observedSupervisors,
    expectedShutdownFailures,
    groups,
    receipts,
    evidence,
    open,
    close,
    save,
    http,
    busy,
    capture,
    invocation,
    finished,
    sentinelAlive,
    stopExact,
    assertReceiptsStopped,
  };
}

for (const topLevel of [false, true])
  test(
    `Worker SIGKILL reclaims ${topLevel ? 'top-level' : 'default'} busy script before FIFO HTTP`,
    options,
    async (t) => {
      const f = await fixture(t),
        runtime = await f.open(),
        target = f.busy('busy', topLevel);
      f.save(runtime, 'busy', [target.step, f.http('must-not-run')]);
      f.save(runtime, 'fifo-1', [f.http('fifo-1')]);
      f.save(runtime, 'fifo-2', [f.http('fifo-2')]);
      const run = await runtime.enqueue('busy');
      const worker = (runtime as any).active.child as ChildProcess;
      f.ownedChildren.add(worker);
      const supervisor = (await f.invocation(runtime, run.id)).child!;
      const owned = await f.capture(target);
      assert.equal(owned.before.ppid, supervisor.pid);
      assert.equal(owned.before.pgid, supervisor.pid);
      const first = await runtime.enqueue('fifo-1'),
        second = await runtime.enqueue('fifo-2');
      assert.equal(f.receipts.length, 0);
      assert.equal(worker.kill('SIGKILL'), true);
      await f.finished(runtime, run.id, 'INTERRUPTED');
      await f.finished(runtime, first.id, 'SUCCEEDED');
      await f.finished(runtime, second.id, 'SUCCEEDED');
      assert.ok(supervisor.exitCode !== null || supervisor.signalCode !== null);
      assert.equal(groupAbsent(supervisor.pid!), true);
      assert.notEqual((await probe(owned.before.pid)).state, 'running');
      assert.deepEqual(
        f.receipts.map((receipt) => receipt.path),
        ['/fifo-1', '/fifo-2'],
      );
      f.assertReceiptsStopped();
      assert.equal(runtime.scripts.hasRun(run.id), false);
      assert.equal(runtime.store.list('script-lease').length, 0);
      assert.equal((await runtime.bootstrap()).runtimeBlock, undefined);
      await f.sentinelAlive();
    },
  );

for (const topLevel of [false, true])
  test(
    `Host SIGKILL reclaims ${topLevel ? 'top-level' : 'default'} busy script and reopen does not replay`,
    options,
    async (t) => {
      const f = await fixture(t),
        target = f.busy('host-busy', topLevel);
      const hostEntry = join(entryDir, 'host.cjs');
      // Match workbench's packaged Host environment. A standalone fork does not
      // inherit Electron Main's app.asar.unpacked esbuild override automatically.
      if (candidateEsbuild) await access(candidateEsbuild);
      f.evidence.forkedHost = {
        entry: hostEntry,
        executable,
        esbuildBinaryPath: candidateEsbuild ?? process.env.ESBUILD_BINARY_PATH ?? null,
      };
      const host = childProcess.fork(hostEntry, [], {
        execPath: executable,
        execArgv: [],
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          SE_AVOID_BROWSER_DOWNLOAD: 'true',
          SE_OFFLINE: 'true',
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
          ...(candidateEsbuild ? { ESBUILD_BINARY_PATH: candidateEsbuild } : {}),
        },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        detached: true,
      });
      f.ownedChildren.add(host);
      const rpc = new Rpc((message) => host.send(message), system);
      host.on('message', (message) => void rpc.receive(message as any));
      host.on('exit', () => rpc.close());
      host.on('error', () => rpc.close());
      t.after(() => rpc.close());
      await rpc.call('init', {
        dataPath: f.directory,
        key: f.key.toString('base64'),
        executable,
      });
      const save = (id: string, steps: Step[]) =>
        rpc.call('flow.save', {
          flow: { ...base, id, steps },
          bindings: { files: {}, credentials: [] },
        });
      await save('busy', [target.step]);
      await save('queued', [f.http('must-not-replay')]);
      const run = await rpc.call('flow.run', { id: 'busy' });
      const owned = await f.capture(target);
      const supervisorPid = owned.before.ppid!;
      assert.equal(owned.before.pgid, supervisorPid);
      f.groups.add(supervisorPid);
      f.evidence.hostSupervisor = await probe(supervisorPid);
      assert.equal(f.evidence.hostSupervisor.ppid, host.pid);
      f.observedSupervisors.push(f.evidence.hostSupervisor);
      const queued = await rpc.call('flow.run', { id: 'queued' });
      assert.equal(host.kill('SIGKILL'), true);
      await until(
        () => host.exitCode !== null || host.signalCode !== null,
        'actual Host did not exit',
      );
      await until(
        () => groupAbsent(supervisorPid),
        'supervisor did not reclaim group on Host EOF',
        8000,
      );
      assert.notEqual((await probe(owned.before.pid)).state, 'running');
      assert.equal(f.receipts.length, 0);
      const reopened = await f.open();
      assert.equal(reopened.store.get<Run>('run', run.id)!.state, 'INTERRUPTED');
      assert.equal(reopened.store.get<Run>('run', queued.id)!.state, 'INTERRUPTED');
      assert.equal(reopened.store.list('script-lease').length, 0);
      assert.equal((await reopened.bootstrap()).runtimeBlock, undefined);
      assert.equal(f.receipts.length, 0);
      f.save(reopened, 'explicit-new', [f.http('explicit-new')]);
      const next = await reopened.enqueue('explicit-new');
      await f.finished(reopened, next.id, 'SUCCEEDED');
      assert.deepEqual(
        f.receipts.map((receipt) => receipt.path),
        ['/explicit-new'],
      );
      f.assertReceiptsStopped();
      await f.sentinelAlive();
    },
  );

test(
  'SDK result is released only after ordinary same-group descendants have stopped',
  options,
  async (t) => {
    const f = await fixture(t),
      runtime = await f.open();
    const target = f.busy('script'),
      descendant = f.busy('descendant');
    const childCode = `const fs=require('node:fs');process.title=${JSON.stringify(descendant.marker)};fs.writeFileSync(${JSON.stringify(descendant.path)},JSON.stringify({pid:process.pid,ppid:process.ppid,marker:${JSON.stringify(descendant.marker)}}));while(true){}`;
    const code = `import {spawn} from 'node:child_process';import {writeFileSync,existsSync} from 'node:fs';
    export default async ({credential,logger,progress,artifact})=>{
      process.title=${JSON.stringify(target.marker)};writeFileSync(${JSON.stringify(target.path)},JSON.stringify({pid:process.pid,ppid:process.ppid,marker:${JSON.stringify(target.marker)}}));
      const secret=await credential('deepseek');logger.info({secret});progress(1,1);
      const file=await artifact('supervision.txt','fictional supervised result');
      spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{detached:false,stdio:'ignore'});
      while(!existsSync(${JSON.stringify(descendant.path)})) await new Promise(r=>setTimeout(r,10));
      while(!existsSync(${JSON.stringify(join(f.directory, 'return-authorized'))})) await new Promise(r=>setTimeout(r,10));
      return {answer:42,file,secret};
    };`;
    f.save(runtime, 'sdk', [script(code), f.http('after-sdk')], ['deepseek']);
    const run = await runtime.enqueue('sdk');
    const supervisor = (await f.invocation(runtime, run.id)).child!;
    const owned = await f.capture(target),
      childOwned = await f.capture(descendant);
    assert.equal(owned.before.pgid, supervisor.pid);
    assert.equal(childOwned.before.pgid, supervisor.pid);
    await writeFile(join(f.directory, 'return-authorized'), 'fixture gate');
    await f.finished(runtime, run.id, 'SUCCEEDED');
    assert.equal(groupAbsent(supervisor.pid!), true);
    assert.equal(runtime.store.get('output', run.id).script.answer, 42);
    const artifact = runtime.store.list<any>('artifact').find((item) => item.runId === run.id)!;
    assert.equal(await readFile(artifact.path, 'utf8'), 'fictional supervised result');
    assert.ok(runtime.store.events(run.id).some((event) => event.type === 'progress'));
    assert.equal(
      JSON.stringify(await runtime.request('run.detail', { id: run.id })).includes(secret),
      false,
    );
    assert.deepEqual(
      f.receipts.map((receipt) => receipt.path),
      ['/after-sdk'],
    );
    f.assertReceiptsStopped();
    await f.sentinelAlive();
  },
);

test(
  'supervisor SIGKILL persists unknown ownership and blocks execution across ordinary reopen',
  options,
  async (t) => {
    const f = await fixture(t),
      runtime = await f.open(),
      target = f.busy('unknown');
    f.save(runtime, 'source', [{ id: 'value', type: 'value', version: 1, value: 42 }]);
    const source = await runtime.enqueue('source');
    await f.finished(runtime, source.id, 'SUCCEEDED');
    const preview = await runtime.request('run.rerun.preview', { id: source.id, mode: 'snapshot' });
    f.save(runtime, 'next', [f.http('must-not-run')]);
    const plan = await runtime.request('schedule.save', {
      flowId: 'next',
      intervalMinutes: 1,
      timezone: 'UTC',
    });
    f.save(runtime, 'busy', [target.step]);
    const run = await runtime.enqueue('busy');
    const supervisor = (await f.invocation(runtime, run.id)).child!;
    const owned = await f.capture(target);
    const queued = await runtime.enqueue('next');
    assert.equal(supervisor.kill('SIGKILL'), true);
    await f.finished(runtime, run.id, 'INTERRUPTED');
    assert.equal(
      (await probe(owned.before.pid)).state,
      'running',
      'remaining historical group must not receive a blind kill',
    );
    assert.ok(runtime.scripts.recoveryError);
    assert.equal(runtime.scripts.hasRun(run.id), true);
    assert.ok(runtime.store.list('script-lease').length);
    assert.ok((await runtime.bootstrap()).runtimeBlock);
    assert.equal(f.receipts.length, 0);
    await assert.rejects(runtime.enqueue('next'));
    await assert.rejects(runtime.request('run.rerun.preview', { id: source.id, mode: 'snapshot' }));
    await assert.rejects(
      runtime.request('run.rerun.confirm', {
        id: source.id,
        mode: 'snapshot',
        token: preview.token,
        requestId: randomUUID(),
        reviewed: true,
      }),
    );
    await assert.rejects(
      runtime.request('schedule.save', { flowId: 'next', intervalMinutes: 1, timezone: 'UTC' }),
    );
    await assert.rejects(runtime.request('schedule.toggle', { id: plan.id, enabled: true }));
    await assert.rejects(runtime.request('run.artifacts.preview', { id: run.id }));
    await runtime.tick(Date.now() + 120000);
    assert.equal(f.receipts.length, 0);
    assert.equal((await runtime.request('run.detail', { id: run.id })).run.state, 'INTERRUPTED');
    f.save(runtime, 'editable', [
      { id: 'value', type: 'value', version: 1, value: 'edit allowed' },
    ]);
    await runtime.control(queued.id, 'cancel');
    assert.equal(runtime.store.get<Run>('run', queued.id)!.state, 'CANCELLED');
    await f.sentinelAlive();
    await f.close(runtime);

    const reopened = await f.open();
    assert.ok((await reopened.bootstrap()).runtimeBlock);
    assert.ok(reopened.store.list('script-lease').length);
    assert.equal(reopened.store.get<Run>('run', run.id)!.state, 'INTERRUPTED');
    await assert.rejects(reopened.enqueue('next'));
    await assert.rejects(
      reopened.request('run.rerun.preview', { id: source.id, mode: 'snapshot' }),
    );
    await assert.rejects(reopened.request('schedule.toggle', { id: plan.id, enabled: true }));
    await reopened.tick(Date.now() + 120000);
    assert.equal(f.receipts.length, 0);
    assert.equal((await probe(owned.before.pid)).state, 'running');
    await f.sentinelAlive();
    await f.close(reopened);

    // Only the fixture now removes its owned orphan. A third startup must observe
    // real ESRCH; no record, Run result, recovery flag or expected value is reset.
    await f.stopExact(owned);
    await until(() => groupAbsent(supervisor.pid!), 'fixture orphan group not gone', 5000);
    const recovered = await f.open();
    assert.equal((await recovered.bootstrap()).runtimeBlock, undefined);
    assert.equal(recovered.store.list('script-lease').length, 0);
    assert.equal(recovered.store.get<Run>('run', run.id)!.state, 'INTERRUPTED');
    f.save(recovered, 'explicit', [f.http('explicit')]);
    const next = await recovered.enqueue('explicit');
    await f.finished(recovered, next.id, 'SUCCEEDED');
    assert.deepEqual(
      f.receipts.map((receipt) => receipt.path),
      ['/explicit'],
    );
    f.assertReceiptsStopped();
  },
);

test(
  'real SQLite lease-update rejection prevents user import and still stops the created supervisor',
  options,
  async (t) => {
    const f = await fixture(t),
      runtime = await f.open(),
      target = f.busy('never-import', true);
    f.expectedShutdownFailures.add(runtime);
    f.save(runtime, 'blocked', [target.step]);
    (runtime.store as any).db
      .exec(`CREATE TRIGGER reject_script_permission BEFORE UPDATE OF payload ON documents
    WHEN NEW.kind='script-lease' BEGIN SELECT RAISE(ABORT,'fictional lease identity write failure'); END;`);
    const spawns: { entry: string; child: ChildProcess }[] = [];
    const originalFork = childProcess.fork;
    // Observe actual returned handles, without changing arguments or product
    // behavior. The failed permission path may finish before the next poll.
    childProcess.fork = ((...args: any[]) => {
      const proc = Reflect.apply(originalFork, childProcess, args) as ChildProcess;
      spawns.push({ entry: String(args[0]), child: proc });
      f.ownedChildren.add(proc);
      return proc;
    }) as typeof childProcess.fork;
    syncBuiltinESMExports();
    try {
      await runtime.enqueue('blocked');
      await until(() => !!runtime.store.fault, 'real SQLite failure was not surfaced');
    } finally {
      childProcess.fork = originalFork;
      syncBuiltinESMExports();
    }
    const supervisor = spawns.find((item) => item.entry.endsWith('script-supervisor.cjs'))?.child;
    assert.ok(
      supervisor?.pid,
      'observe the actual supervisor created before the SQLite permission failure',
    );
    await until(
      () => supervisor.exitCode !== null || supervisor.signalCode !== null,
      'supervisor survived failed permission write',
    );
    await until(() => groupAbsent(supervisor.pid!), 'failed-permission supervisor group remained');
    await assert.rejects(access(target.path), { code: 'ENOENT' });
    assert.ok(
      runtime.store.list('script-lease').length,
      'initial intent survives failed permission and cleanup writes',
    );
    assert.equal(f.receipts.length, 0);
    await assert.rejects(runtime.enqueue('blocked'));
    await f.sentinelAlive();
  },
);

test(
  'SQLite readonly cancellation cannot skip actual busy-script and Worker cleanup',
  options,
  async (t) => {
    const f = await fixture(t),
      runtime = await f.open(),
      target = f.busy('readonly-busy');
    f.expectedShutdownFailures.add(runtime);
    f.save(runtime, 'busy', [target.step, f.http('must-not-run')]);
    const run = await runtime.enqueue('busy');
    const worker = (runtime as any).active.child as ChildProcess;
    f.ownedChildren.add(worker);
    const supervisor = (await f.invocation(runtime, run.id)).child!;
    const owned = await f.capture(target);
    (runtime.store as any).db.exec('PRAGMA query_only=ON');
    await assert.rejects(runtime.shutdown());
    assert.ok(worker.exitCode !== null || worker.signalCode !== null);
    assert.ok(supervisor.exitCode !== null || supervisor.signalCode !== null);
    assert.equal(groupAbsent(supervisor.pid!), true);
    assert.notEqual((await probe(owned.before.pid)).state, 'running');
    assert.ok(runtime.store.fault);
    assert.ok(
      runtime.store.list('script-lease').length,
      'failed delete cannot erase recovery evidence',
    );
    assert.equal(
      terminal.has(runtime.store.get<Run>('run', run.id)!.state),
      false,
      'failed terminal write is not a persisted success',
    );
    assert.equal(f.receipts.length, 0);
    await f.sentinelAlive();
  },
);
