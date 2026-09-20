import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { Runtime } from '../src/host/runtime';
import type { Flow, Run, Step } from '../src/shared/types';

const base: Flow = {
  id: 'fixture',
  formatVersion: '1.0',
  name: '虚构系统挂起验证',
  description: '',
  parameters: {},
  requiredCapabilities: [],
  steps: [],
};
const human: Step = { id: 'wait', type: 'human', version: 1, message: '本地等待，不设超时' };
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function until(check: () => boolean, message: string, timeout = 12000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() >= end) throw new Error(message);
    await sleep(15);
  }
}
function records(runtime: Runtime) {
  return ['run', 'version', 'snapshot', 'rerun-request', 'trigger'].map((kind) => [
    kind,
    runtime.store.list(kind),
  ]);
}
function file(name: string, id = 'write'): Step {
  return {
    id,
    type: 'file',
    version: 1,
    operation: 'write',
    binding: 'work',
    name,
    content: 'fictional effect',
  };
}
function exited(child: ChildProcess) {
  assert.ok(
    child.exitCode !== null || child.signalCode !== null,
    'actual Worker/supervisor exit must be observed',
  );
}
function absent(pid: number) {
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'flowark-system-suspend-'));
  const key = randomBytes(32);
  const runtimes = new Set<Runtime>();
  const releases: (() => void)[] = [];
  let gate:
    | { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> }
    | undefined;
  const close = async (runtime: Runtime) => {
    try {
      await runtime.shutdown();
    } catch (error) {
      if (!runtime.store.fault) throw error;
    }
    assert.equal((runtime as any).active, undefined);
    runtime.store.close();
    runtimes.delete(runtime);
  };
  t.after(async () => {
    for (const release of releases) release();
    try {
      for (const runtime of runtimes) await close(runtime);
    } finally {
      key.fill(0);
      await rm(directory, { recursive: true, force: true });
    }
  });
  return {
    directory,
    close,
    async open() {
      const runtime = new Runtime(
        directory,
        resolve('dist'),
        process.execPath,
        Buffer.from(key),
        async (method) => {
          if (method === 'credentials.list') {
            if (gate) {
              const current = gate;
              gate = undefined;
              current.entered.resolve();
              await current.release.promise;
            }
            return ['fixture-credential'];
          }
          return [];
        },
      );
      runtimes.add(runtime);
      await runtime.ready;
      return runtime;
    },
    delayPreflight() {
      assert.equal(gate, undefined);
      const current = { entered: deferred(), release: deferred() };
      gate = current;
      releases.push(current.release.resolve);
      // Delay an actual Main credential reply; do not replace preflight results.
      return { entered: current.entered.promise, release: current.release.resolve };
    },
    save(runtime: Runtime, id: string, steps: Step[]) {
      return runtime.saveFlow(
        { ...base, id, name: '虚构挂起 ' + id, steps },
        {
          files: { work: directory },
          credentials: ['fixture-credential'],
        },
      );
    },
  };
}

test(
  'suspend revokes in-flight manual and queued debug admissions; fresh work and repeated lifecycle calls remain safe',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t),
      runtime = await f.open();
    f.save(runtime, 'manual', [file('manual.txt'), human]);
    f.save(runtime, 'debug', [file('debug.txt')]);
    const before = records(runtime),
      gate = f.delayPreflight();
    const manual = runtime.request('flow.run', { id: 'manual' });
    const manualRejected = assert.rejects(manual, /挂起.*撤销/);
    await gate.entered;
    const debug = runtime.request('flow.run', { id: 'debug', debug: true });
    const debugRejected = assert.rejects(debug, /挂起.*撤销/);
    await Promise.all([runtime.request('system.suspend'), runtime.request('system.suspend')]);
    await assert.rejects(runtime.enqueue('manual'), /休眠/);
    await runtime.request('system.resume');
    gate.release();
    await Promise.all([manualRejected, debugRejected]);
    assert.deepEqual(
      records(runtime),
      before,
      'revocation creates no Run, version, snapshot or request',
    );
    await assert.rejects(access(join(f.directory, 'manual.txt')));
    await assert.rejects(access(join(f.directory, 'debug.txt')));

    const fresh = await runtime.enqueue('manual');
    await until(
      () => runtime.store.get<Run>('run', fresh.id)?.state === 'WAITING_INPUT',
      'fresh Run did not execute',
    );
    assert.equal(await readFile(join(f.directory, 'manual.txt'), 'utf8'), 'fictional effect');
    const worker = (runtime as any).active.child as ChildProcess;
    await Promise.all([runtime.request('system.suspend'), runtime.request('system.suspend')]);
    exited(worker);
    assert.equal((await runtime.bootstrap()).execution?.active, null);
    assert.equal(runtime.store.get<Run>('run', fresh.id)?.state, 'CANCELLED');
    assert.equal(
      runtime.store.events(fresh.id).filter((event) => event.type === 'system-suspend').length,
      1,
    );
    assert.equal(
      runtime.store.list<any>('attention').filter((item) => item.title.includes('休眠已停止'))
        .length,
      1,
    );
    await runtime.request('system.suspend');
    await Promise.all([runtime.request('system.resume'), runtime.request('system.resume')]);
    assert.equal(
      runtime.store.events(fresh.id).filter((event) => event.type === 'system-suspend').length,
      1,
    );
  },
);

test(
  'an old multi-plan tick cannot execute or overwrite the plans advanced by resume',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t),
      runtime = await f.open();
    f.save(runtime, 'first', [file('first.txt')]);
    f.save(runtime, 'second', [file('second.txt')]);
    const first = await runtime.request('schedule.save', {
      flowId: 'first',
      intervalMinutes: 1,
      timezone: 'UTC',
    });
    const second = await runtime.request('schedule.save', {
      flowId: 'second',
      intervalMinutes: 1,
      timezone: 'UTC',
    });
    const time = Date.now(),
      due = time - 1;
    for (const plan of [first, second])
      runtime.store.put('schedule', plan.id, { ...plan, nextAt: due });
    const before = records(runtime),
      gate = f.delayPreflight();
    const ticking = runtime.tick(time);
    await gate.entered;
    await runtime.request('system.suspend');
    await runtime.request('system.resume');
    const resumedPlans = runtime.store.list('schedule');
    gate.release();
    await ticking;
    assert.deepEqual(records(runtime), before);
    assert.deepEqual(
      runtime.store.list('schedule'),
      resumedPlans,
      'the resumed nextAt must not be overwritten by the old list',
    );
    const logs = runtime.store.list<any>('schedule-log');
    assert.equal(
      logs.filter((log) => log.scheduleId === first.id && /挂起.*撤销/.test(log.reason)).length,
      1,
    );
    assert.equal(
      logs.filter((log) => log.scheduleId === second.id && log.reason === 'system-resume').length,
      1,
    );
    assert.equal(
      logs.length,
      2,
      'resume already records the remaining due plan; the old tick must not record it twice',
    );
    await assert.rejects(access(join(f.directory, 'first.txt')));
    await assert.rejects(access(join(f.directory, 'second.txt')));
    // Due-time injection only: simulate the next distinct future occurrence without
    // changing the OS clock or claiming minute-residency/hardware-sleep coverage.
    const futureDue = Math.max(Date.now() - 1, due + 1);
    const plan = runtime.store.get<any>('schedule', second.id);
    runtime.store.put('schedule', second.id, { ...plan, nextAt: futureDue });
    await runtime.tick(Math.max(Date.now(), futureDue));
    await until(
      () =>
        runtime.store
          .list<Run>('run')
          .some((run) => run.scheduleId === second.id && run.state === 'SUCCEEDED'),
      'new occurrence did not execute',
    );
    assert.equal(await readFile(join(f.directory, 'second.txt'), 'utf8'), 'fictional effect');
    assert.equal(runtime.store.list('run').length, 1);
  },
);

test(
  'rerun confirmation epochs cover preparation and queueing while committed requestId remains idempotent',
  { timeout: 40000 },
  async (t) => {
    const f = await fixture(t),
      runtime = await f.open();
    f.save(runtime, 'source', [{ id: 'value', type: 'value', version: 1, value: 7 }]);
    f.save(runtime, 'blocked', [file('blocked.txt')]);
    const source = await runtime.enqueue('source');
    await until(
      () =>
        runtime.store.get<Run>('run', source.id)?.state === 'SUCCEEDED' && !(runtime as any).active,
      'source did not finish',
    );
    const sourceEvidence = {
      run: runtime.store.get('run', source.id),
      events: runtime.store.events(source.id),
      output: runtime.store.get('output', source.id),
    };
    const preview = await runtime.request('run.rerun.preview', { id: source.id, mode: 'snapshot' });
    const confirm = (requestId = randomUUID()) => ({
      id: source.id,
      mode: 'snapshot',
      token: preview.token,
      requestId,
      reviewed: true,
    });
    const before = records(runtime),
      preparation = f.delayPreflight();
    const preparing = runtime.request('run.rerun.confirm', confirm());
    const preparingRejected = assert.rejects(preparing, /挂起.*撤销/);
    await preparation.entered;
    const queued = runtime.request('run.rerun.confirm', confirm());
    const queuedRejected = assert.rejects(queued, /挂起.*撤销/);
    await runtime.request('system.suspend');
    await runtime.request('system.resume');
    preparation.release();
    await Promise.all([preparingRejected, queuedRejected]);
    assert.deepEqual(records(runtime), before);

    const committedRequest = confirm();
    const committed = await runtime.request('run.rerun.confirm', committedRequest);
    await until(
      () =>
        runtime.store.get<Run>('run', committed.id)?.state === 'SUCCEEDED' &&
        !(runtime as any).active,
      'fresh explicit confirmation did not execute',
    );
    const afterCommit = records(runtime),
      holding = f.delayPreflight();
    const blocker = runtime.enqueue('blocked');
    const blockerRejected = assert.rejects(blocker, /挂起.*撤销/);
    await holding.entered;
    const duplicate = runtime.request('run.rerun.confirm', committedRequest);
    await runtime.request('system.suspend');
    // Received during suspension, but stuck behind an earlier request until resume.
    const duringSuspend = runtime.request('run.rerun.confirm', confirm());
    const duringSuspendRejected = assert.rejects(duringSuspend, /休眠/);
    await runtime.request('system.resume');
    holding.release();
    await Promise.all([blockerRejected, duringSuspendRejected]);
    assert.equal((await duplicate).id, committed.id);
    assert.deepEqual(records(runtime), afterCommit);
    assert.deepEqual(
      {
        run: runtime.store.get('run', source.id),
        events: runtime.store.events(source.id),
        output: runtime.store.get('output', source.id),
      },
      sourceEvidence,
    );
    await assert.rejects(access(join(f.directory, 'blocked.txt')));
  },
);

test(
  'SQLite readonly suspend still waits for real human/CPU-script cleanup and reopening does not replay either queue',
  { timeout: 60000 },
  async (t) => {
    for (const mode of ['human', 'script'] as const) {
      const f = await fixture(t),
        runtime = await f.open();
      const pidPath = join(f.directory, 'busy.pid');
      const step: Step =
        mode === 'human'
          ? human
          : {
              id: 'busy',
              type: 'script',
              version: 1,
              language: 'js',
              dependencies: [],
              timeoutMs: 30000,
              input: { pidPath },
              code: 'import {writeFileSync} from "node:fs"; export default async (ctx) => { writeFileSync(ctx.input.pidPath, String(process.pid)); while (true) {} };',
            };
      f.save(runtime, 'active', [step, file('after-active.txt')]);
      f.save(runtime, 'queued', [file('queued.txt')]);
      const run = await runtime.enqueue('active');
      let supervisor: ChildProcess | undefined, scriptPid: number | undefined;
      if (mode === 'human')
        await until(
          () => runtime.store.get<Run>('run', run.id)?.state === 'WAITING_INPUT',
          'human Worker did not wait',
        );
      else {
        await until(() => existsSync(pidPath), 'actual busy script did not write its PID');
        scriptPid = Number(await readFile(pidPath, 'utf8'));
        assert.ok(Number.isSafeInteger(scriptPid) && scriptPid > 1);
        supervisor = [...(runtime.scripts as any).invocations.values()].find(
          (item: any) => item.owner.runId === run.id,
        )?.child;
        assert.ok(supervisor?.pid);
      }
      const worker = (runtime as any).active.child as ChildProcess;
      const queued = await runtime.enqueue('queued');
      const savedRun = runtime.store.get('run', run.id),
        savedEvents = runtime.store.events(run.id);
      const db = (runtime.store as any).db as DatabaseSync;
      const writeErrors: any[] = [],
        originalPut = runtime.store.put.bind(runtime.store);
      // Observation only: the supervisor may be the first real writer to encounter
      // SQLITE_READONLY. Keep the actual error and rethrow without changing writes.
      runtime.store.put = (kind, id, value) => {
        try {
          return originalPut(kind, id, value);
        } catch (error) {
          writeErrors.push(error);
          throw error;
        }
      };
      db.exec('PRAGMA query_only=ON');
      let failure: AggregateError | undefined;
      await assert.rejects(runtime.request('system.suspend'), (error) => {
        if (!(error instanceof AggregateError)) return false;
        failure = error;
        return /休眠收尾/.test(error.message);
      });
      assert.ok(
        [...failure!.errors, ...writeErrors].some((error) => error.errcode === 8),
        'the fault must include actual SQLITE_READONLY',
      );
      exited(worker);
      if (supervisor && scriptPid) {
        exited(supervisor);
        absent(scriptPid);
        absent(-supervisor.pid!);
      }
      const observed = await runtime.bootstrap();
      assert.equal(observed.execution?.active, null);
      assert.ok(observed.fault);
      assert.equal(
        observed.runtimeBlock,
        undefined,
        'confirmed process exit is distinct from failed persistence',
      );
      assert.deepEqual(runtime.store.get('run', run.id), savedRun);
      assert.deepEqual(runtime.store.events(run.id), savedEvents);
      assert.equal(runtime.store.get<Run>('run', queued.id)?.state, 'QUEUED');
      assert.equal(
        runtime.store.events(queued.id).some((event) => event.type === 'node-start'),
        false,
      );
      await assert.rejects(access(join(f.directory, 'after-active.txt')));
      await assert.rejects(access(join(f.directory, 'queued.txt')));
      await runtime.request('system.resume');
      await assert.rejects(runtime.enqueue('queued'), /存储/);
      db.exec('PRAGMA query_only=OFF');
      await f.close(runtime); // Store.fault stays sticky through physical cleanup.
      const reopened = await f.open();
      assert.equal(reopened.store.get<Run>('run', run.id)?.state, 'INTERRUPTED');
      assert.equal(reopened.store.get<Run>('run', queued.id)?.state, 'INTERRUPTED');
      assert.equal((await reopened.bootstrap()).execution?.active, null);
      await reopened.tick();
      assert.equal(reopened.store.list('run').length, 2);
      assert.equal(
        reopened.store.events(queued.id).some((event) => event.type === 'node-start'),
        false,
      );
      await assert.rejects(access(join(f.directory, 'queued.txt')));
      f.save(reopened, 'fresh', [{ id: 'value', type: 'value', version: 1, value: false }]);
      const fresh = await reopened.enqueue('fresh');
      await until(
        () => reopened.store.get<Run>('run', fresh.id)?.state === 'SUCCEEDED',
        'explicit post-restart work did not execute',
      );
    }
  },
);
