import { realpath, stat, writeFile, readFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, relative, dirname, join, basename, sep } from 'node:path';
import ExcelJS from 'exceljs';
import type { Bindings } from '../shared/types';
export async function scopedPath(root: string, name: string, writing = false) {
  if (!root) throw new Error('文件目录尚未绑定');
  const base = await realpath(root);
  const target = resolve(base, name);
  if (relative(base, target).startsWith('..') || target === base)
    throw new Error('文件必须位于已绑定目录内');
  const actual = await realpath(target).catch(async () =>
    writing
      ? join(await realpath(dirname(target)), basename(target))
      : Promise.reject(new Error('文件不存在')),
  );
  if (actual !== base && !actual.startsWith(base + sep))
    throw new Error('符号链接超出文件授权目录');
  return actual;
}
export async function fileOperation(
  n: any,
  bindings: Bindings,
  artifact: (path: string) => Promise<any>,
) {
  const path = await scopedPath(bindings.files[n.binding], String(n.name), n.operation !== 'read');
  if (n.type === 'excel') {
    const workbook = new ExcelJS.Workbook();
    if (n.operation === 'read') {
      await workbook.xlsx.readFile(path);
      const sheet = workbook.worksheets[0];
      const rows: any[] = [];
      sheet?.eachRow((r) => rows.push((r.values as any[]).slice(1)));
      return rows;
    }
    if (!Array.isArray(n.rows)) throw new Error('Excel rows 必须为数组');
    workbook.addWorksheet('Sheet1').addRows(n.rows);
    await workbook.xlsx.writeFile(path);
    return artifact(path);
  }
  if (n.operation === 'read') {
    if ((await stat(path)).size > 10 * 1024 * 1024) throw new Error('文本文件超过 10 MiB');
    return readFile(path, 'utf8');
  }
  if (n.operation === 'write')
    await writeFile(path, typeof n.content === 'string' ? n.content : JSON.stringify(n.content), {
      mode: 0o600,
    });
  else if (n.operation === 'copy')
    await copyFile(await scopedPath(bindings.files[n.binding], String(n.content)), path);
  else throw new Error('文件操作不支持');
  return artifact(path);
}
export async function artifactPath(root: string, runId: string, name: string) {
  if (!/^[\w.-]{1,150}$/.test(name) || name === '..') throw new Error('产物名称无效');
  const dir = join(root, 'artifacts', runId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return join(dir, name);
}
