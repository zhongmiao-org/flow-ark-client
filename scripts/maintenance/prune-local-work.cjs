/** Offline, explicit maintenance only. Never imported by startup or migrations. */
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const tokenPattern =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b[0-9a-f]{64}\b/gi;
const managed = new Set([
  'flow',
  'version',
  'snapshot',
  'run',
  'output',
  'artifact',
  'attention',
  'template-instance',
  'template-package',
  'template-data-context',
  'template-state',
  'template-state-meta',
  'template-data-operation',
  'template-data-edit',
  'template-data-cancelled',
  'template-approval',
  'template-result',
  'template-resource-extension-operation',
  'flow-run-request',
  'rerun-request',
  'entry-result-display',
  'run-output-packed',
  'typed-run-index',
  'typed-run-result',
  'run-result-ledger',
  'run-result-reuse',
  'run-result-copy-index',
  'browser-fields-input',
  'browser-scroll-input',
  'document-source-proof',
  'author-adoption',
  'author-checkout',
  'author-create',
  'author-debug-context',
  'author-debug-state',
  'author-debug-state-meta',
  'author-draft',
  'author-export',
  'author-sdk-context',
  'author-sdk-result',
  'batch-initialization',
  'batch-owner-ref',
  'batch-run-link',
  'batch-run-ref',
  'batch-session',
  'batch-session-private',
  'batch-stop-request',
]);
const isManaged = (kind) => managed.has(kind) || kind.startsWith('run-result-index:');
const ownerFields = new Set(['flowId', 'runId', 'instanceId', 'contextId', 'draftId', 'sessionId']);

function options(argv) {
  const result = { action: argv[0] };
  for (let i = 1; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || !argv[i + 1]) throw Error('Expected --option value');
    const name = argv[i].slice(2);
    if (!['data', 'backup', 'roots', 'plan', 'expect'].includes(name) || name in result)
      throw Error('Unknown or duplicate option');
    result[name] = argv[i + 1];
  }
  if (
    !['preview', 'apply', 'restore', 'audit'].includes(result.action) ||
    !result.data ||
    !result.backup ||
    !result.plan
  )
    throw Error(
      'Usage: electron scripts/maintenance/prune-local-work.cjs preview|apply|restore|audit --data DIRECTORY --backup STOPPED_SQLITE --plan FILE [--roots KEEP_IDS_JSON] [--expect PLAN_SHA256]',
    );
  return result;
}

function stopped(dbPath) {
  try {
    if (
      execFileSync('/usr/sbin/lsof', ['-t', dbPath], { encoding: 'utf8' })
        .trim()
        .split(/\s+/)
        .some((pid) => pid && Number(pid) !== process.pid)
    )
      throw Error('Database is open by another process');
  } catch (e) {
    if (e.status !== 1) throw e;
  }
  const processes = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split(
    '\n',
  );
  if (
    processes.some(
      (line) =>
        Number(line.trim().split(/\s/)[0]) !== process.pid &&
        /\/FlowArk\.app\/Contents\/(MacOS|Frameworks)|flow-ark-client\/dist\/(main|host|worker|script)/.test(
          line,
        ),
    )
  )
    throw Error('FlowArk or an owned runtime is still running');
}

function regular(file) {
  if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())
    throw Error('Expected regular non-symlink file');
  return fs.realpathSync(file);
}

function openPayload(payload, key) {
  const b = Buffer.from(payload, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  decipher.setAuthTag(b.subarray(-16));
  return JSON.parse(
    Buffer.concat([decipher.update(b.subarray(12, -16)), decipher.final()]).toString(),
  );
}

function walk(value, visit, field = '') {
  if (typeof value === 'string') visit(value, field);
  else if (value && typeof value === 'object') {
    if (typeof value.id === 'string' && typeof value.version === 'string')
      visit(value.id + '@' + value.version, '');
    for (const [k, v] of Object.entries(value)) {
      visit(k, '');
      walk(v, visit, k);
    }
  }
}

function scan(db, key, graph = false) {
  const rows = [],
    index = new Map(),
    refs = [],
    owners = [];
  const alias = (id, n) => {
    if (typeof id !== 'string' || !id) return;
    if (!index.has(id)) index.set(id, []);
    index.get(id).push(n);
  };
  for (const row of db
    .prepare('SELECT kind,id,payload FROM documents ORDER BY kind,id')
    .iterate()) {
    const n = rows.length;
    const record = { kind: row.kind, id: row.id, sha256: sha(row.payload) };
    rows.push(record);
    if (!graph) continue;
    const x = openPayload(row.payload, key),
      out = new Set(),
      owned = new Set();
    alias(row.id, n);
    alias(x.id, n);
    walk(x, (value, field) => {
      if (value.length <= 512) out.add(value);
      for (const token of value.matchAll(tokenPattern)) out.add(token[0]);
      if (ownerFields.has(field)) owned.add(value);
    });
    if (x.flow?.sourceTemplate)
      out.add(x.flow.sourceTemplate.id + '@' + x.flow.sourceTemplate.version);
    for (const token of row.id.matchAll(tokenPattern)) owned.add(token[0]);
    record.label = x.name ?? x.flow?.name ?? x.definition?.metadata?.name ?? null;
    record.protected =
      !isManaged(row.kind) ||
      (row.kind === 'template-state' &&
        ['applicationIntents', 'conversationControls', 'replyIntents'].some(
          (k) => Array.isArray(x[k]) && x[k].length > 0,
        ));
    refs[n] = out;
    owners[n] = owned;
    if (n % 10000 === 0) console.error('Indexed records: ' + n);
  }
  const documentCount = rows.length;
  for (const row of db
    .prepare('SELECT run_id,seq,payload FROM events ORDER BY run_id,seq')
    .iterate()) {
    const n = rows.length;
    rows.push({ kind: '$event', id: row.run_id, seq: row.seq, sha256: sha(row.payload) });
    if (graph) {
      const out = new Set([row.run_id]);
      walk(openPayload(row.payload, key), (value) => {
        if (index.has(value)) out.add(value);
        for (const token of value.matchAll(tokenPattern)) out.add(token[0]);
      });
      refs[n] = out;
      owners[n] = new Set([row.run_id]);
    }
  }
  const fingerprint = sha(
    JSON.stringify(rows.map(({ kind, id, seq, sha256 }) => [kind, id, seq ?? null, sha256])),
  );
  return { rows, documentCount, index, refs, owners, fingerprint };
}

function closeGraph(scanned, roots) {
  const { rows, index, refs, owners } = scanned;
  const reverse = new Map(),
    kept = new Set(),
    queue = [];
  const keep = (n) => {
    if (!kept.has(n)) {
      kept.add(n);
      queue.push(n);
    }
  };
  for (let n = 0; n < rows.length; n++) {
    for (const id of owners[n] ?? []) {
      if (!reverse.has(id)) reverse.set(id, []);
      reverse.get(id).push(n);
    }
    if (rows[n].protected) keep(n);
  }
  for (const id of roots) {
    if (!index.has(id)) throw Error('A required keep root is missing: ' + id);
    index.get(id).forEach(keep);
  }
  // Alias equality preserves rows sharing an ID. Owner edges retain all history
  // of a kept flow/run/context/draft, while references preserve its dependencies.
  const aliases = Array.from({ length: rows.length }, () => []);
  for (const [id, ns] of index) for (const n of ns) aliases[n].push(id);
  for (let head = 0; head < queue.length; head++) {
    const n = queue[head];
    for (const id of refs[n] ?? []) for (const target of index.get(id) ?? []) keep(target);
    for (const id of aliases[n]) {
      (index.get(id) ?? []).forEach(keep);
      (reverse.get(id) ?? []).forEach(keep);
    }
  }
  return rows.map((r, n) => ({ ...r, keep: kept.has(n) }));
}

function summary(rows) {
  const result = {};
  for (const r of rows) {
    result[r.kind] ??= { keep: 0, remove: 0 };
    result[r.kind][r.keep ? 'keep' : 'remove']++;
  }
  return result;
}

function integrity(db) {
  const result = db.prepare('PRAGMA integrity_check').all();
  if (result.length !== 1 || result[0].integrity_check !== 'ok')
    throw Error('Database integrity check failed');
}

function rowKey(r) {
  return JSON.stringify([r.kind, r.id, r.seq ?? null]);
}
function matches(actual, expected) {
  if (actual.length !== expected.length) return false;
  const values = new Map(actual.map((r) => [rowKey(r), r.sha256]));
  return expected.every((r) => values.get(rowKey(r)) === r.sha256);
}

async function main(opt) {
  const root = fs.realpathSync(opt.data),
    dbPath = regular(path.join(root, 'flowark.sqlite'));
  const backupPath = regular(opt.backup);
  if (backupPath === dbPath || root === '/')
    throw Error('Independent stopped database backup required');
  stopped(dbPath);
  if (!(await safeStorage.isAsyncEncryptionAvailable()))
    throw Error('Protected storage unavailable');
  const key = Buffer.from(
    (
      await safeStorage.decryptStringAsync(
        fs.readFileSync(regular(path.join(root, 'credentials/data-key.enc'))),
      )
    ).result,
    'base64',
  );
  if (key.length !== 32) {
    key.fill(0);
    throw Error('Invalid protected data key');
  }
  let db, backup;
  try {
    db = new DatabaseSync(dbPath, { readOnly: opt.action === 'preview' || opt.action === 'audit' });
    backup = new DatabaseSync(backupPath, { readOnly: true });
    integrity(db);
    integrity(backup);
    if (opt.action === 'preview') {
      if (!opt.roots) throw Error('Explicit keep roots required');
      const roots = JSON.parse(fs.readFileSync(regular(opt.roots), 'utf8')).ids;
      if (!Array.isArray(roots) || !roots.length || roots.some((r) => typeof r !== 'string'))
        throw Error('Invalid keep roots');
      const source = scan(db, key, true),
        archived = scan(backup, key);
      if (source.fingerprint !== archived.fingerprint)
        throw Error('Backup differs from stopped source');
      const rows = closeGraph(source, roots);
      const plan = {
        format: 'flowark-prune-v1',
        root,
        dbPath,
        backupPath,
        createdAt: new Date().toISOString(),
        roots,
        before: source.fingerprint,
        rows,
        counts: summary(rows),
      };
      const content = JSON.stringify(plan, null, 2) + '\n';
      fs.writeFileSync(opt.plan, content, { mode: 0o600, flag: 'wx' });
      console.log(
        JSON.stringify({ plan: path.resolve(opt.plan), sha256: sha(content), counts: plan.counts }),
      );
      return;
    }
    const content = fs.readFileSync(regular(opt.plan), 'utf8'),
      plan = JSON.parse(content);
    if (opt.expect !== sha(content)) throw Error('Exact preview SHA256 confirmation required');
    if (
      plan.format !== 'flowark-prune-v1' ||
      plan.root !== root ||
      plan.dbPath !== dbPath ||
      plan.backupPath !== backupPath
    )
      throw Error('Plan belongs to another source or backup');
    const archived = scan(backup, key, true);
    if (archived.fingerprint !== plan.before || !matches(archived.rows, plan.rows))
      throw Error('Backup or manifest changed');
    const expectedSelection = closeGraph(archived, plan.roots);
    if (expectedSelection.some((r, n) => r.keep !== plan.rows[n].keep))
      throw Error('Selection no longer matches protected reference closure');
    const actual = scan(db, key),
      retained = plan.rows.filter((r) => r.keep),
      removed = plan.rows.filter((r) => !r.keep);
    const pruned = matches(actual.rows, retained),
      original = matches(actual.rows, plan.rows);
    if (opt.action === 'audit') {
      if (!original && !pruned)
        throw Error('Data has drifted from both original and pruned manifests');
      console.log(
        JSON.stringify({
          state: original ? 'original' : 'pruned',
          counts: plan.counts,
          integrity: 'ok',
        }),
      );
      return;
    }
    if ((opt.action === 'apply' && !original) || (opt.action === 'restore' && !pruned))
      throw Error('Source drift; no changes applied');
    // The full source was checked before BEGIN. A second reader may not race this
    // exclusive transaction; hash predicates are checked again before each delete.
    stopped(dbPath);
    db.exec('BEGIN EXCLUSIVE');
    try {
      if (!matches(scan(db, key).rows, opt.action === 'apply' ? plan.rows : retained))
        throw Error('Source changed before lock');
      const getDoc = db.prepare('SELECT payload FROM documents WHERE kind=? AND id=?');
      const getEvent = db.prepare('SELECT payload FROM events WHERE run_id=? AND seq=?');
      const deleteDoc = db.prepare('DELETE FROM documents WHERE kind=? AND id=? AND payload=?');
      const deleteEvent = db.prepare('DELETE FROM events WHERE run_id=? AND seq=? AND payload=?');
      const insertDoc = db.prepare('INSERT INTO documents(kind,id,payload) VALUES(?,?,?)');
      const insertEvent = db.prepare('INSERT INTO events(run_id,seq,payload) VALUES(?,?,?)');
      for (const r of removed) {
        const event = r.kind === '$event',
          args = event ? [r.id, r.seq] : [r.kind, r.id];
        const payload =
          opt.action === 'apply'
            ? (event ? getEvent : getDoc).get(...args)?.payload
            : backup
                .prepare(
                  event
                    ? 'SELECT payload FROM events WHERE run_id=? AND seq=?'
                    : 'SELECT payload FROM documents WHERE kind=? AND id=?',
                )
                .get(...args)?.payload;
        if (payload === undefined || sha(payload) !== r.sha256) throw Error('Record changed');
        if (opt.action === 'apply') {
          if ((event ? deleteEvent : deleteDoc).run(...args, payload).changes !== 1)
            throw Error('Delete conflict');
        } else (event ? insertEvent : insertDoc).run(...args, payload);
      }
      if (!matches(scan(db, key).rows, opt.action === 'apply' ? retained : plan.rows))
        throw Error('Post-operation manifest mismatch');
      integrity(db);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    console.log(
      JSON.stringify({
        completed: opt.action,
        counts: plan.counts,
        managedFilesChanged: false,
        integrity: 'ok',
      }),
    );
  } finally {
    db?.close();
    backup?.close();
    key.fill(0);
  }
}

let opt;
try {
  opt = options(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
app.setName('flow-ark-client');
const control = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'flowark-prune-'));
fs.chmodSync(control, 0o700);
app.setPath('userData', control);
app
  .whenReady()
  .then(() => main(opt))
  .then(() => app.quit())
  .catch((error) => {
    console.error(error.message);
    app.exit(1);
  });
