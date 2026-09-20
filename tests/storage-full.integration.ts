import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, type ServerResponse } from 'node:http';
import type { ChildProcess } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { Runtime } from '../src/host/runtime';
import type { Flow, Run, Step } from '../src/shared/types';

const base: Flow = {
  id: 'fixture',
  formatVersion: '1.0',
  name: '虚构运行观察',
  description: '',
  parameters: {},
  requiredCapabilities: [],
  steps: [],
};
const waiting: Step = { id: 'wait', type: 'human', version: 1, message: '本地观察夹具' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function until(check: () => boolean, description: string, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(description);
    await new Promise<void>((resolve) => setTimeout(resolve, 15));
  }
}
async function fixture(
  t: TestContext,
  system: (method: string, args: any) => Promise<any> = async () => [],
) {
  const directory = await mkdtemp(join(tmpdir(), 'flowark-storage-observation-'));
  const key = randomBytes(32);
  const runtimes = new Set<Runtime>();
  t.after(async () => {
    const errors: unknown[] = [];
    for (const runtime of runtimes) {
      try {
        await runtime.shutdown();
      } catch (error) {
        if (!runtime.store.fault) errors.push(error);
      } finally {
        runtime.store.close();
      }
    }
    await rm(directory, { recursive: true, force: true });
    if (errors.length) throw new AggregateError(errors, '观察夹具清理失败');
  });
  return {
    directory,
    async open() {
      const runtime = new Runtime(
        directory,
        resolve('dist'),
        process.execPath,
        Buffer.from(key),
        system,
      );
      runtimes.add(runtime);
      await runtime.ready;
      return runtime;
    },
    closeStore(runtime: Runtime) {
      runtime.store.close();
      runtimes.delete(runtime);
    },
    save(runtime: Runtime, id: string, steps: Step[]) {
      runtime.saveFlow(
        { ...base, id, name: '虚构观察 ' + id, steps },
        {
          files: { work: directory },
          credentials: [],
        },
      );
    },
  };
}

test(
  'real SQLITE_FULL while saving completed HTTP output leaves history honest and queue stopped',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const runtime = await f.open();
    const received = deferred<void>();
    let response: ServerResponse | undefined;
    const receipts: string[] = [];
    const server = createServer((request, reply) => {
      receipts.push(request.url ?? '');
      if (request.url === '/large') {
        response = reply;
        received.resolve();
      } else reply.end('unexpected queued side effect');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    });
    const url = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    const http = (suffix: string): Step => ({
      id: 'request',
      type: 'http',
      version: 1,
      method: 'GET',
      url: url + suffix,
      headers: {},
      body: null,
      timeoutMs: 10000,
    });
    f.save(runtime, 'previous', [{ id: 'value', type: 'value', version: 1, value: 0 }]);
    f.save(runtime, 'full', [http('/large')]);
    f.save(runtime, 'queued', [http('/queued')]);
    const previous = await runtime.enqueue('previous');
    await until(
      () => runtime.store.get<Run>('run', previous.id)?.state === 'SUCCEEDED',
      'baseline did not finish',
    );
    const previousRun = runtime.store.get<Run>('run', previous.id);
    const previousEvents = runtime.store.events(previous.id);
    const previousOutput = runtime.store.get('output', previous.id);
    const db = (runtime.store as any).db as DatabaseSync;
    const flowRows = db
      .prepare("SELECT id,payload FROM documents WHERE kind='flow' ORDER BY id")
      .all();
    const active = await runtime.enqueue('full');
    await received.promise;
    const worker = (runtime as any).active.child as ChildProcess;
    const queued = await runtime.enqueue('queued');

    // Limit only this isolated SQLite connection. Keep a few pages for the final
    // small node event, so the actual large output INSERT exercises SQLITE_FULL.
    const pageCount = Number((db.prepare('PRAGMA main.page_count').get() as any).page_count);
    const originalLimit = Number(
      (db.prepare('PRAGMA main.max_page_count').get() as any).max_page_count,
    );
    const limit = pageCount + 32;
    assert.equal(
      Number((db.prepare(`PRAGMA main.max_page_count=${limit}`).get() as any).max_page_count),
      limit,
    );
    const failures: { kind: string; code?: string; errcode?: number; errstr?: string }[] = [];
    const originalPut = runtime.store.put.bind(runtime.store);
    runtime.store.put = (kind, id, value) => {
      try {
        return originalPut(kind, id, value);
      } catch (error) {
        // Observation only: execute the real SQLite statement and rethrow its
        // unchanged error. No synthetic error or replacement write result.
        const actual = error as any;
        failures.push({ kind, code: actual.code, errcode: actual.errcode, errstr: actual.errstr });
        throw error;
      }
    };
    const payload = Array.from({ length: 1024 }, (_, i) => String(i) + ':' + 'x'.repeat(2048));
    const encoded = JSON.stringify(payload);
    assert.ok(encoded.length < 10 * 1024 * 1024);
    response!.setHeader('Content-Type', 'application/json');
    response!.end(encoded);
    await until(
      () => Boolean(runtime.store.fault) && !(runtime as any).active,
      'FULL did not finish resource cleanup',
    );
    assert.ok(worker.exitCode !== null || worker.signalCode !== null, 'the actual Worker exited');
    assert.ok(
      failures.some((error) => error.kind === 'output' && error.errcode === 13),
      JSON.stringify(failures),
    );
    assert.equal(runtime.store.get('output', active.id), undefined);
    assert.equal(runtime.store.get<Run>('run', active.id)?.state, 'RUNNING');
    assert.equal(runtime.store.get<Run>('run', queued.id)?.state, 'QUEUED');
    assert.ok(runtime.store.events(active.id).some((event) => event.type === 'node-end'));
    assert.ok(!runtime.store.events(active.id).some((event) => event.data?.state === 'SUCCEEDED'));
    assert.ok(!runtime.store.events(queued.id).some((event) => event.type === 'node-start'));
    assert.deepEqual(receipts, ['/large']);
    const bootstrap = await runtime.bootstrap();
    const detail = await runtime.request('run.detail', { id: active.id });
    assert.equal(bootstrap.execution?.active, null);
    assert.equal(detail.execution.active, null);
    assert.ok(bootstrap.fault && detail.fault);
    assert.equal(detail.run.state, 'RUNNING', 'saved state is not rewritten by observation');
    assert.equal(detail.output, undefined);
    assert.equal(
      bootstrap.runOverview.active?.id,
      active.id,
      'legacy history differs from live observation',
    );
    await assert.rejects(runtime.enqueue('previous'), /存储写入失败/);
    assert.deepEqual(runtime.store.get('run', previous.id), previousRun);
    assert.deepEqual(runtime.store.events(previous.id), previousEvents);
    assert.deepEqual(runtime.store.get('output', previous.id), previousOutput);
    assert.equal((db.prepare('PRAGMA integrity_check').get() as any).integrity_check, 'ok');
    assert.deepEqual(
      db.prepare("SELECT id,payload FROM documents WHERE kind='flow' ORDER BY id").all(),
      flowRows,
    );

    // Returning capacity is a fixture action, not clearing Store.fault or claiming
    // the old output succeeded. Reopen through the normal recovery path.
    db.exec(`PRAGMA main.max_page_count=${originalLimit}`);
    await assert.rejects(runtime.shutdown(), /退出收尾/);
    f.closeStore(runtime);
    const reopened = await f.open();
    assert.equal(reopened.store.get<Run>('run', active.id)?.state, 'INTERRUPTED');
    assert.equal(reopened.store.get<Run>('run', queued.id)?.state, 'INTERRUPTED');
    assert.equal(reopened.store.get('output', active.id), undefined);
    assert.deepEqual(reopened.store.get('run', previous.id), previousRun);
    assert.deepEqual(reopened.store.events(previous.id), previousEvents);
    assert.deepEqual(reopened.store.get('output', previous.id), previousOutput);
    const resumed = await reopened.bootstrap();
    assert.equal(resumed.execution?.active, null);
    assert.equal(resumed.fault, undefined);
    assert.deepEqual(receipts, ['/large']);
    const explicit = await reopened.enqueue('previous');
    await until(
      () => reopened.store.get<Run>('run', explicit.id)?.state === 'SUCCEEDED',
      'new explicitly requested Run did not finish',
    );
    assert.deepEqual(receipts, ['/large'], 'neither old Run nor queued side effect replays');
  },
);

test(
  'bootstrap samples history after delayed credentials and observes real cancellation closing',
  { timeout: 20000 },
  async (t) => {
    let credentialsGate:
      | { entered: ReturnType<typeof deferred<void>>; release: ReturnType<typeof deferred<void>> }
      | undefined;
    const f = await fixture(t, async (method) => {
      if (method === 'credentials.list' && credentialsGate) {
        const current = credentialsGate;
        credentialsGate = undefined;
        current.entered.resolve();
        await current.release.promise;
      }
      return [];
    });
    const runtime = await f.open();
    f.save(runtime, 'first', [waiting]);
    f.save(runtime, 'second', [waiting]);
    const first = await runtime.enqueue('first');
    await until(
      () => runtime.store.get<Run>('run', first.id)?.state === 'WAITING_INPUT',
      'first Run did not wait',
    );
    const second = await runtime.enqueue('second');
    const gate = { entered: deferred<void>(), release: deferred<void>() };
    credentialsGate = gate;
    const snapshot = runtime.bootstrap();
    await gate.entered.promise;
    try {
      await runtime.control(first.id, 'cancel');
      await until(
        () => runtime.store.get<Run>('run', second.id)?.state === 'WAITING_INPUT',
        'FIFO successor did not start',
      );
    } finally {
      gate.release.resolve();
    }
    const observed = await snapshot;
    assert.equal(observed.runs.find((run) => run.id === first.id)?.state, 'CANCELLED');
    assert.equal(observed.runs.find((run) => run.id === second.id)?.state, 'WAITING_INPUT');
    assert.deepEqual(observed.execution?.active, { runId: second.id, phase: 'executing' });
    assert.ok(Number.isFinite(Date.parse(observed.execution!.observedAt)));

    // Control synchronously revokes the owner before its asynchronous cleanup.
    const cancel = runtime.control(second.id, 'cancel');
    const closing = await runtime.bootstrap();
    assert.deepEqual(closing.execution?.active, { runId: second.id, phase: 'closing' });
    await cancel;
    await until(() => !(runtime as any).active, 'cancelled owner did not retire');
    assert.equal((await runtime.bootstrap()).execution?.active, null);
  },
);

test(
  'detail re-reads old Run facts after artifact inspection while a different Run takes the slot',
  { timeout: 20000 },
  async (t) => {
    const f = await fixture(t);
    const runtime = await f.open();
    f.save(runtime, 'with-artifact', [
      {
        id: 'file',
        type: 'file',
        version: 1,
        operation: 'write',
        binding: 'work',
        name: 'observation.txt',
        content: 'fictional observed artifact',
      },
      waiting,
    ]);
    f.save(runtime, 'successor', [waiting]);
    const first = await runtime.enqueue('with-artifact');
    await until(
      () => runtime.store.get<Run>('run', first.id)?.state === 'WAITING_INPUT',
      'artifact Run did not wait',
    );
    assert.equal(
      await readFile(join(f.directory, 'observation.txt'), 'utf8'),
      'fictional observed artifact',
    );
    assert.ok(runtime.store.list<any>('artifact').some((artifact) => artifact.runId === first.id));
    const second = await runtime.enqueue('successor');
    const files = (runtime as any).artifactFiles;
    const inspect = files.inspect.bind(files);
    const entered = deferred<void>(),
      release = deferred<void>();
    files.inspect = async (artifact: any, ...args: any[]) => {
      if (artifact.runId === first.id) {
        entered.resolve();
        await release.promise;
      }
      return inspect(artifact, ...args);
    };
    const pending = runtime.request('run.detail', { id: first.id });
    await entered.promise;
    try {
      await runtime.control(first.id, 'cancel');
      await until(
        () => runtime.store.get<Run>('run', second.id)?.state === 'WAITING_INPUT',
        'second Run did not enter its wait',
      );
    } finally {
      release.resolve();
      files.inspect = inspect;
    }
    const detail = await pending;
    assert.equal(detail.run.id, first.id);
    assert.equal(detail.run.state, 'CANCELLED');
    assert.ok(
      detail.events.some(
        (event: any) => event.type === 'state' && event.data.state === 'CANCELLED',
      ),
    );
    assert.deepEqual(detail.execution.active, { runId: second.id, phase: 'executing' });
    assert.notEqual(
      detail.execution.active.runId,
      detail.run.id,
      'old detail must never acquire the new owner identity',
    );
    assert.equal(detail.fault, undefined);
    assert.ok(detail.artifacts.length > 0);
  },
);
