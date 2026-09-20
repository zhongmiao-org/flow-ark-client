import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Rpc } from '../src/shared/rpc.ts';
import { verifyBundle } from './verify-bundle.mjs';

const previous = process.env.FLOWARK_PREVIOUS_EXECUTABLE;
const current = process.env.FLOWARK_TEST_EXECUTABLE;
if (!previous || !current)
  throw new Error(
    'Set FLOWARK_PREVIOUS_EXECUTABLE and FLOWARK_TEST_EXECUTABLE to packaged executables',
  );
const data = await mkdtemp(join(tmpdir(), 'flowark-store-upgrade-'));
const key = randomBytes(32);
const database = join(data, 'flowark.sqlite');
const evidence = [];
function readDatabase() {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    return {
      version: db.prepare('PRAGMA user_version').get().user_version,
      documents: db.prepare('SELECT * FROM documents ORDER BY kind,id').all(),
      events: db.prepare('SELECT * FROM events ORDER BY run_id,seq').all(),
    };
  } finally {
    db.close();
  }
}
async function launch(executable) {
  const bundle = executable.split('/Contents/MacOS/')[0];
  assert.notEqual(bundle, executable, 'a packaged macOS app is required');
  await verifyBundle(bundle);
  const proc = fork(join(bundle, 'Contents/Resources/app.asar/dist/host.cjs'), [], {
    execPath: executable,
    execArgv: [],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', FLOWARK_DATA_DIR: data },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const rpc = new Rpc(
    (message) => proc.send(message),
    async (method) => {
      if (method === 'credentials.list') return [];
      if (method === 'notification' || method === 'browser.embedded.pick.cancel') return true;
      throw new Error('Unexpected fixture system request: ' + method);
    },
  );
  proc.on('message', (message) => void rpc.receive(message));
  proc.on('exit', () => rpc.close());
  proc.on('error', () => rpc.close());
  const exited = new Promise((resolve) =>
    proc.once('exit', (code, signal) => resolve({ code, signal })),
  );
  let initialized = false;
  return {
    rpc,
    async init() {
      await rpc.call('init', { dataPath: data, executable, key: key.toString('base64') });
      initialized = true;
    },
    async close() {
      try {
        if (initialized) await rpc.call('shutdown');
      } finally {
        if (proc.connected) proc.disconnect();
        const timer = setTimeout(() => {
          if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
        }, 5000);
        const exit = await exited;
        clearTimeout(timer);
        rpc.close();
        assert.equal(
          exit.signal,
          null,
          'fixture Host must exit without forced termination: ' + stderr,
        );
      }
    },
  };
}

let originalRun;
let original;
let host = await launch(previous);
try {
  await host.init();
  const first = await host.rpc.call('bootstrap');
  const run = await host.rpc.call('flow.run', { id: first.flows[0].id });
  const deadline = Date.now() + 20000;
  do {
    originalRun = await host.rpc.call('run.detail', { id: run.id });
    if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(originalRun.run.state)) break;
    if (Date.now() > deadline) throw new Error('Old packaged Host did not finish fixture');
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (true);
  assert.equal(originalRun.run.state, 'SUCCEEDED');
} finally {
  await host.close();
}
original = readDatabase();
assert.equal(original.version, 1, 'the previous package must use SQLite v1');
evidence.push({
  phase: 'previous',
  version: original.version,
  documents: original.documents.length,
  events: original.events.length,
});

host = await launch(current);
try {
  await host.init();
  assert.deepEqual(await host.rpc.call('run.detail', { id: originalRun.run.id }), originalRun);
  assert.equal((await host.rpc.call('bootstrap')).runtimeBlock, undefined);
} finally {
  await host.close();
}
const upgraded = readDatabase();
assert.equal(upgraded.version, 2);
assert.deepEqual(
  upgraded.documents,
  original.documents,
  'migration must retain all original encrypted document bytes',
);
assert.deepEqual(
  upgraded.events,
  original.events,
  'migration must retain all original encrypted event bytes',
);
evidence.push({ phase: 'upgraded', version: upgraded.version, ciphertextPreserved: true });

host = await launch(previous);
try {
  await assert.rejects(() => host.init(), /数据库版本.*已阻止打开/);
} finally {
  await host.close();
}
assert.deepEqual(
  readDatabase(),
  upgraded,
  'rejected old reader must not alter or recover the v2 database',
);
evidence.push({ phase: 'downgrade', rejected: true, databaseUnchanged: true });
await mkdir('test-results', { recursive: true });
const result = {
  time: new Date().toISOString(),
  dataPath: data,
  previousExecutable: previous,
  executablePath: current,
  evidence,
  ciphertextDigest: createHash('sha256').update(JSON.stringify(upgraded)).digest('hex'),
};
await writeFile('test-results/store-upgrade.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
