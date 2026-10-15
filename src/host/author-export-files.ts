import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { workspace, type Workspace } from './skill-files';
import { canonical } from '../shared/utils';
import { sha256 } from '../../contracts/package-format';
export type ExportTarget = {
  directory: Workspace;
  path: string;
  file?: { dev: number; ino: number };
};
async function parent(target: ExportTarget) {
  if (canonical(await workspace(target.directory.path)) !== canonical(target.directory))
    throw Error('导出目录身份已变化');
}
export async function exportTarget(path: string): Promise<ExportTarget> {
  if (
    !isAbsolute(path) ||
    path.includes('\0') ||
    path.length > 4096 ||
    !path.toLowerCase().endsWith('.zip')
  )
    throw Error('请重新选择ZIP保存位置');
  const directory = await workspace(dirname(path));
  const target = { directory, path: join(directory.path, basename(path)) };
  try {
    await lstat(target.path);
  } catch (e: any) {
    if (e.code === 'ENOENT') return target;
    throw e;
  }
  throw Error('导出目标已存在，请选择新文件名；不会覆盖');
}
export async function readExport(target: ExportTarget, bytes: number, expected: string) {
  await parent(target);
  let handle;
  try {
    handle = await open(
      target.path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (e: any) {
    if (e.code === 'ENOENT') return { complete: false, reason: '原导出文件不存在，未自动重写' };
    throw Error('原导出文件暂不可核对，请恢复访问后继续');
  }
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      (target.file && (before.dev !== target.file.dev || before.ino !== target.file.ino))
    )
      throw Error('原导出文件身份已变化，不能登记成功');
    if (before.size !== bytes || before.size > 20 * 1048576)
      return { complete: false, reason: '原导出文件不完整或大小已变化，现场保留' };
    const value = await handle.readFile();
    const after = await handle.stat(),
      named = await lstat(target.path);
    if (
      !named.isFile() ||
      named.isSymbolicLink() ||
      named.dev !== before.dev ||
      named.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw Error('核对期间文件已变化');
    await parent(target);
    return sha256(value) === expected
      ? { complete: true }
      : { complete: false, reason: '原导出文件摘要不一致，现场保留' };
  } finally {
    await handle.close();
  }
}
export async function writeExport(
  target: ExportTarget,
  bytes: Buffer,
  active: () => void,
  opened: (file: { dev: number; ino: number }) => void,
) {
  active();
  await parent(target);
  active();
  const handle = await open(
    target.path,
    constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const s = await handle.stat();
    if (!s.isFile()) throw Error('导出目标不是普通文件');
    target.file = { dev: s.dev, ino: s.ino };
    opened(target.file);
    active();
    await handle.writeFile(bytes);
    await handle.sync();
    active();
    const after = await handle.stat(),
      named = await lstat(target.path);
    if (
      after.size !== bytes.length ||
      !named.isFile() ||
      named.isSymbolicLink() ||
      named.ino !== s.ino ||
      named.dev !== s.dev
    )
      throw Error('导出文件身份或大小已变化');
  } finally {
    await handle.close();
  }
  const dir = await open(target.directory.path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
  active();
  const result = await readExport(target, bytes.length, sha256(bytes));
  active();
  if (!result.complete) throw Error(result.reason);
}
