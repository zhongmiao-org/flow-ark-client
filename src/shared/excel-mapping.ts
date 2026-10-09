import type { Flow, Step } from './types';
import { resolveValue } from '../core/engine';

export type MappedExcel = Extract<Step, { type: 'excel'; version: 3 }>;
export type ExcelMapping = MappedExcel['mappings'][number];
export type ExcelScalar = string | number | boolean | null;
export class ExcelMappingError extends Error {
  constructor(
    message: string,
    public field: string,
    public mapping?: number,
    public row?: number,
  ) {
    super(message);
    this.name = 'ExcelMappingError';
  }
}
function fail(message: string, field: string, mapping?: number, row?: number): never {
  throw new ExcelMappingError(message, field, mapping, row);
}
export function excelColumn(column: string) {
  if (!/^[A-Z]{1,3}$/.test(column)) return -1;
  const value = [...column].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  return value <= 16384 ? value - 1 : -1;
}
export function validateMapping(node: MappedExcel) {
  if (
    !node.sheet ||
    node.sheet.length > 31 ||
    /[*?:/\\[\]\x00-\x1f]/.test(node.sheet) ||
    /^'|'$/.test(node.sheet) ||
    node.sheet.toLowerCase() === 'history'
  )
    fail('工作表名称须为 1～31 字符，不能包含禁用字符或使用 History', 'sheet');
  if (node.nullPolicy !== 'blank') fail('空值策略仅支持保留空单元格', 'nullPolicy');
  if (!node.mappings.length || node.mappings.length > 256)
    fail('请配置 1～256 个字段映射', 'mappings');
  const seen = new Set<number>();
  return node.mappings.map((item, i) => {
    if (
      !item.source ||
      item.source.length > 256 ||
      ['__proto__', 'constructor', 'prototype'].includes(item.source)
    )
      fail('请选择有效的来源字段', 'source', i);
    const column = excelColumn(item.column);
    if (column < 0) fail('目标列必须为 A～XFD', 'column', i);
    if (seen.has(column)) fail(`目标列 ${item.column} 重复，请修改映射`, 'column', i);
    seen.add(column);
    if (item.header.length > 256) fail('表头不能超过 256 字符', 'header', i);
    if (!['text', 'number', 'boolean'].includes(item.type))
      fail('请选择文本、数字或布尔类型', 'type', i);
    return column;
  });
}
export function validateMappedFilename(name: unknown): asserts name is string {
  if (
    typeof name !== 'string' ||
    !name.endsWith('.xlsx') ||
    /[\\\x00:]/.test(name) ||
    name.split('/').some((part) => ['', '.', '..'].includes(part))
  )
    fail('输出必须是绑定目录内的相对 .xlsx 文件名', 'name');
}
/** Both preview and execution validate every row before returning any output. */
export function mappedRows(node: MappedExcel, input: unknown): ExcelScalar[][] {
  const columns = validateMapping(node),
    width = Math.max(...columns) + 1;
  if (!Array.isArray(input) || input.length > 100000)
    fail('来源必须是最多 100000 条的记录数组', 'rows');
  if ((input.length + Number(node.includeHeaders)) * width > 1000000)
    fail('映射结果超过一百万个单元格，请缩小来源或目标列范围', 'rows');
  const output: ExcelScalar[][] = [];
  if (node.includeHeaders) {
    const header = Array<ExcelScalar>(width).fill(null);
    node.mappings.forEach((item, i) => {
      header[columns[i]] = item.header;
    });
    output.push(header);
  }
  for (let row = 0; row < input.length; row++) {
    const record = input[row];
    if (!record || typeof record !== 'object')
      fail(`来源第 ${row + 1} 行不是记录`, 'rows', undefined, row);
    const values = Array<ExcelScalar>(width).fill(null);
    node.mappings.forEach((item, i) => {
      if (
        !Object.hasOwn(record, item.source) ||
        (Array.isArray(record) && !/^(0|[1-9][0-9]*)$/.test(item.source))
      )
        fail(
          `第 ${row + 1} 行缺少来源字段「${item.source}」（目标列 ${item.column}）`,
          'source',
          i,
          row,
        );
      const value = record[item.source];
      if (
        value !== null &&
        (typeof value !== { text: 'string', number: 'number', boolean: 'boolean' }[item.type] ||
          (typeof value === 'number' && !Number.isFinite(value)))
      )
        fail(
          `第 ${row + 1} 行「${item.source}」与目标列 ${item.column} 的${{ text: '文本', number: '数字', boolean: '布尔' }[item.type]}类型不符`,
          'type',
          i,
          row,
        );
      values[columns[i]] = value;
    });
    output.push(values);
  }
  return output;
}
function runtimeReference(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if ('$ref' in value && typeof value.$ref === 'string')
    return /^(steps\.|item(?:\.|$)|index$)/.test(value.$ref);
  return Object.values(value).some(runtimeReference);
}
export function mappingPreview(node: MappedExcel, parameters: Flow['parameters']) {
  validateMapping(node);
  const resolve = (value: unknown) => {
    try {
      return { known: true as const, value: resolveValue(value, { params: parameters }) };
    } catch (error) {
      if (!runtimeReference(value)) throw error;
      return { known: false as const };
    }
  };
  const name = resolve(node.name);
  if (name.known) validateMappedFilename(name.value);
  const source = resolve(node.rows);
  return source.known
    ? {
        available: true as const,
        rows: mappedRows(node, source.value),
        count: (source.value as unknown[]).length,
      }
    : {
        available: false as const,
        reason: '来源依赖运行时步骤；保存配置后，在运行时核对全部记录。预览不会执行前序步骤。',
      };
}
