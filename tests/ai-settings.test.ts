import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProviderConfigurations } from '../src/main/provider-configurations';
import { AISettings } from '../src/host/ai-settings';
import { Store } from '../src/host/store';
import { validateIPC } from '../src/shared/ipc';
import type { AIProviderId } from '../src/shared/ai-settings';
import type { generate } from '../src/ai/providers';

const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const deferred = <T = void>() => {
  let resolve!: (v: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, resolve, reject };
};
function protection() {
  const entries = new Map<string, { value: string; revision: string }>();
  const control = {
    failWrite: false,
    failRemove: false,
    writeGate: undefined as Promise<void> | undefined,
  };
  const vault = {
    readEntry: async (id: string) => entries.get(id) ?? null,
    set: async (id: string, value: string) => {
      await control.writeGate;
      if (control.failWrite) throw new Error('protected write failed');
      const revision = hash(randomBytes(32).toString('hex'));
      entries.set(id, { value, revision });
      return revision;
    },
    removeProvider: async (id: string) => {
      if (control.failRemove) throw new Error('protected delete failed');
      entries.delete(id);
    },
  };
  return { entries, control, vault, configs: new ProviderConfigurations(vault) };
}
async function fixture(t: any, generator?: typeof generate, timeoutMs?: number) {
  const root = await mkdtemp(join(tmpdir(), 'flowark-ai-settings-'));
  const store = new Store(join(root, 'state.sqlite'), randomBytes(32));
  const protectedState = protection();
  const control = { inUse: false, available: true };
  const deps = {
    assertAvailable: () => {
      if (!control.available) throw new Error('suspended');
    },
    inUse: () => control.inUse,
    get: (provider: AIProviderId) => protectedState.configs.get(provider),
    change: (
      provider: AIProviderId,
      revision: string | null,
      update?: { model: string; apiKey?: string },
    ) => protectedState.configs.change(provider, revision, update),
    key: (provider: AIProviderId, revision: string) =>
      protectedState.configs.key(provider, revision),
    generate:
      generator ??
      (async () => ({
        provider: 'deepseek',
        model: 'deepseek-flash',
        output: { value: 'fictional-check' },
        requestId: '',
        usage: null,
      })),
    timeoutMs,
  };
  const service = new AISettings(store, deps);
  t.after(async () => {
    await service.cancelAll();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const request = (method: string, args: any = {}) =>
    service.request('ai.configuration.' + method, { provider: 'deepseek', ...args });
  return { ...protectedState, service, store, control, deps, request };
}
const initial = { revision: null, model: 'deepseek-flash', apiKey: 'fictional-private-7K2M' };
const start = (f: Awaited<ReturnType<typeof fixture>>, revision: string, requestId = 'test-1') =>
  f.request('test', { revision, requestId, reviewedCost: true });

test('AI settings IPC requires a revision, confirmation and fixed provider without exposing private methods', () => {
  assert.throws(() => validateIPC('credentials.set', { id: 'deepseek', value: initial.apiKey }));
  assert.throws(() => validateIPC('ai.test', { provider: 'deepseek', model: 'x' }));
  assert.throws(() => validateIPC('ai.configuration.write', {}));
  for (const patch of [
    { revision: undefined },
    { apiKey: '' },
    { url: 'https://elsewhere.test' },
    { model: 'has space' },
    { provider: 'unknown' },
  ]) {
    assert.throws(() =>
      validateIPC('ai.configuration.save', { provider: 'deepseek', ...initial, ...patch }),
    );
  }
  assert.throws(() =>
    validateIPC('ai.configuration.test', {
      provider: 'deepseek',
      revision: 'a'.repeat(64),
      requestId: 'test',
    }),
  );
  assert.throws(() =>
    validateIPC('ai.configuration.remove', {
      provider: 'deepseek',
      revision: 'a'.repeat(64),
      confirmed: false,
    }),
  );
});

test('provider record preserves existing protected Key, never returns it, atomically changes model and rejects stale writes', async () => {
  const f = protection();
  f.entries.set('deepseek', { value: initial.apiKey, revision: hash('old ciphertext') });
  const old = await f.configs.get('deepseek');
  assert.equal(old.configured, true);
  assert.equal(old.tail, undefined);
  assert.ok(!JSON.stringify(old).includes(initial.apiKey));
  assert.equal(await f.configs.key('deepseek'), initial.apiKey);
  const saved = await f.configs.change('deepseek', old.revision, {
    model: 'chosen-model',
    apiKey: 'fictional-new-Z9Q8',
  });
  assert.equal(saved.tail, 'Z9Q8');
  assert.equal(saved.model, 'chosen-model');
  assert.notEqual(saved.revision, old.revision);
  assert.ok(!JSON.stringify(saved).includes('fictional-new-Z9Q8'));
  await assert.rejects(
    f.configs.change('deepseek', old.revision, { model: 'stale', apiKey: initial.apiKey }),
    /已变化/,
  );
  const record = f.entries.get('deepseek');
  f.control.failWrite = true;
  await assert.rejects(
    f.configs.change('deepseek', saved.revision, { model: 'failed-model', apiKey: initial.apiKey }),
  );
  assert.deepEqual(f.entries.get('deepseek'), record);
  f.control.failWrite = false;
  const blank = await f.configs.change('deepseek', saved.revision, { model: 'another-model' });
  assert.equal(await f.configs.key('deepseek'), 'fictional-new-Z9Q8');
  assert.equal(blank.tail, 'Z9Q8');
  f.control.failRemove = true;
  await assert.rejects(f.configs.change('deepseek', blank.revision));
  assert.equal((await f.configs.get('deepseek')).revision, blank.revision);
  f.control.failRemove = false;
  assert.equal((await f.configs.change('deepseek', blank.revision)).configured, false);
  await assert.rejects(f.configs.key('deepseek'));
});

test('saving and deleting gate credential consumers and invalidate asynchronous admission captures', async (t) => {
  const f = await fixture(t);
  const saved = await f.request('save', initial);
  const checked = f.service.capture(['deepseek']);
  const gate = deferred();
  f.control.inUse = true;
  await assert.rejects(
    f.request('remove', { revision: saved.revision, confirmed: true }),
    /正在被/,
  );
  f.control.inUse = false;
  f.deps.change = async () => {
    await gate.promise;
    return f.configs.get('deepseek');
  };
  const saving = f.request('save', { ...initial, revision: saved.revision });
  assert.throws(() => f.service.assertReadable('deepseek'), /正在修改/);
  assert.doesNotThrow(() => f.service.assertReadable('openai-codex'));
  await assert.rejects(start(f, saved.revision), /正在保存/);
  gate.resolve();
  await saving;
  assert.throws(checked, /已改变/);
});

test('testing uses only saved configuration and fixed content; model changes invalidate persisted success', async (t) => {
  const requests: any[] = [];
  const f = await fixture(t, async (input, key) => {
    requests.push({ input, key });
    return {
      provider: 'deepseek',
      model: 'actual-model',
      output: { value: 'fictional-check' },
      requestId: 'remote',
      usage: null,
    };
  });
  const saved = await f.request('save', initial);
  assert.equal(requests.length, 0);
  const result = await start(f, saved.revision);
  assert.equal(result.test.status, 'passed');
  assert.equal(result.test.model, 'actual-model');
  assert.deepEqual(requests[0].input.input, { value: 'fictional-check' });
  assert.equal(requests[0].input.model, 'deepseek-flash');
  assert.equal(requests[0].key, initial.apiKey);
  assert.ok(!JSON.stringify(result).includes(initial.apiKey));
  const reopened = new AISettings(f.store, f.deps);
  assert.equal(
    (await reopened.request('ai.configuration.get', { provider: 'deepseek' })).test.status,
    'passed',
  );
  assert.equal(requests.length, 1);
  const changed = await f.request('save', { revision: saved.revision, model: 'new-model' });
  assert.equal(changed.test, null);
  assert.equal(changed.tail, saved.tail);
  await assert.rejects(start(f, saved.revision, 'stale'));
  assert.equal(requests.length, 1);
});

test('auth, quota, request and malformed output failures retain Key without exposing provider errors', async (t) => {
  const f = await fixture(t);
  const saved = await f.request('save', initial);
  for (const [message, code] of [
    ['AI 接口 HTTP 401', 'authentication'],
    ['AI 接口 HTTP 402', 'quota'],
    ['AI 接口 HTTP 429', 'quota'],
    ['AI 接口 HTTP 404', 'request'],
    ['Invalid JSON', 'output'],
    ['socket disconnected', 'network'],
  ]) {
    f.deps.generate = async () => {
      throw new Error(message + ' ' + initial.apiKey);
    };
    const result = await start(f, saved.revision);
    assert.equal(result.test.status, 'failed');
    assert.equal(result.test.code, code);
    assert.equal(result.configured, true);
    assert.equal(result.tail, '7K2M');
    assert.ok(!JSON.stringify(result).includes(initial.apiKey));
  }
});

test('cancel during credential read cannot start HTTP and a late result cannot overwrite cancelled status', async (t) => {
  let requests = 0;
  const f = await fixture(t, async () => {
    requests++;
    throw new Error('should not run');
  });
  const saved = await f.request('save', initial),
    gate = deferred<string>(),
    entered = deferred();
  f.deps.key = async () => {
    entered.resolve();
    return gate.promise;
  };
  const pending = start(f, saved.revision);
  await entered.promise;
  const cancelling = f.request('cancel', { requestId: 'test-1' });
  await assert.rejects(
    f.request('remove', { revision: saved.revision, confirmed: true }),
    /正在保存/,
  );
  await cancelling;
  await pending;
  // OS credential retrieval can remain blocked after cancellation; it must
  // neither hold the public operation nor initiate a later HTTP request.
  assert.equal((await f.request('get')).operation, null);
  gate.resolve(initial.apiKey);
  assert.equal(requests, 0);
  assert.equal((await f.request('get')).test.status, 'cancelled');
  const response = deferred<any>(),
    started = deferred();
  f.deps.key = async () => initial.apiKey;
  f.deps.generate = async () => {
    started.resolve();
    return response.promise;
  };
  const late = start(f, saved.revision, 'late');
  await started.promise;
  const stop = f.request('cancel', { requestId: 'late' });
  response.resolve({ model: 'unexpected-success' });
  await late;
  await stop;
  assert.equal((await f.request('get')).test.status, 'cancelled');
});

test('overall deadline includes blocked credential reads and ignores their late result', async (t) => {
  let requests = 0;
  const f = await fixture(
    t,
    async () => {
      requests++;
      throw new Error('unexpected HTTP');
    },
    20,
  );
  const saved = await f.request('save', initial);
  const gate = deferred<string>();
  f.deps.key = () => gate.promise;
  const result = await start(f, saved.revision);
  assert.equal(result.test.status, 'failed');
  assert.equal(result.test.code, 'timeout');
  assert.equal(result.operation, null);
  const next = await f.request('save', { revision: saved.revision, model: 'next-model' });
  gate.resolve(initial.apiKey);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 0);
  assert.equal((await f.request('get')).revision, next.revision);
  assert.equal((await f.request('get')).test, null);
});

test('timeout is distinct from explicit cancel and interrupted tests reopen without a request', async (t) => {
  const f = await fixture(
    t,
    async (_input, _key, signal) => {
      await new Promise<void>((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
      );
      throw new Error('unreachable');
    },
    20,
  );
  const saved = await f.request('save', initial);
  const result = await start(f, saved.revision);
  assert.equal(result.test.code, 'timeout');
  assert.equal(result.test.status, 'failed');
  f.store.put('ai-configuration-test', 'deepseek', {
    provider: 'deepseek',
    revision: saved.revision,
    requestId: 'crashed',
    status: 'testing',
    at: new Date().toISOString(),
  });
  const reopened = new AISettings(f.store, f.deps);
  assert.equal(
    (await reopened.request('ai.configuration.get', { provider: 'deepseek' })).test.status,
    'interrupted',
  );
});
