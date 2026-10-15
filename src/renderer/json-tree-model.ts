import type { Json } from '../shared/types';

export type JsonPath = (string | number)[];
export type JsonKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
export const jsonKind = (value: Json): JsonKind =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : (typeof value as JsonKind);
export const jsonKindLabel: Record<JsonKind, string> = {
  object: '对象',
  array: '数组',
  string: '文本',
  number: '数字',
  boolean: '布尔',
  null: '空值',
};
export const jsonPathLabel = (path: JsonPath) =>
  'data' + path.map((key) => '[' + JSON.stringify(key) + ']').join('');
export function jsonAt(value: Json, path: JsonPath): Json {
  for (const key of path) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key))
      throw Error('当前字段已不存在，请重新选择。');
    value = (value as Record<string | number, Json>)[key];
  }
  return value;
}
export function jsonReplace(value: Json, path: JsonPath, next: Json): Json {
  if (!path.length) return next;
  const [key, ...rest] = path;
  jsonAt(value, [key]);
  if (Array.isArray(value))
    return value.map((child, index) => (index === key ? jsonReplace(child, rest, next) : child));
  return Object.fromEntries(
    Object.entries(value as Record<string, Json>).map(([name, child]) => [
      name,
      name === key ? jsonReplace(child, rest, next) : child,
    ]),
  );
}
export function jsonRename(value: Json, path: JsonPath, name: string, next: Json): Json {
  if (!path.length || typeof path.at(-1) === 'number') return jsonReplace(value, path, next);
  const parentPath = path.slice(0, -1),
    key = path.at(-1)!;
  const parent = jsonAt(value, parentPath) as Record<string, Json>;
  if (name !== key && Object.hasOwn(parent, name))
    throw Error('同一对象中已有这个名称，请更换名称。');
  return jsonReplace(
    value,
    parentPath,
    Object.fromEntries(Object.entries(parent).map(([k, v]) => (k === key ? [name, next] : [k, v]))),
  );
}
export function jsonRemove(value: Json, path: JsonPath): Json {
  if (!path.length) throw Error('根对象不能移除。');
  const parentPath = path.slice(0, -1),
    key = path.at(-1)!;
  const parent = jsonAt(value, parentPath);
  const next = Array.isArray(parent)
    ? parent.filter((_, index) => index !== key)
    : Object.fromEntries(Object.entries(parent as Record<string, Json>).filter(([k]) => k !== key));
  return jsonReplace(value, parentPath, next);
}
export function jsonDefault(kind: JsonKind): Json {
  return { object: {}, array: [], string: '', number: 0, boolean: false, null: null }[kind];
}
export function jsonText(value: Json): string {
  return typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : typeof value === 'boolean'
        ? String(value)
        : '';
}
export function jsonInput(kind: JsonKind, text: string, original: Json): Json {
  if (kind === 'string') return text;
  if (kind === 'number') {
    if (
      !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text) ||
      !Number.isFinite(Number(text))
    )
      throw Error('请输入完整的有限数字，当前输入保留。');
    return Number(text);
  }
  if (kind === 'boolean') return text === 'true';
  return jsonKind(original) === kind ? original : jsonDefault(kind);
}
