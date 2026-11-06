import Ajv from 'ajv/dist/2020.js';
import type { Json } from '../shared/types';

export class ProjectDiagnostic extends Error {
  constructor(public code: string, message: string, public file?: string, public field?: string) {
    super(message);
  }
  toJSON() { return { code: this.code, message: this.message, file: this.file, field: this.field }; }
}
export const object = (v: unknown): v is Record<string, Json> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
export function assertJson(value: unknown, depth = 0): asserts value is Json {
  if (depth > 40) throw new ProjectDiagnostic('json-depth', 'JSON层级超过40');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))) return;
  if (!Array.isArray(value) && !object(value)) throw new ProjectDiagnostic('json-value', '只允许有限JSON值');
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) throw new ProjectDiagnostic('reserved-key', '禁止保留字段：' + key);
    assertJson(child, depth + 1);
  }
}
export function mergeConfiguration(base: Json, override: Json): Json {
  assertJson(base); assertJson(override);
  if (!object(base) || !object(override)) return structuredClone(override);
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override))
    result[key] = Object.hasOwn(result, key) ? mergeConfiguration(result[key], value) : structuredClone(value);
  return result;
}
export type EnvironmentMapping = { variable: string; field: string; type: 'string' | 'number' | 'integer' | 'boolean' | 'json' };
const secretName = /(^|[_\W])(api[_-]?key|secret|token|password|credential|private[_-]?key)([_\W]|$)/i;
export function parseEnvironment(text: string, mappings: EnvironmentMapping[]): Record<string, Json> {
  const values = new Map<string, string>();
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match || values.has(match[1])) throw new ProjectDiagnostic('env-syntax', 'env格式或重复变量错误，第' + (index + 1) + '行', '.env.local');
    const mapping = mappings.find(m => m.variable === match[1]);
    if (!mapping) throw new ProjectDiagnostic('env-undeclared', '环境变量未声明：' + match[1], '.env.local');
    if (secretName.test(match[1]) || secretName.test(mapping.field))
      throw new ProjectDiagnostic('secret-reference-required', '密钥请使用客户端受保护凭据引用', '.env.local');
    let value = match[2];
    if (value.startsWith('"')) {
      try { value = JSON.parse(value); } catch { throw new ProjectDiagnostic('env-syntax', '双引号值须为完整JSON字符串', '.env.local'); }
      if (typeof value !== 'string') throw new ProjectDiagnostic('env-syntax', 'env值须为字符串', '.env.local');
    } else if (value.startsWith("'")) {
      if (!value.endsWith("'") || value.length < 2) throw new ProjectDiagnostic('env-syntax', '引号不完整', '.env.local');
      value = value.slice(1, -1);
    }
    if (/\bsk-[a-zA-Z0-9]{24,}|-----BEGIN .*PRIVATE KEY/.test(value))
      throw new ProjectDiagnostic('secret-reference-required', 'env中疑似密钥须改用受保护凭据引用', '.env.local');
    values.set(match[1], value);
  }
  const result: Record<string, Json> = {};
  for (const mapping of mappings) {
    if (!values.has(mapping.variable)) continue;
    const raw = values.get(mapping.variable)!;
    let value: Json = raw;
    if (mapping.type === 'boolean') {
      if (raw !== 'true' && raw !== 'false') throw new ProjectDiagnostic('env-type', '布尔值只允许true或false', '.env.local', mapping.field);
      value = raw === 'true';
    } else if (mapping.type === 'number' || mapping.type === 'integer') {
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw) || !Number.isFinite(Number(raw)) ||
          (mapping.type === 'integer' && !Number.isSafeInteger(Number(raw))))
        throw new ProjectDiagnostic('env-type', '数值格式无效', '.env.local', mapping.field);
      value = Number(raw);
    } else if (mapping.type === 'json') {
      try { value = JSON.parse(raw); assertJson(value); }
      catch { throw new ProjectDiagnostic('env-type', 'JSON值无效', '.env.local', mapping.field); }
    }
    const parts = mapping.field.split('.');
    if (parts.some(p => !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(p) || forbidden.has(p)))
      throw new ProjectDiagnostic('env-field', '无效环境变量目标', 'flowark.project.json', mapping.field);
    let target = result;
    for (const part of parts.slice(0, -1)) {
      if (Object.hasOwn(target, part) && !object(target[part])) throw new ProjectDiagnostic('env-conflict', '环境变量目标重叠', '.env.local', mapping.field);
      target = (target[part] ??= {}) as Record<string, Json>;
    }
    if (Object.hasOwn(target, parts.at(-1)!)) throw new ProjectDiagnostic('env-conflict', '环境变量目标重复', '.env.local', mapping.field);
    target[parts.at(-1)!] = value;
  }
  return result;
}
export function resolveConfiguration(schema: object, layers: { defaults: Json; instance?: Json; profile?: Json; environment?: Json; overrides?: Json }) {
  let value: Json = structuredClone(layers.defaults);
  for (const layer of [layers.instance, layers.profile, layers.environment, layers.overrides])
    if (layer !== undefined) value = mergeConfiguration(value, layer);
  const validate = new Ajv({ strict: false, allErrors: true }).compile(schema);
  if (!validate(value)) throw new ProjectDiagnostic('configuration-schema', '配置不符合Schema：' +
    validate.errors?.map(e => `${e.instancePath || '/'} ${e.message}`).join('；'), 'schemas/configuration.json');
  return value;
}
