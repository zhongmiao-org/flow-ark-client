import {
  mkdirSync,
  mkdtempSync,
  lstatSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  constants,
  openSync,
  closeSync,
  fstatSync,
  ftruncateSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const debugConfigPath =
  process.env.FLOWARK_DEBUG_CONFIG || join(homedir(), 'Documents', 'FlowArk', '调试文件位置.json');
export const defaultDebugRoot = join(homedir(), 'Documents', 'FlowArk', '调试文件');
export function checkedDirectory(path, create = false) {
  path = resolve(path);
  if (create) mkdirSync(path, { recursive: true, mode: 0o700 });
  const s = lstatSync(path);
  if (!s.isDirectory() || s.isSymbolicLink() || realpathSync(path) !== path)
    throw new Error('目录包含符号链接或已变化，请选择真实目录');
  return path;
}
export function debugLocations() {
  try {
    if (lstatSync(debugConfigPath).isSymbolicLink()) throw new Error('调试位置配置不能是链接');
    const v = JSON.parse(readFileSync(debugConfigPath, 'utf8'));
    if (
      v.version !== 1 ||
      !Array.isArray(v.roots) ||
      !v.roots.every((p) => typeof p === 'string') ||
      typeof v.current !== 'string'
    )
      throw new Error('调试位置配置无效');
    return v;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { version: 1, current: defaultDebugRoot, roots: [defaultDebugRoot] };
  }
}
export function setDebugLocation(path) {
  const current = checkedDirectory(path, true);
  const old = debugLocations();
  const next = { version: 1, current, roots: [...new Set([...old.roots, current])] };
  checkedDirectory(dirname(debugConfigPath), true);
  const temporary = debugConfigPath + '.' + randomUUID();
  writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600, flag: 'wx' });
  renameSync(temporary, debugConfigPath);
  return next;
}
export function debugRoot() {
  const root = process.env.FLOWARK_DEBUG_ROOT || debugLocations().current;
  return checkedDirectory(root, true);
}
export function debugMkdtempSync(prefix, options = {}) {
  const path = mkdtempSync(
    join(debugRoot(), basename(String(prefix)).replace(/[^\w.-]/g, '-') || 'flowark-debug-'),
  );
  const info = lstatSync(path, { bigint: true });
  const record = {
    version: 1,
    id: randomUUID(),
    path,
    identity: `${info.dev}:${info.ino}`,
    ownerPid: process.pid,
    purpose: options.purpose || `开发验证：${basename(process.argv[1] || 'FlowArk')}`,
    category: options.category || 'test-copy',
    retained: options.retained !== false,
    status: 'active',
    startedAt: new Date().toISOString(),
  };
  const file = join(path, '.flowark-debug.json');
  writeFileSync(file, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
  const metadata = lstatSync(file, { bigint: true });
  process.once('exit', (code) => {
    let fd;
    try {
      if (
        `${lstatSync(path, { bigint: true }).dev}:${lstatSync(path, { bigint: true }).ino}` !==
          record.identity ||
        realpathSync(path) !== path
      )
        return;
      fd = openSync(file, constants.O_RDWR | constants.O_NOFOLLOW);
      const current = fstatSync(fd, { bigint: true });
      if (
        current.dev !== metadata.dev ||
        current.ino !== metadata.ino ||
        JSON.parse(readFileSync(fd, 'utf8')).id !== record.id
      )
        return;
      if (!record.retained && code === 0) rmSync(path, { recursive: true, force: true });
      else {
        const value = JSON.stringify({
          ...record,
          status: code === 0 ? 'completed' : 'failed',
          finishedAt: new Date().toISOString(),
        });
        ftruncateSync(fd, 0);
        writeSync(fd, value, 0, 'utf8');
      }
    } catch {
      /* Removed by the owning launcher, or deliberately left for the next explicit scan. */
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  });
  return path;
}
export async function debugMkdtemp(prefix, options) {
  return debugMkdtempSync(prefix, options);
}
let evidence;
export function debugEvidenceRoot() {
  return (evidence ??= debugMkdtempSync('flowark-evidence-', {
    purpose: `验证截图与结果：${basename(process.argv[1] || 'FlowArk')}`,
    category: 'temporary',
  }));
}
