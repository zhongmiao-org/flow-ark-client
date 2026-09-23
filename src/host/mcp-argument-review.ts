import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import type { McpArgumentReview } from '../shared/mcp-argument-review';

const LIMIT = 65536;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const segment = (key: string) => '/' + key.replace(/~/g, '~0').replace(/\//g, '~1');
const keywords = new Set([
  '$schema',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties',
  'title',
  'description',
  'default',
  'examples',
  'deprecated',
  'readOnly',
  'writeOnly',
]);
const validators = new Map<string, ValidateFunction>();

function bounded(value: unknown) {
  let count = 0,
    referenceCount = 0;
  const seen = new Set<object>();
  const pending = [{ value, depth: 0 }];
  while (pending.length) {
    const entry = pending.pop()!;
    if (++count > 4096 || entry.depth > 20) throw new Error('内容超过 4096 项或 20 层的核对上限');
    const v = entry.value;
    if (v === null || typeof v === 'string' || typeof v === 'boolean') continue;
    if (typeof v === 'number' && Number.isFinite(v)) continue;
    if (!v || typeof v !== 'object' || seen.has(v)) throw new Error('内容不是可核对的 JSON');
    seen.add(v);
    if (object(v) && Object.keys(v).length === 1 && typeof v.$ref === 'string') referenceCount++;
    const children = Object.values(v);
    if (count + pending.length + children.length > 4096)
      throw new Error('内容超过 4096 项的核对上限');
    for (const child of children) pending.push({ value: child, depth: entry.depth + 1 });
  }
  const json = JSON.stringify(value);
  if (!json || Buffer.byteLength(json, 'utf8') > LIMIT)
    throw new Error('内容超过 65536 字节的核对上限');
  return { json, referenceCount };
}

function supported(schema: Record<string, unknown>): { path: string; message: string } | undefined {
  if (schema.type !== 'object') return { path: '', message: '工具输入定义的根类型必须是 object' };
  const pending: { value: unknown; path: string; depth: number }[] = [
    { value: schema, path: '', depth: 0 },
  ];
  let count = 0;
  while (pending.length) {
    const { value, path, depth } = pending.pop()!;
    if (++count > 256 || depth > 12)
      return { path, message: '输入定义超过 256 个规则节点或 12 层的支持范围' };
    if (typeof value === 'boolean') continue;
    if (!object(value)) return { path, message: '此处需要对象或布尔形式的输入定义' };
    for (const [key, child] of Object.entries(value)) {
      if (!keywords.has(key))
        return { path: path + segment(key), message: '此输入定义规则暂不支持，不能跳过后判定通过' };
      if (key === '$schema' && child !== 'https://json-schema.org/draft/2020-12/schema')
        return { path: path + segment(key), message: '暂仅支持 JSON Schema 2020-12 的指定子集' };
      if (key === 'properties') {
        if (!object(child)) return { path: path + '/properties', message: '字段定义必须是对象' };
        for (const [name, definition] of Object.entries(child))
          pending.push({
            value: definition,
            path: path + '/properties' + segment(name),
            depth: depth + 1,
          });
      } else if (key === 'items' || key === 'additionalProperties') {
        pending.push({ value: child, path: path + '/' + key, depth: depth + 1 });
      }
    }
  }
}

function issue(error: ErrorObject): { path: string; message: string } {
  const path = error.instancePath;
  const p = error.params;
  switch (error.keyword) {
    case 'required':
      return { path: path + segment(p.missingProperty), message: '缺少必填字段' };
    case 'additionalProperties':
      return { path: path + segment(p.additionalProperty), message: '此字段不在允许的输入范围内' };
    case 'type':
      return { path, message: '字段类型与工具输入定义不符' };
    case 'enum':
    case 'const':
      return { path, message: '固定值不在工具定义允许的范围内' };
    case 'minLength':
    case 'maxLength':
      return { path, message: '文字长度不符合输入定义' };
    case 'minItems':
    case 'maxItems':
      return { path, message: '列表项数不符合输入定义' };
    case 'minProperties':
    case 'maxProperties':
      return { path, message: '对象字段数量不符合输入定义' };
    case 'minimum':
    case 'maximum':
    case 'exclusiveMinimum':
    case 'exclusiveMaximum':
    case 'multipleOf':
      return { path, message: '数值不符合输入定义的范围或倍数要求' };
    default:
      return { path, message: '参数不符合此处的输入定义' };
  }
}

export function reviewMcpArguments(
  schema: unknown,
  args: unknown,
  resolved = false,
): McpArgumentReview {
  if (schema === undefined)
    return { status: 'unavailable', summary: '没有匹配的工具输入定义', issues: [] };
  let source: string;
  try {
    source = bounded(schema).json;
    if (!object(schema)) throw new Error('工具输入定义必须是对象');
    const unsupported = supported(schema);
    if (unsupported)
      return { status: 'unsupported', summary: '输入定义暂不能完整核对', issues: [unsupported] };
  } catch (error) {
    return {
      status: 'unsupported',
      summary: '输入定义无效或超过核对上限',
      issues: [{ path: '', message: (error as Error).message }],
    };
  }
  let validate = validators.get(source);
  if (!validate) {
    try {
      const ajv = new Ajv2020({
        strict: true,
        strictTypes: false,
        strictRequired: false,
        allErrors: false,
        ownProperties: true,
        coerceTypes: false,
        useDefaults: false,
        removeAdditional: false,
        validateFormats: false,
      });
      validate = ajv.compile(schema as object);
      if (validators.size >= 16) validators.delete(validators.keys().next().value!);
      validators.set(source, validate);
    } catch {
      return {
        status: 'unsupported',
        summary: '工具输入定义无法校验',
        issues: [{ path: '', message: '服务提供的输入定义无效，请核对完整定义并联系服务提供者' }],
      };
    }
  }
  let referenceCount: number;
  try {
    referenceCount = bounded(args).referenceCount;
    if (!object(args)) throw new Error('整组工具参数必须是 JSON 对象');
  } catch (error) {
    return {
      status: 'invalid',
      summary: '参数结构或大小不符合要求',
      issues: [{ path: '', message: (error as Error).message }],
    };
  }
  if (referenceCount && !resolved)
    return {
      status: 'deferred',
      summary: '参数含动态引用，需在执行前求值后核对',
      referenceCount,
      issues: [],
    };
  try {
    if (validate(args))
      return { status: 'valid', summary: '固定参数符合已保存的输入定义', issues: [] };
    return {
      status: 'invalid',
      summary: '固定参数与输入定义不符',
      issues: (validate.errors ?? []).slice(0, 20).map(issue),
    };
  } catch {
    return {
      status: 'unsupported',
      summary: '参数核对未能完成',
      issues: [{ path: '', message: '无法可靠核对输入，未跳过检查或调用工具' }],
    };
  }
}
