import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Runtime } from '../src/host/runtime';
import { ProviderConfigurations } from '../src/main/provider-configurations';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function until(check: () => boolean) {
  const end = Date.now() + 8000;
  while (!check()) {
    if (Date.now() > end) throw new Error('AI runtime fixture timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowark-ai-runtime-'));
  const key = randomBytes(32);
  // Private Main transport fixture only. Native system protection is covered
  // separately by test:vault; Store, Runtime and Worker are real here.
  const entries = new Map<string, { value: string; revision: string }>();
  const configurations = new ProviderConfigurations({
    readEntry: async (id) => entries.get(id) ?? null,
    set: async (id, value) => {
      const revision = randomBytes(32).toString('hex');
      entries.set(id, { value, revision });
      return revision;
    },
    removeProvider: async (id) => {
      entries.delete(id);
    },
  });
  const gates: {
    method: string;
    entered: ReturnType<typeof deferred>;
    release: ReturnType<typeof deferred>;
  }[] = [];
  let gate: (typeof gates)[number] | undefined;
  const methods: string[] = [];
  const system = async (method: string, args: any) => {
    methods.push(method);
    if (method === gate?.method) {
      const current = gate;
      gate = undefined;
      current.entered.resolve();
      await current.release.promise;
    }
    if (method === 'credentials.list') return [...entries.keys()];
    if (method === 'credentials.get') return configurations.key(args.id, args.revision);
    if (method === 'ai.configuration.read') return configurations.get(args.provider);
    if (method === 'ai.configuration.write')
      return configurations.change(args.provider, args.revision, args.update);
    if (method === 'notification' || method === 'browser.embedded.pick.cancel') return true;
    throw new Error('unexpected private call ' + method);
  };
  const runtime = new Runtime(root, resolve('dist'), process.execPath, key, system);
  await runtime.ready;
  t.after(async () => {
    gates.forEach((g) => g.release.resolve());
    await runtime.shutdown();
    runtime.store.close();
    key.fill(0);
    await rm(root, { recursive: true, force: true });
  });
  const call = (method: string, args: any = {}): Promise<any> => runtime.request(method, args);
  return {
    runtime,
    call,
    methods,
    block(method: string) {
      gate = { method, entered: deferred(), release: deferred() };
      gates.push(gate);
      return gate;
    },
    save: (provider = 'deepseek', revision: string | null = null) =>
      call('ai.configuration.save', {
        provider,
        revision,
        model: 'fictional-model',
        apiKey: 'fictional-runtime-key-Q7X2',
      }),
    async flow(credentials: string[]) {
      const record = await call('flow.create');
      return call('flow.save', {
        flow: {
          ...record.flow,
          steps: [{ id: 'wait', type: 'human', version: 1, message: 'fixture wait' }],
        },
        bindings: { files: {}, credentials },
      });
    },
  };
}

test('active and queued snapshots protect their AI configuration while unrelated providers remain editable', async (t) => {
  const f = await fixture(t);
  const saved = await f.save();
  const plain = await f.flow([]),
    bound = await f.flow(['deepseek']);
  const active = await f.call('flow.run', { id: plain.id });
  await until(() => f.runtime.store.get<any>('run', active.id)?.state === 'WAITING_INPUT');
  const queued = await f.call('flow.run', { id: bound.id });
  assert.equal(f.runtime.store.get<any>('run', queued.id)?.state, 'QUEUED');
  assert.equal((await f.call('ai.configuration.get', { provider: 'deepseek' })).inUse, true);
  await assert.rejects(f.save('deepseek', saved.revision), /正在被运行/);
  await assert.rejects(
    f.call('ai.configuration.remove', {
      provider: 'deepseek',
      revision: saved.revision,
      confirmed: true,
    }),
    /正在被运行/,
  );
  assert.equal((await f.save('openai-codex')).configured, true);
  await f.call('run.control', { id: active.id, action: 'cancel' });
  await until(() => f.runtime.store.get<any>('run', queued.id)?.state === 'WAITING_INPUT');
  await assert.rejects(f.save('deepseek', saved.revision), /正在被运行/);
  await f.call('run.control', { id: queued.id, action: 'cancel' });
  await until(() => !(f.runtime as any).active);
  assert.equal(
    (
      await f.call('ai.configuration.remove', {
        provider: 'deepseek',
        revision: saved.revision,
        confirmed: true,
      })
    ).configured,
    false,
  );
  assert.equal(f.runtime.store.list('run').length, 2);
});

test('AI configuration change during async run admission cannot produce a snapshot or queued Run', async (t) => {
  const f = await fixture(t);
  const saved = await f.save(),
    flow = await f.flow(['deepseek']);
  const gate = f.block('credentials.list');
  const pending = assert.rejects(f.call('flow.run', { id: flow.id }), /检查期间 AI 配置已改变/);
  await gate.entered.promise;
  const next = await f.call('ai.configuration.save', {
    provider: 'deepseek',
    revision: saved.revision,
    model: 'changed-before-admission',
  });
  gate.release.resolve();
  await pending;
  for (const kind of ['run', 'snapshot', 'version'])
    assert.deepEqual(f.runtime.store.list(kind), []);
  const run = await f.call('flow.run', { id: flow.id });
  await until(() => f.runtime.store.get<any>('run', run.id)?.state === 'WAITING_INPUT');
  assert.equal(
    (await f.call('ai.configuration.get', { provider: 'deepseek' })).revision,
    next.revision,
  );
  await f.call('run.control', { id: run.id, action: 'cancel' });
});

test('shutdown cancels an actual Worker and a blocked AI test without awaiting the OS key read', async (t) => {
  const f = await fixture(t);
  const saved = await f.save(),
    flow = await f.flow([]);
  const run = await f.call('flow.run', { id: flow.id });
  await until(() => f.runtime.store.get<any>('run', run.id)?.state === 'WAITING_INPUT');
  const gate = f.block('credentials.get');
  const testing = f.call('ai.configuration.test', {
    provider: 'deepseek',
    revision: saved.revision,
    requestId: 'shutdown',
    reviewedCost: true,
  });
  await gate.entered.promise;
  await f.runtime.shutdown();
  assert.equal((await testing).test.status, 'cancelled');
  assert.equal(f.runtime.store.get<any>('run', run.id)?.state, 'CANCELLED');
  assert.equal((f.runtime as any).active, undefined);
  gate.release.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.runtime.store.get<any>('ai-configuration-test', 'deepseek')?.status, 'cancelled');
  assert.equal(f.methods.filter((method) => method === 'credentials.get').length, 1);
});

test('planning key acquisition protects its provider and cancellation releases it without a late request', async (t) => {
  const f = await fixture(t);
  const saved = await f.save();
  const task = (await f.call('task.create')).task;
  const detail = await f.call('task.save', {
    id: task.id,
    revision: task.revision,
    description: 'fictional planning input',
    context: [],
    answers: {},
  });
  const gate = f.block('credentials.get');
  await f.call('task.generate', {
    id: task.id,
    revision: detail.task.revision,
    provider: 'deepseek',
    model: 'fictional-model',
    reviewed: true,
  });
  await gate.entered.promise;
  assert.equal((await f.call('ai.configuration.get', { provider: 'deepseek' })).inUse, true);
  await assert.rejects(f.save('deepseek', saved.revision), /正在被运行或方案生成/);
  await f.call('task.cancel', { id: task.id });
  gate.release.resolve();
  await until(() => !(f.runtime as any).planning.usesProvider('deepseek'));
  assert.equal((await f.call('ai.configuration.get', { provider: 'deepseek' })).inUse, false);
  await f.save('deepseek', saved.revision);
  const final = await f.call('task.detail', { id: task.id });
  assert.equal(final.task.status, 'cancelled');
  assert.equal(final.proposal, undefined);
  assert.deepEqual(f.runtime.store.list('run'), []);
});
