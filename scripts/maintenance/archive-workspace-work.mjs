import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  lstatSync,
  realpathSync,
  existsSync,
  mkdirSync,
  renameSync,
  copyFileSync,
  readlinkSync,
} from 'node:fs';
import { resolve, join, dirname, basename, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

// Explicit offline workspace-json-v1 maintenance. Never imported by app startup.
const FORMAT = 'flowark-workspace-work-archive-v1',
  PREFIX = 'workspace-json-v1:';
const MANAGED = ['artifacts', 'compiled', 'template-packages', 'project-builds'];
const KEEP = ['browser', 'settings', 'setting', 'ai-validation'];
const keep = (kind) => KEEP.includes(kind) || kind.startsWith('skill-');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => JSON.stringify(value);
const fail = (message) => {
  throw Error(message);
};
function regular(path) {
  const s = lstatSync(path);
  if (!s.isFile() || s.isSymbolicLink()) fail('Expected regular non-symlink file: ' + path);
  return realpathSync(path);
}
function directory(path) {
  const s = lstatSync(path);
  if (!s.isDirectory() || s.isSymbolicLink()) fail('Expected real directory: ' + path);
  return realpathSync(path);
}
function stopped(dbPath) {
  for (const file of [dbPath, dbPath + '-wal', dbPath + '-shm'])
    if (existsSync(file))
      try {
        const output = execFileSync('/usr/sbin/lsof', ['-t', file], { encoding: 'utf8' });
        if (
          output
            .trim()
            .split(/\s+/)
            .some((pid) => Number(pid) !== process.pid)
        )
          fail('Database/sidecar is open: ' + file);
      } catch (error) {
        if (error.status !== 1) throw error;
      }
  const rows = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n');
  if (
    rows.some(
      (row) =>
        Number(row.trim().split(/\s/)[0]) !== process.pid &&
        /\/FlowArk\.app\/Contents\/(?:MacOS|Frameworks)|flow-ark-client\/dist\/(?:main|host|worker|script|browser|project|document-supervisor|script-supervisor)\.cjs/.test(
          row,
        ),
    )
  )
    fail('Stop FlowArk and owned runtimes before maintenance');
}
function inventory(path) {
  if (!existsSync(path)) return { exists: false, sha256: sha('missing'), entries: 0, bytes: 0 };
  const rows = [];
  let bytes = 0;
  const walk = (p, name) => {
    const s = lstatSync(p);
    if (s.isSymbolicLink()) rows.push([name, 'symlink', readlinkSync(p)]);
    else if (s.isDirectory()) {
      rows.push([name, 'directory']);
      for (const child of readdirSync(p).sort())
        walk(join(p, child), name ? name + '/' + child : child);
    } else if (s.isFile()) {
      const b = readFileSync(p);
      bytes += b.length;
      rows.push([name, 'file', b.length, sha(b)]);
    } else fail('Unsupported filesystem entry: ' + p);
  };
  walk(path, '');
  return { exists: true, sha256: sha(json(rows)), entries: rows.length, bytes };
}
function snapshot(path) {
  const db = new DatabaseSync(regular(path), { readOnly: true });
  try {
    db.exec('BEGIN');
    const check = db.prepare('PRAGMA integrity_check').all();
    if (check.length !== 1 || check[0].integrity_check !== 'ok')
      fail('SQLite integrity check failed');
    const schema = db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
      )
      .all();
    if (
      schema.some((x) => x.type !== 'table') ||
      schema
        .map((x) => x.name)
        .sort()
        .join(',') !== 'documents,events'
    )
      fail('Only the existing documents/events store layout is supported');
    const userVersion = db.prepare('PRAGMA user_version').get().user_version,
      applicationId = db.prepare('PRAGMA application_id').get().application_id;
    const documents = db.prepare('SELECT kind,id,payload FROM documents ORDER BY kind,id').all(),
      events = db.prepare('SELECT run_id,seq,payload FROM events ORDER BY run_id,seq').all();
    if (
      [...documents, ...events].some(
        (row) => typeof row.payload !== 'string' || !row.payload.startsWith(PREFIX),
      )
    )
      fail(
        'Only workspace-json-v1 payloads are supported; no protected credentials will be opened',
      );
    const head = { schema, userVersion, applicationId };
    const digest = (docs, evs) =>
      sha(
        json([
          head,
          docs.map((x) => [x.kind, x.id, sha(x.payload)]),
          evs.map((x) => [x.run_id, x.seq, sha(x.payload)]),
        ]),
      );
    const retained = documents.filter((x) => keep(x.kind)),
      counts = {};
    for (const row of documents) {
      counts[row.kind] ??= { keep: 0, archive: 0 };
      counts[row.kind][keep(row.kind) ? 'keep' : 'archive']++;
    }
    const unknownCounts = {};
    for (const row of documents)
      if (['desktop-effect', 'template-effect'].includes(row.kind)) {
        const v = JSON.parse(row.payload.slice(PREFIX.length));
        if (v.state === 'unknown' || v.status === 'unknown' || v.receipt?.status === 'unknown')
          unknownCounts[row.kind] = (unknownCounts[row.kind] ?? 0) + 1;
      }
    const skillWorkspaces = [
      ...new Set(
        retained
          .filter((x) => x.kind.startsWith('skill-'))
          .map((x) => JSON.parse(x.payload.slice(PREFIX.length))?.workspace?.path)
          .filter((x) => typeof x === 'string'),
      ),
    ].sort();
    return {
      fingerprint: digest(documents, events),
      retainedFingerprint: digest(retained, []),
      schemaSha256: sha(json(head)),
      userVersion,
      applicationId,
      documentCount: documents.length,
      eventCount: events.length,
      retainedCount: retained.length,
      counts,
      skillWorkspaces,
      unknownCounts,
    };
  } finally {
    db.close();
  }
}
function paths(opt) {
  const root = directory(opt.data),
    markerPath = regular(join(root, 'workspace-storage.json')),
    marker = readFileSync(markerPath, 'utf8'),
    policy = JSON.parse(marker),
    { stamp, ...body } = policy;
  if (
    policy.version !== 1 ||
    policy.format !== 'workspace-json-v1' ||
    sha(json(body)) !== stamp ||
    !/^[a-f0-9-]{36}$/.test(policy.candidateId)
  )
    fail('Active ordinary-workspace marker is invalid');
  directory(join(root, 'workspace-public'));
  const parent = directory(join(root, 'workspace-public', policy.candidateId)),
    dbPath = regular(join(parent, 'flowark.sqlite'));
  if (opt.database && regular(opt.database) !== dbPath)
    fail('Explicit database is not the active marker target');
  const backupPath = regular(opt.backup),
    archiveParent = directory(dirname(resolve(opt.archive))),
    archive = join(archiveParent, basename(resolve(opt.archive)));
  if (
    backupPath === dbPath ||
    archive === root ||
    !relative(root, archive).startsWith('..' + sep) ||
    archive === dirname(dbPath)
  )
    fail('Independent backup and archive outside userData are required');
  if (lstatSync(archiveParent).dev !== lstatSync(parent).dev)
    fail('Archive must be on the same filesystem for reversible renames');
  return { root, markerPath, markerSha256: sha(marker), dbPath, backupPath, archive };
}
function preserved(p, skillWorkspaces) {
  const entries = [];
  for (const name of readdirSync(p.root).sort())
    if (!MANAGED.includes(name) && name !== 'workspace-public')
      entries.push({ path: join(p.root, name), ...inventory(join(p.root, name)) });
  for (const path of skillWorkspaces)
    if (existsSync(path)) entries.push({ path: directory(path), ...inventory(path) });
    else fail('Retained personal Skill workspace is missing');
  return entries;
}
function inspect(opt) {
  const p = paths(opt);
  stopped(p.dbPath);
  const source = snapshot(p.dbPath),
    backup = snapshot(p.backupPath);
  if (source.fingerprint !== backup.fingerprint)
    fail('Independent stopped backup differs from active source');
  const managed = MANAGED.map((name) => {
    const path = join(p.root, name);
    if (existsSync(path)) directory(path);
    for (const skill of source.skillWorkspaces)
      if (skill === path || skill.startsWith(path + sep))
        fail('Managed cache overlaps retained Skill workspace');
    return { name, path, ...inventory(path) };
  });
  return {
    format: FORMAT,
    governanceCommit: '1acb425',
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...p,
    source,
    managed,
    preserved: preserved(p, source.skillWorkspaces),
    keepKinds: KEEP,
    keepPrefix: 'skill-',
    restoreRule:
      'Refuse if the active cleared database or any managed directory has new data; never overwrite new work',
  };
}
function save(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
function journal(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  save(temporary, value);
  renameSync(temporary, path);
}
function matchingFiles(rows) {
  return rows.every(
    (row) =>
      json(inventory(row.path)) ===
      json({ exists: row.exists, sha256: row.sha256, entries: row.entries, bytes: row.bytes }),
  );
}
function loadPlan(opt) {
  const bytes = readFileSync(regular(opt.plan));
  if (!/^[a-f0-9]{64}$/.test(opt.expect ?? '') || sha(bytes) !== opt.expect)
    fail('Exact preview SHA-256 confirmation required');
  const plan = JSON.parse(bytes);
  const p = paths(opt);
  if (
    plan.format !== FORMAT ||
    ['root', 'dbPath', 'backupPath', 'archive', 'markerSha256'].some((k) => plan[k] !== p[k])
  )
    fail('Plan belongs to another source, marker, backup or archive');
  if (snapshot(p.backupPath).fingerprint !== plan.source.fingerprint)
    fail('Backup changed since preview');
  stopped(p.dbPath);
  return plan;
}
function audit(plan) {
  const active = snapshot(plan.dbPath),
    recordPath = join(plan.archive, 'journal.json');
  const state =
    active.fingerprint === plan.source.fingerprint
      ? 'original'
      : active.fingerprint === plan.source.retainedFingerprint
        ? 'cleared'
        : 'changed';
  const record = existsSync(recordPath)
    ? JSON.parse(readFileSync(regular(recordPath), 'utf8'))
    : null;
  if (state === 'changed')
    fail('Active database differs from both original and exact cleared manifests');
  let archivedOriginal = null;
  if (record) {
    const path = existsSync(join(plan.archive, 'database', 'flowark.sqlite'))
      ? join(plan.archive, 'database', 'flowark.sqlite')
      : join(plan.archive, 'source-snapshot.sqlite');
    archivedOriginal = snapshot(path);
    if (
      archivedOriginal.fingerprint !== plan.source.fingerprint ||
      snapshot(join(plan.archive, 'source-snapshot.sqlite')).fingerprint !== plan.source.fingerprint
    )
      fail('Archived original database/unknown records differ from preview');
  }
  return {
    state,
    journal: record?.state ?? null,
    oldActionsAndUnknownRetained: !!archivedOriginal,
    archivedUnknownCounts: archivedOriginal?.unknownCounts ?? null,
    documents: active.documentCount,
    events: active.eventCount,
    retainedPayloadsMatch:
      state === 'original' || active.fingerprint === plan.source.retainedFingerprint,
    userVersion: active.userVersion,
    schemaPreserved: active.schemaSha256 === plan.source.schemaSha256,
    preservedFilesMatch: matchingFiles(plan.preserved),
  };
}
function apply(plan, opt) {
  if (existsSync(plan.archive))
    fail('Archive already exists; audit or restore it instead of applying again');
  if (
    snapshot(plan.dbPath).fingerprint !== plan.source.fingerprint ||
    !matchingFiles(plan.managed) ||
    !matchingFiles(plan.preserved)
  )
    fail('Source or files changed after preview; no changes applied');
  mkdirSync(plan.archive, { mode: 0o700 });
  mkdirSync(join(plan.archive, 'database'));
  mkdirSync(join(plan.archive, 'managed'));
  copyFileSync(opt.plan, join(plan.archive, 'plan.json'));
  copyFileSync(plan.backupPath, join(plan.archive, 'source-snapshot.sqlite'));
  const stage = join(dirname(plan.dbPath), '.flowark-archive-stage-' + plan.id + '.sqlite'),
    record = { format: FORMAT, state: 'staging', planSha256: opt.expect, stage, moves: [] };
  const recordPath = join(plan.archive, 'journal.json');
  journal(recordPath, record);
  if (existsSync(stage)) fail('Staging file unexpectedly exists');
  copyFileSync(plan.backupPath, stage);
  const db = new DatabaseSync(stage);
  try {
    db.exec('PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE');
    db.prepare(
      "DELETE FROM documents WHERE kind NOT IN (?,?,?,?) AND substr(kind,1,6)!='skill-'",
    ).run(...KEEP);
    db.exec('DELETE FROM events; COMMIT; VACUUM');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {}
    throw error;
  } finally {
    db.close();
  }
  if (snapshot(stage).fingerprint !== plan.source.retainedFingerprint)
    fail('Staging database does not exactly preserve retained payloads and schema');
  stopped(plan.dbPath);
  if (
    snapshot(plan.dbPath).fingerprint !== plan.source.fingerprint ||
    !matchingFiles(plan.managed) ||
    !matchingFiles(plan.preserved) ||
    sha(readFileSync(plan.markerPath)) !== plan.markerSha256
  )
    fail('Source drift before archive switch; original remains active');
  const move = (from, to) => {
    renameSync(from, to);
    record.moves.push({ from, to });
    journal(recordPath, record);
  };
  try {
    record.state = 'switching';
    journal(recordPath, record);
    for (const row of plan.managed)
      if (row.exists) move(row.path, join(plan.archive, 'managed', row.name));
    for (const suffix of ['-wal', '-shm', ''])
      if (existsSync(plan.dbPath + suffix))
        move(plan.dbPath + suffix, join(plan.archive, 'database', 'flowark.sqlite' + suffix));
    move(stage, plan.dbPath);
    if (
      snapshot(plan.dbPath).fingerprint !== plan.source.retainedFingerprint ||
      !matchingFiles(plan.preserved)
    )
      fail('Post-switch verification failed; archive retained for explicit recovery');
    record.state = 'applied';
    journal(recordPath, record);
  } catch (error) {
    record.state = 'interrupted';
    record.error = String(error.message);
    journal(recordPath, record);
    throw error;
  }
  return {
    completed: 'apply',
    archive: plan.archive,
    ...audit(plan),
    credentialsAndProfilesUntouched: true,
  };
}
function restore(plan) {
  const recordPath = join(plan.archive, 'journal.json'),
    record = JSON.parse(readFileSync(regular(recordPath), 'utf8'));
  if (
    record.state !== 'applied' ||
    snapshot(plan.dbPath).fingerprint !== plan.source.retainedFingerprint
  )
    fail('Restore requires an exact unchanged cleared workspace; never overwrite new work');
  for (const row of plan.managed) {
    if (existsSync(row.path))
      fail('A managed directory was recreated; refuse to overwrite new data');
    if (
      row.exists &&
      json(inventory(join(plan.archive, 'managed', row.name))) !==
        json({ exists: row.exists, sha256: row.sha256, entries: row.entries, bytes: row.bytes })
    )
      fail('Archived managed data changed');
  }
  if (
    snapshot(join(plan.archive, 'database', 'flowark.sqlite')).fingerprint !==
    plan.source.fingerprint
  )
    fail('Archived original database changed');
  stopped(plan.dbPath);
  mkdirSync(join(plan.archive, 'cleared-state'), { mode: 0o700 });
  record.state = 'restoring';
  journal(recordPath, record);
  for (const suffix of ['-wal', '-shm', ''])
    if (existsSync(plan.dbPath + suffix))
      renameSync(
        plan.dbPath + suffix,
        join(plan.archive, 'cleared-state', 'flowark.sqlite' + suffix),
      );
  for (const suffix of ['-wal', '-shm', '']) {
    const from = join(plan.archive, 'database', 'flowark.sqlite' + suffix);
    if (existsSync(from)) renameSync(from, plan.dbPath + suffix);
  }
  for (const row of plan.managed)
    if (row.exists) renameSync(join(plan.archive, 'managed', row.name), row.path);
  if (snapshot(plan.dbPath).fingerprint !== plan.source.fingerprint || !matchingFiles(plan.managed))
    fail('Restore verification failed; retain all archives and stop');
  record.state = 'restored';
  journal(recordPath, record);
  return { completed: 'restore', ...audit(plan), archiveRetained: true };
}
function options(argv) {
  const [action, ...rest] = argv;
  if (!['preview', 'apply', 'audit', 'restore'].includes(action))
    fail(
      'Use preview|apply|audit|restore --data DIR --database ACTIVE_DB --backup STOPPED_SQLITE --archive NEW_ARCHIVE_DIR --plan FILE --stopped [--expect SHA256]',
    );
  const out = { action };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--stopped') {
      out.stopped = true;
      continue;
    }
    const key = flag.slice(2);
    if (
      !flag.startsWith('--') ||
      !['data', 'database', 'backup', 'archive', 'plan', 'expect'].includes(key) ||
      out[key] !== undefined ||
      !rest[i + 1]
    )
      fail('Invalid option');
    out[key] = rest[++i];
  }
  if (
    !out.stopped ||
    !['data', 'database', 'backup', 'archive', 'plan'].every((k) => typeof out[k] === 'string')
  )
    fail('Explicit paths and --stopped are required');
  return out;
}
try {
  const opt = options(process.argv.slice(2));
  let result;
  if (opt.action === 'preview') {
    if (existsSync(opt.plan) || existsSync(opt.archive)) fail('Preview plan/archive must be new');
    const plan = inspect(opt);
    save(opt.plan, plan);
    result = {
      plan: resolve(opt.plan),
      sha256: sha(readFileSync(opt.plan)),
      database: plan.dbPath,
      retained: plan.source.retainedCount,
      archived: plan.source.documentCount - plan.source.retainedCount,
      archivedEvents: plan.source.eventCount,
      counts: plan.source.counts,
      managed: plan.managed,
      keptUserDataRoots: plan.preserved.map((x) => x.path),
      userVersion: plan.source.userVersion,
      liveChangesApplied: false,
    };
  } else {
    const plan = loadPlan(opt);
    result =
      opt.action === 'apply'
        ? apply(plan, opt)
        : opt.action === 'restore'
          ? restore(plan)
          : audit(plan);
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
