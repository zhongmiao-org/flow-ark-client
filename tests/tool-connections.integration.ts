import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Runtime } from '../src/host/runtime';
import type {
  ConnectionCandidate,
  ConnectionConfig,
  ToolConnection,
} from '../src/shared/tool-connections';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowark-connection-runtime-'));
  const key = randomBytes(32);
  const secrets = new Map<string, string>();
  const methods: string[] = [],
    credentialMethods: string[] = [];
  const control = {
    stall: false,
    denySave: false,
    getGate: undefined as Promise<void> | undefined,
  };
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    methods.push(body.method);
    assert.equal(req.headers.authorization, 'Bearer fictional-runtime-credential');
    if (body.method === 'tools/list' && control.stall) return;
    res.setHeader('Content-Type', 'application/json');
    const result =
      body.method === 'server/discover'
        ? {
            resultType: 'complete',
            supportedVersions: ['2026-07-28'],
            capabilities: { tools: {} },
            _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'Runtime test', version: '1' } },
          }
        : {
            resultType: 'complete',
            ttlMs: 0,
            cacheScope: 'private',
            tools: [{ name: 'read_record', inputSchema: { type: 'object' } }],
          };
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const config: ConnectionConfig = {
    version: 1,
    displayName: '宿主集成连接',
    source: '本机隔离 HTTP 夹具',
    protocolVersion: '2026-07-28',
    transport: {
      type: 'http',
      url: `http://127.0.0.1:${(server.address() as any).port}/mcp`,
      auth: 'bearer',
    },
  };
  const system = async (method: string, args: any) => {
    if (method === 'credentials.list') return [];
    if (method === 'notification' || method === 'browser.embedded.pick.cancel') return true;
    credentialMethods.push(method);
    assert.match(args.id, /^mcp-/);
    if (method === 'tool.credentials.set') {
      if (control.denySave) throw new Error('fictional vault unavailable');
      secrets.set(args.id, args.value);
      return;
    }
    if (method === 'tool.credentials.get') {
      await control.getGate;
      return secrets.get(args.id);
    }
    if (method === 'tool.credentials.remove') {
      secrets.delete(args.id);
      return;
    }
    throw new Error('unexpected system call ' + method);
  };
  let runtime = new Runtime(root, resolve('dist'), process.execPath, Buffer.from(key), system);
  await runtime.ready;
  t.after(async () => {
    await runtime.shutdown();
    runtime.store.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    key.fill(0);
    await rm(root, { recursive: true, force: true });
  });
  return {
    get runtime() {
      return runtime;
    },
    config,
    control,
    methods,
    secrets,
    credentialMethods,
    call: (method: string, args: any = {}) => runtime.request(method, args),
    discover: (requestId: string, previous?: ToolConnection) =>
      runtime.request('tool.connection.discover', {
        requestId,
        config,
        reviewedSource: true,
        ...(previous
          ? { connectionId: previous.id, revision: previous.revision }
          : { bearerToken: 'fictional-runtime-credential' }),
      }) as Promise<ConnectionCandidate>,
    reopen: async () => {
      await runtime.shutdown();
      runtime.store.close();
      runtime = new Runtime(root, resolve('dist'), process.execPath, Buffer.from(key), system);
      await runtime.ready;
    },
  };
}
async function until(check: () => boolean) {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) throw new Error('connection fixture timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('real runtime persists reviewed discovery via private vault calls and reopens without traffic or runs', async (t) => {
  const f = await fixture(t);
  const candidate = await f.discover('first');
  assert.deepEqual(await f.call('tool.connection.list'), []);
  assert.equal(f.secrets.size, 0);
  const saved: ToolConnection = await f.call('tool.connection.save', {
    token: candidate.token,
    reviewedCapabilities: true,
  });
  assert.equal(saved.status, 'verified');
  assert.ok(saved.hasCredential);
  assert.equal(JSON.stringify(saved).includes('fictional-runtime-credential'), false);
  assert.equal('credentialRef' in saved, false);
  assert.deepEqual(f.credentialMethods, ['tool.credentials.set']);
  await assert.rejects(f.call('tool.credentials.get', { id: 'mcp-forged' }), /未授权/);
  const before = [...f.methods];
  await f.reopen();
  assert.deepEqual(f.methods, before);
  assert.deepEqual((await f.call('bootstrap')).runs, []);
  assert.deepEqual(await f.call('task.list'), []);
  const restored = (await f.call('tool.connection.list'))[0];
  assert.equal(restored.status, 'unverified');
  const next = await f.discover('retest', restored);
  f.control.denySave = true;
  await assert.rejects(
    f.call('tool.connection.save', { token: next.token, reviewedCapabilities: true }),
    /原连接保持不变/,
  );
  assert.equal((await f.call('tool.connection.list'))[0].revision, saved.revision);
  assert.equal(f.secrets.size, 1);
  await f.call('tool.connection.remove', {
    id: saved.id,
    revision: saved.revision,
    confirmed: true,
  });
  assert.deepEqual(await f.call('tool.connection.list'), []);
  assert.equal(f.secrets.size, 0);
  assert.ok(f.methods.every((m) => ['server/discover', 'tools/list'].includes(m)));
});

test('suspend and shutdown cancel real pending HTTP discovery and never auto reconnect', async (t) => {
  const f = await fixture(t);
  f.control.stall = true;
  const pending = assert.rejects(f.discover('suspend'), /已取消/);
  await until(() => f.methods.includes('tools/list'));
  await f.call('system.suspend');
  await pending;
  await assert.rejects(f.discover('while-suspended'), /退出或休眠/);
  const before = [...f.methods];
  await f.call('system.resume');
  assert.deepEqual(f.methods, before);
  assert.deepEqual(await f.call('tool.connection.list'), []);
  const closing = assert.rejects(f.discover('shutdown'), /已取消/);
  await until(() => f.methods.length >= before.length + 2);
  await f.runtime.shutdown();
  await closing;
  assert.equal(f.secrets.size, 0);
  await assert.rejects(f.discover('after-shutdown'), /退出或休眠/);
});

test('shutdown cancels an active Worker before waiting for a blocked connection credential read', async (t) => {
  const f = await fixture(t);
  const candidate = await f.discover('save-first');
  const saved = await f.call('tool.connection.save', {
    token: candidate.token,
    reviewedCapabilities: true,
  });
  const record = await f.call('flow.create');
  await f.call('flow.save', {
    flow: {
      ...record.flow,
      steps: [{ id: 'hold', type: 'human', version: 1, message: 'fixture wait' }],
    },
    bindings: record.bindings,
  });
  const run = await f.call('flow.run', { id: record.id });
  await until(() => f.runtime.store.get<any>('run', run.id)?.state === 'WAITING_INPUT');
  let release!: () => void;
  f.control.getGate = new Promise<void>((r) => {
    release = r;
  });
  const discovery = assert.rejects(f.discover('wait-for-key', saved), /已取消/);
  await until(() => f.credentialMethods.includes('tool.credentials.get'));
  const shutdown = f.runtime.shutdown();
  try {
    await until(() => f.runtime.store.get<any>('run', run.id)?.state === 'CANCELLED');
  } finally {
    release();
    await discovery;
    await shutdown;
  }
  assert.equal(f.runtime.store.get<any>('run', run.id)?.state, 'CANCELLED');
});
