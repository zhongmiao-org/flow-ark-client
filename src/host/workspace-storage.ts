import { DatabaseSync, backup } from 'node:sqlite';
import { createDecipheriv, createHash, randomUUID } from 'node:crypto';
import { mkdir, chmod, readFile, writeFile, link, rm, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const PREFIX = 'workspace-json-v1:';
const FORMAT = 'workspace-json-v1' as const;
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => JSON.stringify(value);
type Counts = { documents: number; events: number };
export type WorkspaceStorageReview = {
  version: 1;
  format: typeof FORMAT;
  candidateId: string;
  sourceFingerprint: string;
  candidateFingerprint: string;
  plaintextFingerprint: string;
  counts: Counts;
  payloadBytes: number;
  stamp: string;
};
const sensitiveFields =
  /^(accessToken|refreshToken|clientSecret|bearerToken|apiKey|password|passwd|privateKey|secret)$/i;
function inspectValue(value: unknown, table: string, rowId: number, path = '$'): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((child, i) => inspectValue(child, table, rowId, path + '[' + i + ']'));
    return;
  }
  const item = value as Record<string, unknown>;
  if (item.kind === 'mcp-oauth-v1' || item.kind === 'flowark-local-credential')
    throw Error(
      `工作区迁移发现凭据对象，未生成普通副本：${table}/${sha(String(rowId)).slice(0, 12)}`,
    );
  for (const [key, child] of Object.entries(item)) {
    if (sensitiveFields.test(key) && child !== null && child !== undefined && child !== '')
      throw Error(
        `工作区迁移发现需保留保护的字段，未生成普通副本：${table}/${sha(String(rowId)).slice(0, 12)} ${path}.${key}`,
      );
    inspectValue(child, table, rowId, path + '.' + key);
  }
}
function checkDatabase(db: DatabaseSync) {
  if ((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version !== 2)
    throw Error('工作区格式不支持，未迁移');
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((r) => r.name);
  if (json(tables) !== json(['documents', 'events'])) throw Error('工作区表集合变化，未猜测迁移');
  for (const [table, columns] of [
    [
      'documents',
      [
        ['kind', 'TEXT', 1],
        ['id', 'TEXT', 2],
        ['payload', 'TEXT', 0],
      ],
    ],
    [
      'events',
      [
        ['run_id', 'TEXT', 1],
        ['seq', 'INTEGER', 2],
        ['payload', 'TEXT', 0],
      ],
    ],
  ] as const) {
    const actual = db
      .prepare(`PRAGMA table_xinfo(${table})`)
      .all()
      .map((row) => [row.name, row.type, row.pk, row.notnull, row.hidden, row.dflt_value]);
    const expected = columns.map(([name, type, primary]) => [name, type, primary, 1, 0, null]);
    if (json(actual) !== json(expected)) throw Error('工作区表结构变化，未读取或重建');
  }
}
function fingerprint(db: DatabaseSync): string {
  checkDatabase(db);
  const hash = createHash('sha256');
  for (const table of ['documents', 'events'] as const) {
    hash.update(table + '\n');
    const order = table === 'documents' ? 'kind,id' : 'run_id,seq';
    for (const row of db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).iterate())
      hash.update(json(row) + '\n');
  }
  return hash.digest('hex');
}
async function readRegular(path: string) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536)
    throw Error('工作区清单必须为有限普通本地文件');
  return readFile(path, 'utf8');
}
function candidateDirectory(dataPath: string, candidateId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(candidateId))
    throw Error('迁移候选身份无效');
  return join(resolve(dataPath), 'workspace-public', candidateId);
}
async function checkCandidateDirectory(dataPath: string, dir: string) {
  for (const path of [join(resolve(dataPath), 'workspace-public'), dir]) {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error('普通工作区候选目录不允许符号链接');
  }
}
function reviewStamp(review: Omit<WorkspaceStorageReview, 'stamp'>) {
  return sha(json(review));
}
/** Preparation is explicit, requires the already-unlocked key, and never activates a candidate. */
export async function prepareWorkspaceStorage(
  dataPath: string,
  key: Buffer,
): Promise<WorkspaceStorageReview> {
  if (key.length !== 32) throw Error('原工作区密钥不可用，保留原文件');
  const sourcePath = join(resolve(dataPath), 'flowark.sqlite');
  const sourceStat = await lstat(sourcePath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink())
    throw Error('原加密工作区必须为普通本地文件');
  const candidateId = randomUUID(),
    dir = candidateDirectory(dataPath, candidateId),
    destination = join(dir, 'flowark.sqlite');
  const parent = join(resolve(dataPath), 'workspace-public');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const parentStat = await lstat(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink())
    throw Error('普通工作区目录不允许符号链接');
  await mkdir(dir, { mode: 0o700 });
  await chmod(dir, 0o700);
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  let target: DatabaseSync | undefined;
  try {
    source.exec('BEGIN');
    const sourceFingerprint = fingerprint(source);
    await backup(source, destination);
    await chmod(destination, 0o600);
    target = new DatabaseSync(destination);
    checkDatabase(target);
    if (fingerprint(target) !== sourceFingerprint) throw Error('加密副本与固定来源不一致，未启用');
    const counts: Counts = { documents: 0, events: 0 };
    let payloadBytes = 0;
    const expectedPlain = createHash('sha256');
    target.exec('BEGIN IMMEDIATE');
    try {
      for (const table of ['documents', 'events'] as const) {
        const update = target.prepare(`UPDATE ${table} SET payload=? WHERE rowid=?`);
        for (const row of target
          .prepare(`SELECT rowid AS migration_rowid,payload FROM ${table} ORDER BY rowid`)
          .iterate()) {
          const rowId = Number(row.migration_rowid),
            encrypted = Buffer.from(String(row.payload), 'base64');
          if (encrypted.length < 28) throw Error('原加密行损坏，未迁移');
          const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(0, 12));
          decipher.setAuthTag(encrypted.subarray(-16));
          const plain = Buffer.concat([
            decipher.update(encrypted.subarray(12, -16)),
            decipher.final(),
          ]);
          let value: unknown;
          try {
            value = JSON.parse(plain.toString('utf8'));
            inspectValue(value, table, rowId);
          } finally {
            plain.fill(0);
          }
          const payload = PREFIX + json(value);
          expectedPlain.update(table + '\0' + rowId + '\0' + payload + '\n');
          update.run(payload, rowId);
          payloadBytes += Buffer.byteLength(payload);
          counts[table]++;
        }
      }
      target.exec('COMMIT');
    } catch (error) {
      target.exec('ROLLBACK');
      throw error;
    }
    // Compare persisted values with every authenticated source row, not only JSON shape.
    const actualPlain = createHash('sha256');
    for (const table of ['documents', 'events'] as const) {
      let count = 0;
      for (const row of target
        .prepare(`SELECT rowid AS migration_rowid,payload FROM ${table} ORDER BY rowid`)
        .iterate()) {
        const payload = String(row.payload);
        if (!payload.startsWith(PREFIX)) throw Error('普通副本封套校验失败');
        JSON.parse(payload.slice(PREFIX.length));
        actualPlain.update(table + '\0' + Number(row.migration_rowid) + '\0' + payload + '\n');
        count++;
      }
      if (count !== counts[table]) throw Error('普通副本行数校验失败');
    }
    const plaintextFingerprint = expectedPlain.digest('hex');
    if (actualPlain.digest('hex') !== plaintextFingerprint) throw Error('普通副本逐行内容校验失败');
    const body: Omit<WorkspaceStorageReview, 'stamp'> = {
      version: 1,
      format: FORMAT,
      candidateId,
      sourceFingerprint,
      candidateFingerprint: fingerprint(target),
      plaintextFingerprint,
      counts,
      payloadBytes,
    };
    const review = { ...body, stamp: reviewStamp(body) };
    await writeFile(join(dir, 'review.json'), JSON.stringify(review, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    return review;
  } catch (error) {
    target?.close();
    target = undefined;
    await rm(dir, { recursive: true, force: true });
    throw error;
  } finally {
    target?.close();
    try {
      source.exec('ROLLBACK');
    } finally {
      source.close();
    }
  }
}
/** Caller must stop the host before activation; this does not run or restart anything. */
export async function activateWorkspaceStorage(
  dataPath: string,
  expected: WorkspaceStorageReview,
  assertHostStopped: () => void,
) {
  assertHostStopped();
  const root = resolve(dataPath),
    dir = candidateDirectory(root, expected.candidateId);
  await checkCandidateDirectory(root, dir);
  const actual = JSON.parse(await readRegular(join(dir, 'review.json'))) as WorkspaceStorageReview;
  if (json(actual) !== json(expected)) throw Error('迁移核对内容变化，未启用');
  const { stamp, ...body } = actual;
  if (reviewStamp(body) !== stamp || actual.format !== FORMAT || actual.version !== 1)
    throw Error('迁移清单摘要无效');
  const source = new DatabaseSync(join(root, 'flowark.sqlite'), { readOnly: true }),
    target = new DatabaseSync(join(dir, 'flowark.sqlite'), { readOnly: true });
  try {
    if (
      fingerprint(source) !== actual.sourceFingerprint ||
      fingerprint(target) !== actual.candidateFingerprint
    )
      throw Error('核对后工作区变化，原工作区保持');
  } finally {
    source.close();
    target.close();
  }
  assertHostStopped();
  const marker = join(root, 'workspace-storage.json'),
    temporary = marker + '.' + randomUUID() + '.tmp';
  // Never silently replace an already-active storage policy.
  try {
    await lstat(marker);
    throw Error('工作区已存在存储策略，未替换');
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await writeFile(temporary, JSON.stringify(actual, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await link(temporary, marker);
  } finally {
    await rm(temporary, { force: true });
  }
  return {
    format: FORMAT,
    path: join(dir, 'flowark.sqlite'),
    sourceRetained: true,
    credentialsUntouched: true,
  };
}
/** Only an explicitly activated policy authorizes ordinary startup without the Vault. */
export async function workspaceStorage(
  dataPath: string,
): Promise<{ format: typeof FORMAT; path: string } | null> {
  const root = resolve(dataPath);
  let raw: string;
  try {
    raw = await readRegular(join(root, 'workspace-storage.json'));
  } catch (error: any) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const policy = JSON.parse(raw) as WorkspaceStorageReview;
  const { stamp, ...body } = policy;
  if (policy.version !== 1 || policy.format !== FORMAT || reviewStamp(body) !== stamp)
    throw Error('工作区存储策略无效，不回退空数据库');
  const dir = candidateDirectory(root, policy.candidateId);
  await checkCandidateDirectory(root, dir);
  const path = join(dir, 'flowark.sqlite');
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('普通工作区副本缺失，不重建');
  // Read-only validation must precede Store initialization: a missing/replaced
  // policy target is never permission to initialize a new empty workspace.
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    checkDatabase(database);
  } finally {
    database.close();
  }
  return { format: FORMAT, path };
}
