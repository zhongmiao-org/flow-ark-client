import {
  realpath,
  stat,
  writeFile,
  readFile,
  mkdir,
  copyFile,
  open,
  rename,
  rm,
  access,
  link,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, relative, dirname, join, basename, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { Bindings } from '../shared/types';
import { mappedRows, validateMappedFilename } from '../shared/excel-mapping';
import { validateCreatedName, validateCreatedText } from '../shared/file-create';
import { createText } from './create-text';
export async function scopedPath(root: string, name: string, writing = false) {
  if (!root) throw new Error('文件目录尚未绑定');
  const base = await realpath(root);
  const target = scopedTarget(base, name);
  const actual = await realpath(target).catch(async () =>
    writing
      ? join(await realpath(dirname(target)), basename(target))
      : Promise.reject(new Error('文件不存在')),
  );
  if (actual !== base && !actual.startsWith(base + sep))
    throw new Error('符号链接超出文件授权目录');
  return actual;
}
/** Lexical range check does not require a file that preceding steps may create. */
export function scopedTarget(base: string, name: string) {
  if (typeof name !== 'string' || !name || name.includes('\0'))
    throw new Error('文件名必须为非空文本');
  const target = resolve(base, name);
  const rel = relative(base, target);
  if (rel === '..' || rel.startsWith('..' + sep) || target === base)
    throw new Error('文件必须位于已绑定目录内');
  return target;
}
export async function uploadPath(root: string, name: string) {
  const path = await scopedPath(root, name);
  if (!(await stat(path)).isFile()) throw new Error('上传目标必须是普通文件');
  await access(path, constants.R_OK);
  return path;
}
async function atomicWrite(
  path: string,
  write: (temporary: string) => Promise<unknown>,
  createOnly = false,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const temporary = join(dirname(path), '.flowark-' + randomUUID() + '.tmp');
  let created = false;
  try {
    const file = await open(temporary, 'wx', 0o600);
    created = true;
    await file.close();
    signal?.throwIfAborted();
    await write(temporary);
    // Serializers may finish after cancellation. Commit only while this Run is current.
    signal?.throwIfAborted();
    if (createOnly) await link(temporary, path);
    else await rename(temporary, path);
  } catch (error) {
    throw fileWriteFailure(error);
  } finally {
    if (created)
      try {
        await rm(temporary, { force: true });
      } catch {
        throw new Error('本次临时文件未能清理，请恢复目录访问权限后核对；不要自动重跑写入');
      }
  }
}
function fileWriteFailure(error: unknown) {
  const message: Record<string, string> = {
    EACCES: '没有目标目录的写入权限，请恢复权限或重新选择目录后重新检查',
    EPERM: '系统阻止写入目标位置，请核对文件权限或占用情况后重新检查',
    EROFS: '目标位置为只读，请选择可写目录后重新检查',
    ENOSPC: '目标磁盘空间不足，请释放空间后重新检查；不会自动重试',
    EDQUOT: '目标位置存储配额不足，请处理配额后重新检查',
    EBUSY: '目标文件或目录正被占用，请关闭占用后重新检查',
    EISDIR: '目标文件名已被目录占用，请更换文件名后重新检查',
    ENOENT: '输出目录已不存在，请重新选择目录并保存后重新检查',
    ENOTDIR: '输出路径中的目录已变化，请重新选择目录并保存后重新检查',
  };
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code && message[code] ? new Error(message[code]) : error;
}
function cellAddress(address: string) {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(address.toUpperCase());
  if (!match) throw new Error('单元格地址无效：' + address);
  const column = [...match[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  if (column > 16384 || Number(match[2]) > 1048576) throw new Error('单元格超出 Excel 行列边界');
  return match[0];
}
function cellValue(value: any): ExcelJS.CellValue {
  const scalar = (v: any) =>
    v === null ||
    typeof v === 'string' ||
    typeof v === 'boolean' ||
    (typeof v === 'number' && Number.isFinite(v));
  if (scalar(value)) return value;
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.formula === 'string' &&
    value.formula.trim() &&
    Object.keys(value).every((key) => ['formula', 'result'].includes(key)) &&
    (value.result === undefined || scalar(value.result))
  )
    return value;
  throw new Error('单元格值仅支持文本、数字、布尔、空值或显式 formula/result 对象');
}
function assertRelativeName(name: unknown): asserts name is string {
  if (
    typeof name !== 'string' ||
    /[\\\x00:]/.test(name) ||
    name.split('/').some((part) => ['', '.', '..'].includes(part))
  )
    throw new Error('文件名必须是安全的相对路径');
}
async function archiveFiles(root: string, output: string, names: unknown, signal?: AbortSignal) {
  if (!Array.isArray(names) || !names.length || names.length > 200)
    throw new Error('归档需明确选择 1～200 个文件');
  const zip = new JSZip();
  const entries = new Set<string>();
  let total = 0;
  for (const name of names) {
    assertRelativeName(name);
    if (entries.has(name)) throw new Error('归档条目重复：' + name);
    entries.add(name);
    const path = await scopedPath(root, name);
    if (path === output) throw new Error('归档不能包含输出自身');
    const info = await stat(path);
    if (!info.isFile()) throw new Error('归档只接受明确的普通文件');
    if (total + info.size > 100 * 1024 * 1024) throw new Error('归档输入合计超过 100 MiB');
    const content = await readFile(path);
    total += content.byteLength;
    if (total > 100 * 1024 * 1024) throw new Error('归档输入合计超过 100 MiB');
    zip.file(name, content, { date: info.mtime, createFolders: false });
  }
  await atomicWrite(
    output,
    async (temporary) =>
      writeFile(temporary, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })),
    false,
    signal,
  );
}
export async function fileOperation(
  n: any,
  bindings: Bindings,
  artifact: (path: string) => Promise<any>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (n.type === 'file' && n.operation === 'create') {
    validateCreatedName(n.name);
    validateCreatedText(n.content);
    if (n.version !== 3 && (n.version !== 4 || n.onConflict !== 'number'))
      throw new Error('文本新建版本或同名策略无效');
    const root = bindings.files[n.binding];
    if (!root) throw new Error('文件目录尚未绑定');
    const base = await realpath(root);
    const target = scopedTarget(base, n.name);
    const parent = await realpath(dirname(target));
    if (parent !== base && !parent.startsWith(base + sep))
      throw new Error('符号链接超出文件授权目录');
    const path = await createText(
      join(parent, basename(target)),
      n.content,
      n.version === 4,
      signal,
    );
    return artifact(path);
  }
  if (n.type === 'excel' && n.operation === 'map') validateMappedFilename(n.name);
  if (n.version === 2) {
    assertRelativeName(n.name);
    if (n.operation === 'fill') assertRelativeName(n.templateName);
  }
  const path = await scopedPath(
    bindings.files[n.binding],
    String(n.name),
    n.operation !== 'read',
  ).catch((error: unknown) => {
    throw n.operation === 'read' ? error : fileWriteFailure(error);
  });
  if (n.type === 'excel') {
    const workbook = new ExcelJS.Workbook();
    if (n.operation === 'map') {
      const rows = mappedRows(n, n.rows);
      workbook.addWorksheet(n.sheet).addRows(rows);
      try {
        await atomicWrite(path, (temporary) => workbook.xlsx.writeFile(temporary), true, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          throw new Error('输出文件已存在，请更换文件名；原文件未覆盖');
        throw error;
      }
      return artifact(path);
    }
    if (n.operation === 'read') {
      await workbook.xlsx.readFile(path);
      const sheet = workbook.worksheets[0];
      const rows: any[] = [];
      sheet?.eachRow({ includeEmpty: true }, (row) => {
        const values = (row.values as any[]).slice(1);
        rows.push(Array.from(values, (value) => value ?? null));
      });
      return rows;
    }
    if (n.operation === 'fill') {
      const template = await scopedPath(bindings.files[n.binding], String(n.templateName));
      if (template === path) throw new Error('模板输出必须另存，不能覆盖原模板');
      if ((await stat(template)).size > 50 * 1024 * 1024) throw new Error('Excel 模板超过 50 MiB');
      if (
        !n.cells ||
        typeof n.cells !== 'object' ||
        Array.isArray(n.cells) ||
        Object.keys(n.cells).length > 10000
      )
        throw new Error('模板 cells 必须是最多 10000 项的单元格映射');
      const seen = new Set<string>();
      const cells = Object.entries(n.cells).map(([key, value]) => {
        const address = cellAddress(key);
        if (seen.has(address)) throw new Error('目标单元格重复：' + address);
        seen.add(address);
        return [address, cellValue(value)] as const;
      });
      await workbook.xlsx.readFile(template);
      const sheet = n.sheet ? workbook.getWorksheet(n.sheet) : workbook.worksheets[0];
      if (!sheet) throw new Error('模板中不存在指定工作表');
      for (const [address, value] of cells) sheet.getCell(address).value = value;
      await atomicWrite(path, (temporary) => workbook.xlsx.writeFile(temporary), false, signal);
      return artifact(path);
    }
    if (!Array.isArray(n.rows)) throw new Error('Excel rows 必须为数组');
    const rows = Array.from(n.rows, (row) => {
      // A null cell records even a trailing empty row in the workbook.
      if (row == null || (Array.isArray(row) && !row.length)) return [null];
      // ExcelJS interprets arrays without their own index 0 as one-based sparse rows.
      return Array.isArray(row) ? Array.from(row, (value) => value ?? null) : row;
    });
    workbook.addWorksheet('Sheet1').addRows(rows);
    await atomicWrite(path, (temporary) => workbook.xlsx.writeFile(temporary), false, signal);
    return artifact(path);
  }
  if (n.operation === 'read') {
    if ((await stat(path)).size > 10 * 1024 * 1024) throw new Error('文本文件超过 10 MiB');
    return readFile(path, 'utf8');
  }
  if (n.operation === 'write')
    await atomicWrite(
      path,
      (temporary) =>
        writeFile(temporary, typeof n.content === 'string' ? n.content : JSON.stringify(n.content)),
      false,
      signal,
    );
  else if (n.operation === 'copy')
    await atomicWrite(
      path,
      async (temporary) =>
        copyFile(await scopedPath(bindings.files[n.binding], String(n.content)), temporary),
      false,
      signal,
    );
  else if (n.operation === 'archive')
    await archiveFiles(bindings.files[n.binding], path, n.files, signal);
  else throw new Error('文件操作不支持');
  return artifact(path);
}
export async function artifactPath(root: string, runId: string, name: string) {
  if (!/^[\w.-]{1,150}$/.test(name) || name === '..') throw new Error('产物名称无效');
  const dir = join(root, 'artifacts', runId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return join(dir, name);
}
