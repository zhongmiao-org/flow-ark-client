import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { child } from '../src/host/processes';
import { Store } from '../src/host/store';
import { Runtime } from '../src/host/runtime';
import { Rpc } from '../src/shared/rpc';
import { validateIPC } from '../src/shared/ipc';
import type { Flow, Run, Step } from '../src/shared/types';

// Neither value matches the existing sk-/Bearer/phone patterns or field-name rules.
const credentials: Record<string, string> = {
  'fixture-a': 'FICT_4n8JxQv2mPz7',
  'fixture-b': 'FICT_D8q3Ln9xVm5W',
};
const base: Flow = {
  id: 'fixture',
  formatVersion: '1.0',
  name: '虚构脱敏验证',
  description: '',
  parameters: {},
  requiredCapabilities: [],
  steps: [],
};
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fingerprint = (value: unknown) => hash(JSON.stringify(value));
function noPlaintext(value: unknown, label: string, forbidden = Object.values(credentials)) {
  const text = JSON.stringify(value);
  // Only boolean diagnostics are printed if this assertion fails, not a payload.
  assert.equal(
    forbidden.some((secret) => text.includes(secret)),
    false,
    label,
  );
}
function script(code: string): Step {
  return {
    id: 'script',
    type: 'script',
    version: 1,
    language: 'js',
    dependencies: [],
    input: null,
    code,
  };
}
async function until(check: () => Promise<boolean>, label: string) {
  const end = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() >= end) throw new Error(label);
    await sleep(20);
  }
}
async function bounded<T>(pending: Promise<T>, label: string) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), 15000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
type Host = { proc: ChildProcess; rpc: Rpc; errors: string[] };
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'flowark-redaction-'));
  const key = randomBytes(32),
    hosts = new Set<Host>();
  const reads: string[] = [];
  async function close(host: Host) {
    try {
      await host.rpc.call('shutdown', {}, 15000);
      const exited =
        host.proc.exitCode !== null || host.proc.signalCode !== null
          ? Promise.resolve()
          : new Promise<void>((done) => host.proc.once('exit', () => done()));
      if (host.proc.connected) host.proc.disconnect();
      await bounded(exited, 'Host did not exit after normal shutdown');
      assert.equal(host.proc.exitCode, 0, 'Host must exit normally');
      assert.equal(host.proc.signalCode, null);
    } catch (error) {
      if (host.proc.exitCode === null && host.proc.signalCode === null) {
        const exited = new Promise<void>((done) => host.proc.once('exit', () => done()));
        host.proc.kill('SIGTERM'); // Failure cleanup only for this exact test-owned handle.
        await bounded(exited, 'Test-owned Host did not terminate').catch(() => {});
      }
      throw error;
    } finally {
      host.rpc.close();
      hosts.delete(host);
    }
  }
  t.after(async () => {
    const errors: unknown[] = [];
    for (const host of hosts) {
      try {
        await close(host);
      } catch (error) {
        errors.push(error);
      }
    }
    key.fill(0);
    await rm(directory, { recursive: true, force: true });
    if (errors.length) throw new Error('Redaction fixture did not shut down normally');
  });
  return {
    directory,
    reads,
    close,
    async open(allowCredentialReads = true) {
      const proc = child(resolve('dist/host.cjs'), process.execPath);
      const errors: string[] = [];
      const rpc = new Rpc(
        (message) => proc.send(message),
        async (method, args) => {
          if (method === 'credentials.list') return Object.keys(credentials);
          if (method === 'credentials.get') {
            assert.equal(
              allowCredentialReads,
              true,
              'reading reopened history must not read credentials',
            );
            assert.equal(
              Object.hasOwn(credentials, args.id),
              true,
              'SDK requests only the declared fictional credentials',
            );
            reads.push(args.id);
            return credentials[args.id];
          }
          if (method === 'browser.embedded.pick.cancel' || method === 'notification') return true;
          throw new Error('System capability not authorized in this fixture');
        },
      );
      const host = { proc, rpc, errors };
      hosts.add(host);
      proc.on('message', (message: any) => {
        if (message.reply && typeof message.error === 'string') errors.push(message.error);
        void rpc.receive(message);
      });
      proc.on('error', () => rpc.close());
      proc.on('exit', () => rpc.close());
      await rpc.call('init', {
        dataPath: directory,
        executable: process.execPath,
        key: key.toString('base64'),
      });
      return host;
    },
    inspect<T>(read: (store: Store) => T) {
      assert.equal(hosts.size, 0, 'close the real writer before opening Store');
      const store = new Store(join(directory, 'flowark.sqlite'), Buffer.from(key));
      try {
        return read(store);
      } finally {
        store.close();
      }
    },
  };
}
async function finished(host: Host, id: string, expected: string) {
  await until(async () => {
    const data = await host.rpc.call('bootstrap');
    const run = data.runs.find((item: Run) => item.id === id);
    return run?.state === expected && data.execution?.active?.runId !== id;
  }, 'Real Host/Worker did not reach expected terminal state');
  return host.rpc.call('run.detail', { id });
}
function sampleAssertions(sample: any) {
  assert.ok(sample && typeof sample === 'object', 'sample must remain an object');
  assert.equal(
    Object.keys(sample.keys).length,
    4,
    'both hidden keys and both literal placeholders survive',
  );
  assert.deepEqual(Object.values(sample.keys).sort(), [
    'first',
    'literal',
    'literal-suffix',
    'second',
  ]);
  assert.equal(sample.echo === '[REDACTED]', true, 'registered credential value is hidden');
  assert.equal(sample.nested[0].echo === '[REDACTED]', true, 'nested credential value is hidden');
  assert.equal(
    Object.values(sample.nested[0]).includes('nested-first'),
    true,
    'nested key entry survives',
  );
  assert.equal(
    sample.hash,
    hash(credentials['fixture-a'] + '|' + credentials['fixture-b']),
    'SDK success receives the complete original values',
  );
  assert.equal(sample.normal, 'visible');
  assert.equal(sample.number, 42);
  assert.equal(sample.zero, 0);
  assert.equal(sample.no, false);
  assert.equal(sample.empty, '');
  assert.equal(sample.nil, null);
  assert.deepEqual(sample.list, [false, 0, null, '']);
}

test(
  'real credential SDK preserves original inputs while nested keys, logs, debug output and errors are safely persisted and reopened',
  { timeout: 60000, skip: process.platform === 'win32' },
  async (t) => {
    const f = await fixture(t),
      host = await f.open();
    const code = `import {createHash} from "node:crypto";
    export default async ({credential,logger}) => {
      const a = await credential("fixture-a"), b = await credential("fixture-b");
      const sample = {
        keys: {[a]: "first", [b]: "second", "[REDACTED_KEY_1]": "literal", "[REDACTED_KEY_2]": "literal-suffix"},
        nested: [{[a]: "nested-first", echo: b}], echo: a,
        hash: createHash("sha256").update(a + "|" + b).digest("hex"),
        normal: "visible", number: 42, zero: 0, no: false, empty: "", nil: null, list: [false,0,null,""]
      };
      logger.info(sample);
      return sample;
    };`;
    noPlaintext(code, 'fixture source must not embed credential values');
    await host.rpc.call('flow.save', {
      flow: { ...base, id: 'success', steps: [script(code)] },
      bindings: { files: {}, credentials: Object.keys(credentials) },
    });
    const ordinary = await host.rpc.call('flow.run', { id: 'success' });
    const normalDetail = await finished(host, ordinary.id, 'SUCCEEDED');
    const debug = await host.rpc.call('flow.run', { id: 'success', debug: true });
    await until(
      async () => (await host.rpc.call('run.detail', { id: debug.id })).run.state === 'PAUSED',
      'debug Run did not pause at its first boundary',
    );
    await host.rpc.call('run.control', { id: debug.id, action: 'resume' });
    const debugDetail = await finished(host, debug.id, 'SUCCEEDED');
    await host.rpc.call('flow.save', {
      flow: {
        ...base,
        id: 'failure',
        steps: [
          script(
            'export default async ({credential}) => { const value = await credential("fixture-a"); throw new Error("fictional failure: " + value); };',
          ),
        ],
      },
      bindings: { files: {}, credentials: ['fixture-a'] },
    });
    const failed = await host.rpc.call('flow.run', { id: 'failure' });
    const failedDetail = await finished(host, failed.id, 'FAILED');
    noPlaintext(
      [normalDetail, debugDetail, failedDetail],
      'credential must not appear in any returned Run detail',
    );
    sampleAssertions(normalDetail.output.script);
    sampleAssertions(debugDetail.output.script);
    const normalLog = normalDetail.events.find((event: any) => event.type === 'log');
    const debugLog = debugDetail.events.find((event: any) => event.type === 'log');
    assert.ok(normalLog && debugLog, 'actual SDK logs must be recorded');
    sampleAssertions(normalLog.data.value);
    sampleAssertions(debugLog.data.value);
    const preview = debugDetail.events.find((event: any) => event.type === 'node-end')?.data
      .outputPreview;
    assert.equal(typeof preview, 'string');
    sampleAssertions(JSON.parse(preview));
    assert.match(failedDetail.run.error, /fictional failure: \[REDACTED\]/);
    assert.deepEqual(f.reads, ['fixture-a', 'fixture-b', 'fixture-a', 'fixture-b', 'fixture-a']);
    await f.close(host);
    const durable = f.inspect((store) => ({
      output: store.get('output', ordinary.id),
      events: store.events(ordinary.id),
      debug: store.events(debug.id),
      failure: store.get('run', failed.id),
      snapshots: store.list('snapshot'),
    }));
    noPlaintext(durable, 'raw saved records must be safe without a live credential dictionary');
    sampleAssertions(durable.output.script);
    assert.equal(fingerprint(durable.events), fingerprint(normalDetail.events));
    assert.equal(fingerprint(durable.debug), fingerprint(debugDetail.events));
    const reopened = await f.open(false);
    const afterNormal = await reopened.rpc.call('run.detail', { id: ordinary.id });
    const afterDebug = await reopened.rpc.call('run.detail', { id: debug.id });
    const afterFailed = await reopened.rpc.call('run.detail', { id: failed.id });
    noPlaintext(
      [afterNormal, afterDebug, afterFailed],
      'reopened history must not expose credentials',
    );
    assert.equal(fingerprint(afterNormal.output), fingerprint(normalDetail.output));
    assert.equal(fingerprint(afterDebug.events), fingerprint(debugDetail.events));
    assert.equal(afterFailed.run.state, 'FAILED');
    assert.equal(f.reads.length, 5, 'reopen and history reads cannot fetch credentials');
    await f.close(reopened);
    t.diagnostic(
      '3 real script Runs, 5 fictional credential reads; persisted/reopened logs, outputs and debug previews verified',
    );
  },
);

test(
  'actual Host RPC validation and preflight errors hide sensitive formats while runs, plans and side effects remain absent',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t),
      host = await f.open(false);
    const missing = 'Bearer FICT_AUTH_83 sk-FICT_KEY_94 13800138000';
    const forbidden = ['FICT_AUTH_83', 'sk-FICT_KEY_94', '13800138000', 'sk-fict-capability-26'];
    async function rejected(method: string, args: any, context: RegExp) {
      let error: unknown;
      try {
        await host.rpc.call(method, args);
      } catch (cause) {
        error = cause;
      }
      assert.ok(error instanceof Error, 'request must remain rejected');
      noPlaintext(error.message, 'received RPC error must be redacted', forbidden);
      assert.match(error.message, context);
      assert.match(error.message, /\[REDACTED\]/);
    }
    const invalid = {
      flow: { ...base, id: 'invalid', requiredCapabilities: ['sk-fict-capability-26'] },
      bindings: { files: {}, credentials: [] },
    };
    validateIPC('flow.save', invalid);
    await rejected('flow.save', invalid, /缺少能力/);
    const flow: Flow = {
      ...base,
      id: 'preflight',
      requiredCapabilities: ['file'],
      steps: [
        {
          id: 'write',
          type: 'file',
          version: 1,
          operation: 'write',
          binding: 'work',
          name: 'must-not-write.txt',
          content: 'fictional marker',
        },
      ],
    };
    const save = { flow, bindings: { files: { work: f.directory }, credentials: [missing] } };
    validateIPC('flow.save', save);
    await host.rpc.call('flow.save', save);
    await rejected('flow.run', { id: flow.id }, /未配置凭据/);
    await rejected(
      'schedule.save',
      { flowId: flow.id, intervalMinutes: 1, timezone: 'UTC' },
      /未配置凭据/,
    );
    assert.equal(
      host.errors.length,
      3,
      'capture real wire errors before the receiving Rpc processes them',
    );
    noPlaintext(
      host.errors,
      'wire errors must already be redacted at the Host boundary',
      forbidden,
    );
    assert.equal((await host.rpc.call('bootstrap')).runs.length, 0);
    assert.equal(f.reads.length, 0);
    await assert.rejects(access(join(f.directory, 'must-not-write.txt')));
    await f.close(host);
    const counts = f.inspect((store) =>
      Object.fromEntries(
        ['run', 'version', 'snapshot', 'schedule', 'artifact', 'script-lease'].map((kind) => [
          kind,
          store.list(kind).length,
        ]),
      ),
    );
    assert.equal(
      Object.values(counts).every((count) => count === 0),
      true,
      'rejection must not publish execution records or artifacts',
    );
    const reopened = await f.open(false);
    assert.equal((await reopened.rpc.call('bootstrap')).runs.length, 0);
    await assert.rejects(access(join(f.directory, 'must-not-write.txt')));
    await f.close(reopened);
    t.diagnostic(
      '3 actual Host rejections; zero Run/version/snapshot/schedule/artifact records and zero file side effects',
    );
  },
);

test(
  'AI probe rejection, failed timer admission and public fault fields use safe diagnostics without success records',
  { timeout: 30000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'flowark-redaction-diagnostics-'));
    const key = randomBytes(32),
      providerKey = 'FICT_zQ8mV6nL2pR4';
    const missing = 'Bearer FICT_SCHEDULE_83 sk-FICT_SCHEDULE_94 13800138000';
    const forbidden = ['FICT_SCHEDULE_83', 'sk-FICT_SCHEDULE_94', '13800138000'];
    let available = true,
      fetches = 0,
      authorizationHash: string | undefined;
    const runtime = new Runtime(
      directory,
      resolve('dist'),
      process.execPath,
      Buffer.from(key),
      async (method, args) => {
        if (method === 'credentials.list') return available ? [missing] : [];
        if (method === 'credentials.get') {
          assert.equal(args.id, 'deepseek');
          return providerKey;
        }
        throw new Error('System capability not authorized in diagnostic fixture');
      },
    );
    t.after(async () => {
      try {
        await runtime.shutdown();
      } finally {
        runtime.store.close();
        key.fill(0);
        await rm(directory, { recursive: true, force: true });
      }
    });
    await runtime.ready;
    const originalFetch = globalThis.fetch;
    // Local transport failure injection only: no request is sent to an AI endpoint.
    globalThis.fetch = async (_url, init) => {
      fetches++;
      authorizationHash = hash(new Headers(init?.headers).get('Authorization') ?? '');
      throw new Error('fictional provider failure: ' + providerKey);
    };
    try {
      await assert.rejects(
        runtime.request('ai.test', { provider: 'deepseek', model: 'deepseek-chat' }),
        (error) => {
          assert.ok(error instanceof Error);
          noPlaintext(error.message, 'local provider key must be hidden in ai.test rejection', [
            providerKey,
          ]);
          assert.match(error.message, /fictional provider failure: \[REDACTED\]/);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(fetches, 1);
    assert.equal(
      authorizationHash,
      hash('Bearer ' + providerKey),
      'provider receives the original key before the injected failure',
    );
    assert.equal(runtime.store.list('ai-validation').length, 0);

    const flow: Flow = {
      ...base,
      id: 'timer',
      requiredCapabilities: ['file'],
      steps: [
        {
          id: 'write',
          type: 'file',
          version: 1,
          operation: 'write',
          binding: 'work',
          name: 'must-not-write.txt',
          content: 'fictional marker',
        },
      ],
    };
    runtime.saveFlow(flow, { files: { work: directory }, credentials: [missing] });
    const plan = await runtime.request('schedule.save', {
      flowId: flow.id,
      intervalMinutes: 1,
      timezone: 'UTC',
    });
    const versions = fingerprint(runtime.store.list('version'));
    available = false;
    // Controlled due-time fixture; this is not a real-minute or hardware-sleep test.
    runtime.store.put('schedule', plan.id, { ...plan, nextAt: Date.now() - 1 });
    await runtime.tick();
    const logs = runtime.store.list<any>('schedule-log');
    assert.equal(logs.length, 1);
    noPlaintext(logs, 'the actual failed tick must persist a safe reason', forbidden);
    assert.match(logs[0].reason, /未配置凭据/);
    assert.match(logs[0].reason, /\[REDACTED\]/);
    assert.equal(fingerprint(runtime.store.list('version')), versions);
    for (const kind of ['run', 'snapshot', 'artifact'])
      assert.equal(runtime.store.list(kind).length, 0);
    await assert.rejects(access(join(directory, 'must-not-write.txt')));
    const previousFault = runtime.store.fault;
    // Diagnostic-field injection only, distinct from actual SQLite-failure coverage.
    runtime.store.fault = 'fictional public fault: ' + missing;
    try {
      const bootstrap = await runtime.bootstrap();
      const detail = await runtime.request('run.detail', { id: 'absent' });
      noPlaintext(
        [bootstrap.fault, detail],
        'public fault and every diagnostic path in detail must be safe',
        forbidden,
      );
      assert.match(bootstrap.fault!, /fictional public fault/);
      assert.match(detail.fault, /\[REDACTED\]/);
    } finally {
      runtime.store.fault = previousFault;
    }
    t.diagnostic(
      '1 local fetch rejection, 1 controlled failed tick; no AI success or execution records',
    );
  },
);
