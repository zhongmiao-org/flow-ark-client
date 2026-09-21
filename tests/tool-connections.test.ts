import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { discoverMcp, McpCleanupError } from '../src/adapters/mcp-discovery';
import { ToolConnections } from '../src/host/tool-connections';
import { Store } from '../src/host/store';
import {
  connectionConfig,
  type ConnectionConfig,
  type ConnectionDiscovery,
} from '../src/shared/tool-connections';
import { validateIPC } from '../src/shared/ipc';

const tool = {
  name: 'read_selected',
  description: '读取明确选定记录',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  annotations: { readOnlyHint: true },
};
const modern = {
  resultType: 'complete',
  supportedVersions: ['2026-07-28'],
  capabilities: { tools: {} },
  _meta: { 'io.modelcontextprotocol/serverInfo': { name: '独立测试服务', version: '1.2.3' } },
};
const config = (url = 'https://tools.example.test/mcp'): ConnectionConfig => ({
  version: 1,
  displayName: '我的工具',
  source: '用户明确选择的测试来源',
  protocolVersion: '2026-07-28',
  transport: { type: 'http', url, auth: 'none' },
});
const snapshot: ConnectionDiscovery = {
  server: { name: 'Test', version: '1' },
  protocolVersion: '2026-07-28',
  tools: [tool],
  capabilityDigest: 'a'.repeat(64),
  testedAt: new Date().toISOString(),
};
test('Bearer authentication failure keeps a safe actionable error through SDK connection wrapping', async (t) => {
  const service = await remote(t, (_body, _req, res) => {
    res.writeHead(401).end();
    return true;
  });
  if (service.config.transport.type === 'http') service.config.transport.auth = 'bearer';
  await assert.rejects(
    discoverMcp(service.config, 'fictional-rejected-token', new AbortController().signal),
    /认证失败/,
  );
});
test('modern HTTP discovery rejects invalid mirrored headers without returning a partial capability list', async (t) => {
  let inputSchema: any = {
    type: 'object',
    properties: { id: { type: 'string', 'x-mcp-header': 'record-id' } },
  };
  const service = await remote(t, (body, _req, res) => {
    if (body.method !== 'tools/list') return false;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          resultType: 'complete',
          ttlMs: 0,
          cacheScope: 'private',
          tools: [{ ...tool, inputSchema }],
        },
      }),
    );
    return true;
  });
  assert.equal(
    (await discoverMcp(service.config, undefined, new AbortController().signal)).tools.length,
    1,
  );
  for (const schema of [
    { type: 'object', properties: { id: { type: 'number', 'x-mcp-header': 'record-id' } } },
    {
      type: 'object',
      properties: {
        one: { type: 'string', 'x-mcp-header': 'ID' },
        two: { type: 'string', 'x-mcp-header': 'id' },
      },
    },
    {
      type: 'object',
      properties: { rows: { type: 'array', items: { type: 'string', 'x-mcp-header': 'id' } } },
    },
  ]) {
    inputSchema = schema;
    await assert.rejects(
      discoverMcp(service.config, undefined, new AbortController().signal),
      /请求头声明/,
    );
  }
});
async function remote(
  t: any,
  handler?: (body: any, req: any, res: any) => boolean | Promise<boolean>,
) {
  const calls: any[] = [];
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    calls.push({ body, authorization: req.headers.authorization });
    if (await handler?.(body, req, res)) return;
    if (!('id' in body)) {
      res.writeHead(202).end();
      return;
    }
    const result =
      body.method === 'server/discover'
        ? modern
        : body.method === 'initialize'
          ? {
              protocolVersion: '2025-11-25',
              capabilities: { tools: {} },
              serverInfo: { name: 'Legacy', version: '1' },
            }
          : { resultType: 'complete', ttlMs: 0, cacheScope: 'private', tools: [tool] };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { calls, config: config(`http://127.0.0.1:${(server.address() as any).port}/mcp`) };
}
async function host(
  t: any,
  options: { discover?: typeof discoverMcp; time?: () => number; credentials?: any } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'flowark-mcp-unit-'));
  const key = randomBytes(32),
    path = join(dir, 'state.sqlite');
  const store = new Store(path, Buffer.from(key));
  const secrets = new Map<string, string>();
  const credentials = options.credentials ?? {
    get: async (id: string) => {
      if (!secrets.has(id)) throw new Error('missing');
      return secrets.get(id)!;
    },
    set: async (id: string, value: string) => {
      secrets.set(id, value);
    },
    remove: async (id: string) => {
      secrets.delete(id);
    },
  };
  const deps = {
    assertAvailable: () => {},
    credentials,
    discover: options.discover ?? (async () => snapshot),
    time: options.time,
  };
  const service = new ToolConnections(store, deps);
  t.after(async () => {
    await service.cancelAll().catch(() => {});
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { service, store, secrets, credentials, deps, key, path };
}
const discover = (service: ToolConnections, args: any = {}) =>
  service.request('tool.connection.discover', {
    requestId: 'r-' + randomBytes(6).toString('hex'),
    config: config(),
    reviewedSource: true,
    ...args,
  });
const save = (service: ToolConnections, candidate: any) =>
  service.request('tool.connection.save', { token: candidate.token, reviewedCapabilities: true });

test('connection IPC requires exact source confirmation and rejects credential/path/permission expansion', () => {
  for (const url of [
    'http://example.com/mcp',
    'https://u:password@example.com/mcp',
    'https://example.com/mcp?token=x',
    'https://example.com/mcp#x',
    'file:///tmp/test',
    'http://localhost/mcp',
  ])
    assert.throws(() => connectionConfig.parse(config(url)));
  assert.throws(() =>
    validateIPC('tool.connection.discover', { requestId: 'x', config: config() }),
  );
  assert.throws(() =>
    validateIPC('tool.connection.discover', {
      requestId: 'x',
      config: config(),
      reviewedSource: true,
      bearerToken: 'secret',
    }),
  );
  assert.throws(() =>
    validateIPC('tool.connection.discover', {
      requestId: 'x',
      config: config(),
      reviewedSource: true,
      connectionId: 'saved',
    }),
  );
  assert.throws(() =>
    validateIPC('tool.connection.save', {
      token: 'x',
      reviewedCapabilities: true,
      tools: [tool],
      grants: ['all'],
    }),
  );
  assert.throws(() => validateIPC('tool.credentials.set', { id: 'mcp-x', value: 'secret' }));
});

test('real current HTTP discovery sends only discovery/list with exact authentication and self-reported identity', async (t) => {
  const fixture = await remote(t);
  const c = {
    ...fixture.config,
    transport: { ...fixture.config.transport, auth: 'bearer' },
  } as ConnectionConfig;
  const found = await discoverMcp(c, 'fictional-bearer', new AbortController().signal);
  assert.equal(found.server?.name, '独立测试服务');
  assert.equal(found.tools.length, 1);
  assert.equal(found.protocolVersion, '2026-07-28');
  assert.match(found.capabilityDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    fixture.calls.map((c) => c.body.method),
    ['server/discover', 'tools/list'],
  );
  assert.ok(fixture.calls.every((c) => c.authorization === 'Bearer fictional-bearer'));
  assert.ok(
    fixture.calls.every(
      (c) =>
        Object.keys(c.body.params._meta['io.modelcontextprotocol/clientCapabilities']).length === 0,
    ),
  );
  assert.ok(!JSON.stringify(found).includes('fictional-bearer'));
});

test('legacy protocol is explicit and is never selected as fallback for a modern failure', async (t) => {
  const fixture = await remote(t);
  const c = { ...fixture.config, protocolVersion: '2025-11-25' } as ConnectionConfig;
  const found = await discoverMcp(c, undefined, new AbortController().signal);
  assert.equal(found.protocolVersion, '2025-11-25');
  assert.deepEqual(
    fixture.calls.map((c) => c.body.method),
    ['initialize', 'notifications/initialized', 'tools/list'],
  );
  const failure = await remote(t, (body, req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32601, message: 'unsupported' },
      }),
    );
    return true;
  });
  await assert.rejects(discoverMcp(failure.config, undefined, new AbortController().signal));
  assert.deepEqual(
    failure.calls.map((c) => c.body.method),
    ['server/discover'],
  );
});

test('HTTP refuses redirects, authentication errors, credential echoes and oversized responses', async (t) => {
  for (const kind of ['redirect', 'auth', 'large', 'echo']) {
    const fixture = await remote(t, (body, req, res) => {
      if (kind === 'redirect') {
        res.writeHead(302, { location: 'https://other.example.test/mcp' }).end();
        return true;
      }
      if (kind === 'auth') {
        res.writeHead(401).end('fictional-secret never displayed');
        return true;
      }
      if (kind === 'large') {
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': 3000000 }).end();
        return true;
      }
      if (body.method === 'tools/list') {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              resultType: 'complete',
              ttlMs: 0,
              cacheScope: 'private',
              tools: [{ ...tool, description: 'fictional-secret' }],
            },
          }),
        );
        return true;
      }
      return false;
    });
    const c = {
      ...fixture.config,
      transport: { ...fixture.config.transport, auth: 'bearer' },
    } as ConnectionConfig;
    await assert.rejects(
      discoverMcp(c, 'fictional-secret', new AbortController().signal),
      (error) => !String(error).includes('fictional-secret'),
    );
    assert.ok(fixture.calls.length <= 2);
  }
});

test('discovery rejects repeated tools/cursors and observes cancellation and total deadline', async (t) => {
  for (const duplicate of [true, false]) {
    const fixture = await remote(t, (body, req, res) => {
      if (body.method !== 'tools/list') return false;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            resultType: 'complete',
            ttlMs: 0,
            cacheScope: 'private',
            tools: duplicate ? [tool, tool] : [],
            nextCursor: duplicate ? undefined : 'again',
          },
        }),
      );
      return true;
    });
    await assert.rejects(
      discoverMcp(fixture.config, undefined, new AbortController().signal),
      duplicate ? /重复工具/ : /分页/,
    );
    assert.ok(fixture.calls.length <= 3);
  }
  const silent = await remote(t, () => true);
  await assert.rejects(
    discoverMcp(silent.config, undefined, new AbortController().signal, { timeoutMs: 60 }),
  );
  const abort = new AbortController();
  const pending = discoverMcp(silent.config, undefined, abort.signal);
  setTimeout(() => abort.abort(), 20);
  await assert.rejects(pending, /取消/);
});

test('real stdio discovery starts once, excludes parent secrets and reaps its owned process', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flowark-mcp-stdio-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const entry = join(dir, 'server.cjs'),
    evidence = join(dir, 'evidence.jsonl');
  await writeFile(
    entry,
    `const fs=require('node:fs'), rl=require('node:readline'); const file=process.argv[2];
fs.appendFileSync(file,JSON.stringify({pid:process.pid,env:Object.keys(process.env),arg:process.argv[3]})+'\\n');
rl.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(file,JSON.stringify({method:m.method})+'\\n');if(!('id' in m))return;
const result=m.method==='server/discover'?${JSON.stringify(modern)}:{resultType:'complete',ttlMs:0,cacheScope:'private',tools:[${JSON.stringify(tool)}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`,
  );
  const found = await discoverMcp(
    {
      ...config(),
      transport: {
        type: 'stdio',
        command: process.execPath,
        args: [entry, evidence, '$(echo literal)'],
      },
    },
    undefined,
    new AbortController().signal,
  );
  assert.equal(found.tools[0].name, tool.name);
  const rows = (await readFile(evidence, 'utf8'))
    .trim()
    .split('\n')
    .map((s) => JSON.parse(s));
  const starts = rows.filter((r) => r.pid);
  assert.equal(starts.length, 1);
  assert.deepEqual(
    starts[0].env.filter((key: string) => key !== '__CF_USER_TEXT_ENCODING').sort(),
    ['LANG', 'PATH'],
  );
  assert.equal(starts[0].arg, '$(echo literal)');
  assert.throws(() => process.kill(starts[0].pid, 0), { code: 'ESRCH' });
  assert.deepEqual(
    rows.filter((r) => r.method).map((r) => r.method),
    ['server/discover', 'tools/list'],
  );
});

test('stdio timeout closes a process that ignores stdin EOF without returning stderr', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flowark-mcp-timeout-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const entry = join(dir, 'hang.cjs'),
    pidFile = join(dir, 'pid');
  await writeFile(
    entry,
    `require('node:fs').writeFileSync(process.argv[2],String(process.pid));process.stderr.write('private-program-stderr');process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`,
  );
  await assert.rejects(
    discoverMcp(
      {
        ...config(),
        transport: { type: 'stdio', command: process.execPath, args: [entry, pidFile] },
      },
      undefined,
      new AbortController().signal,
      { timeoutMs: 100 },
    ),
    (error) => !String(error).includes('private-program-stderr'),
  );
  const pid = Number(await readFile(pidFile, 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('candidate requires separate confirmation; encrypted saved state contains no key and restart is offline', async (t) => {
  let calls = 0;
  const h = await host(t, {
    discover: async () => {
      calls++;
      return snapshot;
    },
  });
  const c = {
    ...config(),
    transport: { type: 'http', url: 'https://tools.example.test/mcp', auth: 'bearer' },
  } as ConnectionConfig;
  const candidate = await discover(h.service, { config: c, bearerToken: 'fictional-key' });
  assert.deepEqual(await h.service.request('tool.connection.list', {}), []);
  assert.ok(!JSON.stringify(candidate).includes('fictional-key'));
  const record = await save(h.service, candidate);
  assert.equal(record.hasCredential, true);
  assert.equal(record.status, 'verified');
  assert.ok(!JSON.stringify(record).includes('credentialRef'));
  assert.equal(h.secrets.size, 1);
  await assert.rejects(save(h.service, candidate));
  const reopened = new ToolConnections(h.store, h.deps);
  const list = await reopened.request('tool.connection.list', {});
  assert.equal(list[0].status, 'unverified');
  assert.equal(calls, 1);
  assert.ok(!(await readFile(h.path)).includes(Buffer.from('fictional-key')));
});

test('reconnect cannot move saved credentials to another endpoint; changed capabilities await review', async (t) => {
  let found = snapshot;
  const h = await host(t, { discover: async () => found });
  const c = {
    ...config(),
    transport: { type: 'http', url: 'https://tools.example.test/mcp', auth: 'bearer' },
  } as ConnectionConfig;
  const saved = await save(
    h.service,
    await discover(h.service, { config: c, bearerToken: 'fictional-key' }),
  );
  await assert.rejects(
    discover(h.service, {
      config: { ...c, transport: { ...c.transport, url: 'https://other.example.test/mcp' } },
      connectionId: saved.id,
      revision: saved.revision,
    }),
  );
  found = {
    ...snapshot,
    tools: [...snapshot.tools, { ...tool, name: 'write_selected' }],
    capabilityDigest: 'b'.repeat(64),
  };
  const candidate = await discover(h.service, {
    config: c,
    connectionId: saved.id,
    revision: saved.revision,
  });
  assert.equal(candidate.changed, true);
  assert.equal((await h.service.request('tool.connection.list', {}))[0].tools.length, 1);
  const replaced = await save(h.service, candidate);
  assert.equal(replaced.tools.length, 2);
  assert.equal(replaced.revision, 2);
  assert.equal(h.secrets.size, 1);
});

test('cancel, disconnect, expiry and late discovery cannot restore stale connection state', async (t) => {
  let release: (() => void) | undefined,
    delayed = false,
    time = 100;
  const h = await host(t, {
    time: () => time,
    discover: async () => {
      if (delayed)
        await new Promise<void>((r) => {
          release = r;
        });
      return snapshot;
    },
  });
  const saved = await save(h.service, await discover(h.service));
  const candidate = await discover(h.service, { connectionId: saved.id, revision: saved.revision });
  time += 300001;
  await assert.rejects(save(h.service, candidate), /过期/);
  delayed = true;
  const pending = discover(h.service, {
    requestId: 'late',
    connectionId: saved.id,
    revision: saved.revision,
  });
  const rejected = assert.rejects(pending, /取消/);
  const disconnected = h.service.request('tool.connection.disconnect', {
    id: saved.id,
    revision: saved.revision,
  });
  release!();
  await disconnected;
  await rejected;
  assert.equal((await h.service.request('tool.connection.list', {}))[0].status, 'disconnected');
  await assert.rejects(discover(h.service, { connectionId: saved.id, revision: saved.revision }));
  delayed = false;
  const next = await discover(h.service);
  await h.service.request('tool.connection.cancel', { requestId: next.requestId });
  await assert.rejects(save(h.service, next));
});

test('disconnect during credential persistence invalidates save and removes the unreferenced key', async (t) => {
  const secrets = new Map<string, string>();
  let release: (() => void) | undefined,
    delay = false;
  const h = await host(t, {
    credentials: {
      get: async (id: string) => secrets.get(id)!,
      remove: async (id: string) => {
        secrets.delete(id);
      },
      set: async (id: string, value: string) => {
        secrets.set(id, value);
        if (delay)
          await new Promise<void>((r) => {
            release = r;
          });
      },
    },
  });
  const c = {
    ...config(),
    transport: { type: 'http', url: 'https://tools.example.test/mcp', auth: 'bearer' },
  } as ConnectionConfig;
  const saved = await save(
    h.service,
    await discover(h.service, { config: c, bearerToken: 'old-secret' }),
  );
  const candidate = await discover(h.service, {
    config: c,
    connectionId: saved.id,
    revision: saved.revision,
    bearerToken: 'new-secret',
  });
  delay = true;
  const pending = save(h.service, candidate),
    rejected = assert.rejects(pending);
  await h.service.request('tool.connection.disconnect', { id: saved.id, revision: saved.revision });
  release!();
  await rejected;
  assert.deepEqual([...secrets.values()], ['old-secret']);
  assert.equal((await h.service.request('tool.connection.list', {}))[0].revision, 2);
});

test('save failure preserves previous connection and cleanup uncertainty prevents another launch', async (t) => {
  const h = await host(t);
  const saved = await save(h.service, await discover(h.service));
  const candidate = await discover(h.service, { connectionId: saved.id, revision: saved.revision });
  const put = h.store.put.bind(h.store);
  h.store.put = () => {
    throw new Error('write failure');
  };
  await assert.rejects(save(h.service, candidate));
  h.store.put = put;
  assert.equal((await h.service.request('tool.connection.list', {}))[0].revision, 1);
  const broken = await host(t, {
    discover: async () => {
      throw new McpCleanupError('cannot reap');
    },
  });
  await assert.rejects(discover(broken.service));
  await assert.rejects(discover(broken.service), /回收未确认/);
  await h.service.request('tool.connection.remove', { id: saved.id, revision: 1, confirmed: true });
  assert.deepEqual(await h.service.request('tool.connection.list', {}), []);
});

test('credential removal failure preserves a retryable record and blocks concurrent reconnection', async (t) => {
  const h = await host(t);
  const c = {
    ...config(),
    transport: { type: 'http', url: 'https://tools.example.test/mcp', auth: 'bearer' },
  } as ConnectionConfig;
  const saved = await save(
    h.service,
    await discover(h.service, { config: c, bearerToken: 'fictional-key' }),
  );
  const remove = h.credentials.remove;
  let rejectRemoval!: (error: Error) => void;
  h.credentials.remove = () =>
    new Promise<void>((_, reject) => {
      rejectRemoval = reject;
    });
  const pending = h.service.request('tool.connection.remove', {
    id: saved.id,
    revision: saved.revision,
    confirmed: true,
  });
  const rejected = assert.rejects(pending, /记录已保留/);
  await assert.rejects(
    discover(h.service, { config: c, connectionId: saved.id, revision: saved.revision }),
    /正在删除/,
  );
  await assert.rejects(
    h.service.request('tool.connection.disconnect', { id: saved.id, revision: saved.revision }),
    /正在删除/,
  );
  rejectRemoval(new Error('unavailable-storage-secret-must-not-leak'));
  await rejected;
  const [retained] = await h.service.request('tool.connection.list', {});
  assert.equal(retained.id, saved.id);
  assert.equal(retained.status, 'failed');
  assert.equal(h.secrets.size, 1);
  h.credentials.remove = remove;
  await h.service.request('tool.connection.remove', {
    id: retained.id,
    revision: retained.revision,
    confirmed: true,
  });
  assert.deepEqual(await h.service.request('tool.connection.list', {}), []);
  assert.equal(h.secrets.size, 0);
});
