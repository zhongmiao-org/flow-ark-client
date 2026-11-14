// Explicit offline full profile reset. Never imported by startup or migration.
import { lstat, readdir, readFile, mkdir, cp, rename, writeFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const hash = (v) => createHash('sha256').update(v).digest('hex');
const root = join(homedir(), 'Library/Application Support/flow-ark-client');
const fail = (message) => {
  throw Error(message);
};
async function stopped() {
  const processes = execFileSync('/bin/ps', ['-axo', 'pid=,comm='], { encoding: 'utf8' });
  if (processes.split('\n').some((p) => /\/FlowArk\.app\/Contents\//.test(p)))
    fail('Quit FlowArk and all owned processes first');
  try {
    const opened = execFileSync('/usr/sbin/lsof', ['-t', '+D', root], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (opened.trim()) fail('Profile has open files; stop owned runtimes first');
  } catch (e) {
    if (e.status !== 1) throw e;
  }
}
async function inventory(directory) {
  const rows = [];
  const walk = async (p, relative) => {
    const stat = await lstat(p);
    if (stat.isSymbolicLink()) {
      // Only Chromium transient locks may link outside the profile. Never follow them.
      if (!/^Singleton(?:Cookie|Lock|Socket)$/.test(relative))
        fail('Unexpected symlink: ' + relative);
      return;
    }
    if (stat.isSocket()) return;
    if (stat.isDirectory()) {
      rows.push([relative, 'directory']);
      for (const name of (await readdir(p)).sort())
        await walk(join(p, name), relative ? relative + '/' + name : name);
    } else if (stat.isFile()) rows.push([relative, stat.size, hash(await readFile(p))]);
    else fail('Unsupported profile entry: ' + relative);
  };
  await walk(directory, '');
  return {
    sha256: hash(JSON.stringify(rows)),
    files: rows.filter((r) => r.length === 3).length,
    bytes: rows.reduce((n, r) => n + (typeof r[1] === 'number' ? r[1] : 0), 0),
  };
}
async function validRoot() {
  if (process.platform !== 'darwin') fail('This explicit maintenance supports macOS only');
  const st = await lstat(root);
  if (!st.isDirectory() || st.isSymbolicLink() || (await realpath(root)) !== root)
    fail('Profile must be the exact real FlowArk directory');
}
async function integrity(directory) {
  const dbs = [];
  const walk = async (p) => {
    for (const name of await readdir(p)) {
      const file = join(p, name),
        st = await lstat(file);
      if (st.isDirectory()) await walk(file);
      else if (name === 'flowark.sqlite' && st.isFile()) dbs.push(file);
    }
  };
  await walk(directory);
  if (!dbs.length) fail('No FlowArk database found');
  for (const file of dbs) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok')
        fail('Backup database integrity failed');
    } finally {
      db.close();
    }
  }
  return dbs.length;
}
const [action, backupArg, expected] = process.argv.slice(2);
if (!['preview', 'apply', 'restore'].includes(action))
  fail(
    'Usage: node scripts/maintenance/reset-flowark-profile.mjs preview | apply <new-backup-dir> <preview-sha256> | restore <backup-dir>',
  );
await validRoot();
await stopped();
if (action === 'preview') {
  if (!(await lstat(join(root, 'flowark.sqlite'))).isFile())
    fail('Not an existing FlowArk profile');
  console.log(
    JSON.stringify(
      {
        root,
        ...(await inventory(root)),
        includes:
          'FlowArk business, credentials, Skill and browser session; external files excluded',
      },
      null,
      2,
    ),
  );
} else {
  if (!backupArg) fail('An explicit private backup directory is required');
  const backup = resolve(backupArg);
  if (backup === root || backup.startsWith(root + '/') || root.startsWith(backup + '/'))
    fail('Backup must be outside profile');
  if ((await realpath(resolve(backup, '..'))) !== resolve(backup, '..'))
    fail('Backup parent must not traverse symlinks');
  if (action === 'apply') {
    const before = await inventory(root);
    if (before.sha256 !== expected) fail('Preview drift: inspect a new preview first');
    await mkdir(backup, { mode: 0o700 }); // Must be new; never overwrite a backup.
    const copy = join(backup, 'verified-copy');
    await cp(root, copy, {
      recursive: true,
      dereference: false,
      preserveTimestamps: true,
      filter: async (p) => {
        const s = await lstat(p);
        return !s.isSocket() && !s.isSymbolicLink();
      },
    });
    const copied = await inventory(copy);
    if (before.sha256 !== copied.sha256) fail('Backup differs; active profile unchanged');
    const databases = await integrity(copy);
    // SQLite may create sidecars during read-only integrity checks. Recheck the untouched source.
    if ((await inventory(root)).sha256 !== before.sha256) fail('Profile changed during backup');
    await stopped();
    await writeFile(
      join(backup, 'manifest.json'),
      JSON.stringify(
        {
          format: 'flowark-full-profile-reset-v1',
          root,
          createdAt: new Date().toISOString(),
          before,
          databases,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await rename(root, join(backup, 'original-profile'));
    try {
      await mkdir(root, { mode: 0o700 });
    } catch (e) {
      await rename(join(backup, 'original-profile'), root);
      throw e;
    }
    console.log(
      JSON.stringify(
        {
          completed: true,
          root,
          backup,
          ...before,
          databases,
          activeEntries: (await readdir(root)).length,
        },
        null,
        2,
      ),
    );
  } else {
    const backupStat = await lstat(backup);
    if (
      !backupStat.isDirectory() ||
      backupStat.isSymbolicLink() ||
      (await realpath(backup)) !== backup
    )
      fail('Restore backup must be the exact real directory');
    const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8'));
    if (manifest.format !== 'flowark-full-profile-reset-v1' || manifest.root !== root)
      fail('Wrong reset manifest');
    const original = join(backup, 'original-profile');
    const originalStat = await lstat(original);
    if (
      !originalStat.isDirectory() ||
      originalStat.isSymbolicLink() ||
      (await realpath(original)) !== original
    )
      fail('Original archive must not traverse symlinks');
    if ((await inventory(original)).sha256 !== manifest.before.sha256)
      fail('Original archive drift');
    // Never overwrite any work done since reset.
    if ((await readdir(root)).length)
      fail('Active profile is not empty; preserve it before restoring');
    await rename(root, join(backup, 'empty-profile'));
    try {
      await rename(original, root);
    } catch (e) {
      await rename(join(backup, 'empty-profile'), root);
      throw e;
    }
    console.log(JSON.stringify({ restored: true, root, sha256: manifest.before.sha256 }, null, 2));
  }
}
