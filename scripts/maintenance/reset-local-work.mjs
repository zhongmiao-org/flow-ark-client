import { DatabaseSync } from 'node:sqlite';
import { lstat, realpath, readdir, rename, rm, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
/** Explicit one-time maintenance. Never imported by application startup/migration. */
export async function resetLocalWork(directory, { apply = false, assertStopped } = {}) {
  const root = await realpath(directory);
  if (root === resolve('/')) throw new Error('Invalid application data directory');
  const dbPath = join(root, 'flowark.sqlite');
  if (!(await lstat(dbPath)).isFile()) throw new Error('Database must be a regular file');
  if (!assertStopped)
    throw new Error('Caller must verify application and owned processes are stopped');
  await assertStopped(dbPath);
  const managed = ['artifacts', 'compiled', 'template-packages'];
  for (const name of managed) {
    try {
      if ((await lstat(join(root, name))).isSymbolicLink())
        throw new Error('Managed root must not be a symlink: ' + name);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  const db = new DatabaseSync(dbPath, { readOnly: !apply });
  const keep = ['browser', 'settings', 'setting', 'ai-validation'];
  const counts = db.prepare('SELECT kind,count(*) AS count FROM documents GROUP BY kind').all();
  const report = {
    directory: root,
    apply,
    retained: counts.filter((r) => keep.includes(r.kind)),
    removed: counts.filter((r) => !keep.includes(r.kind)),
    eventCount: db.prepare('SELECT count(*) AS n FROM events').get().n,
    managed,
  };
  if (!apply) {
    db.close();
    return report;
  }
  const quarantine = join(root, '.work-reset-' + randomUUID());
  const moved = [];
  await mkdir(quarantine, { mode: 0o700 });
  try {
    for (const name of managed) {
      try {
        await rename(join(root, name), join(quarantine, name));
        moved.push(name);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM documents WHERE kind NOT IN (?,?,?,?)').run(...keep);
      db.exec('DELETE FROM events; PRAGMA user_version=2; COMMIT;');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } catch (e) {
    for (const name of moved.reverse()) await rename(join(quarantine, name), join(root, name));
    await rm(quarantine, { recursive: true, force: true });
    throw e;
  } finally {
    db.close();
  }
  await rm(quarantine, { recursive: true, force: true });
  return { ...report, completed: true };
}
if (process.argv[1]?.endsWith('/reset-local-work.mjs')) {
  const directory = process.argv[2];
  if (!directory)
    throw new Error(
      'Usage: node scripts/maintenance/reset-local-work.mjs <data-directory> [--apply --stopped]',
    );
  if (!process.argv.includes('--stopped'))
    throw new Error('Stop FlowArk and confirm with --stopped');
  const assertStopped = async (dbPath) => {
    try {
      const output = execFileSync('/usr/sbin/lsof', ['-t', dbPath], { encoding: 'utf8' });
      if (output.trim()) throw new Error('Database is open by another process');
    } catch (e) {
      if (e.status !== 1) throw e;
    }
    const processes = execFileSync('/bin/ps', ['-axo', 'pid=,command='], {
      encoding: 'utf8',
    }).split('\n');
    if (
      processes.some(
        (p) =>
          /\/FlowArk\.app\/Contents\/(MacOS|Frameworks)|flow-ark-client\/dist\/(main|host|worker|script)/.test(
            p,
          ) && !p.includes('reset-local-work.mjs'),
      )
    )
      throw new Error('FlowArk process still running');
  };
  console.log(
    JSON.stringify(
      await resetLocalWork(directory, { apply: process.argv.includes('--apply'), assertStopped }),
      null,
      2,
    ),
  );
}
