import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, realpath, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const PLACEHOLDER = 'flowark-local-development-placeholder';
// 12MiB image budget becomes 16MiB base64, plus bounded textual context.
const LIMIT = 20 * 1024 * 1024;
const sha = (value) => createHash('sha256').update(value).digest('hex');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

async function privateDirectory(path) {
  if (!isAbsolute(path)) throw Error('Mailbox directory must be an explicit absolute path');
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077)
    throw Error('Mailbox must be a real directory accessible only by its owner');
  if ((await realpath(path)) !== resolve(path))
    throw Error('Mailbox path must not traverse symlinks');
  return path;
}

async function readJson(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMIT)
    throw Error('Invalid mailbox file');
  return JSON.parse(await readFile(path, 'utf8'));
}

async function atomicJson(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
}

/** Local-only, no upstream transport. Agent-authored output is the sole success source. */
export async function startSubagentServer({
  mailbox,
  port = 48573,
  timeoutMs = 210000,
  log = console.log,
}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid port');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 210000)
    throw Error('Invalid bounded timeout');
  const root = await privateDirectory(mailbox);
  const entries = new Map();
  let stopping = false;
  for (const name of await readdir(root)) {
    if (!/^[a-f0-9]{64}\.request\.json$/.test(name)) continue;
    const request = await readJson(join(root, name));
    const fingerprint = name.slice(0, 64);
    if (
      !plainObject(request) ||
      request.sha256 !== fingerprint ||
      sha(JSON.stringify({ path: request.path, body: request.body })) !== fingerprint
    )
      throw Error('Mailbox request digest mismatch');
    entries.set(fingerprint, { request });
  }
  const send = (res, status, body, id) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(id ? { 'x-request-id': id } : {}),
    });
    res.end(JSON.stringify(body));
  };
  async function waitForOutput(entry) {
    const started = Date.now();
    while (!stopping && Date.now() - started < timeoutMs) {
      try {
        const response = await readJson(join(root, entry.request.sha256 + '.response.json'));
        if (!plainObject(response) || response.requestSha256 !== entry.request.sha256)
          throw Error('Response digest mismatch');
        const hasOutput = typeof response.output === 'string' || plainObject(response.output);
        if (hasOutput === !!response.error)
          throw Error('Provide exactly one agent output or explicit error');
        if (response.error) {
          if (
            !plainObject(response.error) ||
            !Number.isInteger(response.error.status) ||
            response.error.status < 400 ||
            response.error.status > 599 ||
            typeof response.error.message !== 'string'
          )
            throw Error('Invalid explicit agent error');
          return { status: response.error.status, error: response.error.message };
        }
        return {
          status: 200,
          text:
            typeof response.output === 'string' ? response.output : JSON.stringify(response.output),
        };
      } catch (error) {
        if (error.code !== 'ENOENT')
          return { status: 502, error: 'Invalid agent response file; no output adopted' };
      }
      await delay(150);
    }
    return {
      status: stopping ? 503 : 504,
      error: stopping
        ? 'Local agent server stopping'
        : 'Agent response deadline exceeded; no output generated',
    };
  }
  const server = createServer(async (req, res) => {
    const allowedPaths = ['/v1/chat/completions', '/v1/responses'];
    if (req.method === 'GET' && req.url === '/health')
      return send(res, 200, {
        mode: 'loopback-subagent',
        requests: entries.size,
        pending: [...entries.values()].filter((e) => e.pending).length,
        upstreamRequests: 0,
      });
    if (req.method !== 'POST' || !allowedPaths.includes(req.url))
      return send(res, 404, { error: { message: 'Unknown local endpoint' } });
    if (req.headers.authorization !== 'Bearer ' + PLACEHOLDER)
      return send(res, 401, {
        error: { message: 'Only the fixed local development placeholder is accepted' },
      });
    let bytes = 0;
    const chunks = [];
    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > LIMIT)
          return send(res, 413, { error: { message: 'Request exceeds local mailbox limit' } });
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!plainObject(body) || typeof body.model !== 'string' || body.stream === true)
        return send(res, 400, {
          error: { message: 'Expected a non-streaming compatible model request' },
        });
      const fingerprint = sha(JSON.stringify({ path: req.url, body }));
      let entry = entries.get(fingerprint);
      if (!entry) {
        entry = {
          request: {
            id: randomUUID(),
            sha256: fingerprint,
            path: req.url,
            receivedAt: new Date().toISOString(),
            body,
          },
        };
        // Publish the map entry before I/O so simultaneous identical requests share one mailbox.
        entries.set(fingerprint, entry);
        entry.written = atomicJson(join(root, fingerprint + '.request.json'), entry.request);
        await entry.written;
        log(
          JSON.stringify({
            event: 'agent-request',
            id: entry.request.id,
            sha256: fingerprint,
            path: req.url,
          }),
        );
      } else if (entry.written) await entry.written;
      const duplicate = !!entry.pending;
      if (!entry.pending)
        entry.pending = waitForOutput(entry).finally(() => {
          entry.pending = undefined;
        });
      const output = await entry.pending;
      await atomicJson(join(root, fingerprint + '.status.json'), {
        requestSha256: fingerprint,
        status: output.status,
        at: new Date().toISOString(),
        agentOutput: output.status === 200,
        usageProvided: false,
      });
      log(
        JSON.stringify({
          event: 'agent-result',
          id: entry.request.id,
          sha256: fingerprint,
          status: output.status,
          duplicate,
        }),
      );
      if (output.status !== 200)
        return send(res, output.status, { error: { message: output.error } }, entry.request.id);
      // Intentionally omit usage: token counts are unavailable for this development bridge.
      const result = req.url.endsWith('/chat/completions')
        ? {
            id: entry.request.id,
            object: 'chat.completion',
            choices: [
              {
                index: 0,
                finish_reason: 'stop',
                message: { role: 'assistant', content: output.text },
              },
            ],
          }
        : {
            id: entry.request.id,
            status: 'completed',
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: output.text }],
              },
            ],
          };
      send(res, 200, result, entry.request.id);
    } catch {
      send(res, 400, {
        error: { message: 'Invalid request or mailbox operation; no agent output adopted' },
      });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  log(
    JSON.stringify({
      event: 'listening',
      host: '127.0.0.1',
      port,
      mailbox: root,
      timeoutMs,
      upstreamRequests: 0,
    }),
  );
  return {
    server,
    close: async () => {
      stopping = true;
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--mailbox')
    throw Error(
      'Usage: node scripts/maintenance/subagent-ai-server.mjs --mailbox /absolute/private/directory',
    );
  const running = await startSubagentServer({ mailbox: args[1] });
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => {
      void running.close();
    });
}
