import type { Json, Step } from '../shared/types';
export type FileNode = Extract<Step, { type: 'file' | 'excel' }>;
export function resourceOperation(node: FileNode, operation: string): FileNode {
  const excel = node.type === 'excel';
  if (
    !(excel ? ['read', 'write', 'fill'] : ['read', 'write', 'copy', 'archive']).includes(operation)
  )
    throw new Error('未知文件操作');
  const extra = excel
    ? operation === 'fill'
      ? {
          version: 2,
          name: 'filled.xlsx',
          templateName: 'template.xlsx',
          sheet: '',
          cells: { A1: '示例' },
        }
      : { version: 1, name: 'result.xlsx', rows: [] }
    : operation === 'archive'
      ? { version: 2, name: 'archive.zip', files: ['result.txt'] }
      : { version: 1, name: 'result.txt', content: operation === 'copy' ? 'source.txt' : '' };
  return {
    id: node.id,
    type: node.type,
    binding: node.binding,
    ...(node.timeoutMs ? { timeoutMs: node.timeoutMs } : {}),
    operation,
    ...extra,
  } as FileNode;
}
export function columnName(index: number): string {
  let n = index + 1,
    name = '';
  while (n > 0) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}
export function cellKey(key: string): string {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(key.toUpperCase());
  if (!match) throw new Error('请输入有效单元格地址，例如 A1');
  const column = [...match[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  if (column > 16384 || Number(match[2]) > 1048576) throw new Error('单元格超出 Excel 行列边界');
  return match[0];
}
export function mapKey(
  kind: 'headers' | 'cells',
  name: string,
  value: Record<string, Json>,
  previous?: string,
) {
  const key = kind === 'cells' ? cellKey(name) : name;
  if (kind === 'headers' && !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(key))
    throw new Error('请求头名称不能包含空格、冒号或换行');
  if (['__proto__', 'constructor', 'prototype'].includes(key))
    throw new Error('此属性名称不可使用');
  if (Object.keys(value).some((k) => k !== previous && k.toLowerCase() === key.toLowerCase()))
    throw new Error('名称重复，不会覆盖已有值');
  return key;
}
export function renameEntry(
  value: Record<string, Json>,
  old: string,
  next: string,
  kind: 'headers' | 'cells',
) {
  if (!Object.hasOwn(value, old)) throw new Error('条目不存在');
  const key = mapKey(kind, next, value, old);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k === old ? key : k, v]));
}
export const isMatrix = (value: Json): value is Json[][] =>
  Array.isArray(value) && value.every(Array.isArray);
export const matrixColumns = (rows: Json[][]) =>
  rows.reduce((max, row) => Math.max(max, row.length), 1);
export function setCell(rows: Json[][], row: number, column: number, value: Json): Json[][] {
  if (row < 0 || row >= rows.length || column < 0 || column >= matrixColumns(rows))
    throw new Error('单元格不在当前表格中');
  return rows.map((r, i) =>
    i !== row
      ? r
      : Array.from({ length: Math.max(r.length, column + 1) }, (_, j) =>
          j === column ? value : (r[j] ?? null),
        ),
  );
}
export function addColumn(rows: Json[][]): Json[][] {
  const length = matrixColumns(rows);
  if (length >= 16384) throw new Error('超过 Excel 列数限制');
  return rows.map((row) => Array.from({ length: length + 1 }, (_, i) => row[i] ?? null));
}
export const removeColumn = (rows: Json[][], column: number): Json[][] =>
  rows.map((row) => row.filter((_, i) => i !== column));
