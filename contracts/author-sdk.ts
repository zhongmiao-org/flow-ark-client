/** Normative author-local result/attention data checks; no host or filesystem imports. */
import Ajv from 'ajv/dist/2020.js';
import schema from './p1.schema.json';
import { canonical, sha256, assertSchema, validateData } from './package-format';

export const AUTHOR_SDK_LIMITS = { bytes: 2 * 1024 * 1024, depth: 40, values: 50000 };
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema);
function budget(value: unknown) {
  const seen = new Set<object>();
  let count = 0;
  const visit = (v: any, depth: number) => {
    if (++count > AUTHOR_SDK_LIMITS.values || depth > AUTHOR_SDK_LIMITS.depth)
      throw Error('作者SDK数据层级或成员数量超限');
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (typeof v === 'string') {
      if (Buffer.from(v).toString('utf8') !== v) throw Error('作者SDK数据含无效Unicode');
      return;
    }
    if (!v || typeof v !== 'object' || seen.has(v) ||
        (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))))
      throw Error('作者SDK数据须为有限JSON');
    seen.add(v);
    if (Array.isArray(v)) for (const item of v) visit(item, depth + 1);
    else for (const [key, item] of Object.entries(v)) {
      visit(key, depth + 1);
      visit(item, depth + 1);
    }
    seen.delete(v);
  };
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > AUTHOR_SDK_LIMITS.bytes)
    throw Error('作者SDK数据超过2MiB');
}
function shape(name: string, value: unknown): any {
  budget(value);
  const validate = ajv.getSchema(schema.$id + '#/$defs/' + name)!;
  if (!validate(value)) throw Error(name + '无效：' + ajv.errorsText(validate.errors));
  return value;
}
/** Identity/time are host registration fields; the digest fixes owner, schema and capabilities. */
export function authorSdkDefinitionDigest(value: any): string {
  const body = { owner: value.owner, resultSchema: value.resultSchema, capabilities: value.capabilities };
  budget(body);
  return sha256(canonical(body));
}
export function validateAuthorSdkContext(value: unknown): any {
  const context = shape('TemplateAuthorSdkContext', value);
  assertSchema(context.resultSchema);
  if (authorSdkDefinitionDigest(context) !== context.definitionSha256)
    throw Error('作者SDK固定定义摘要不符');
  return context;
}
export function assertAuthorSdkOperation(value: unknown, operation: unknown): void {
  const context = validateAuthorSdkContext(value);
  if (operation !== 'result' && operation !== 'attention')
    throw Error('此作者副本仅支持结果与提醒SDK；其他操作须在正式实例配置并验收');
  if (!context.capabilities.includes('template-sdk-v1'))
    throw Error('创建副本时未声明模板SDK能力，请保存制作定义后创建新副本');
  if (operation === 'attention' && !context.capabilities.includes('attention'))
    throw Error('创建副本时未声明提醒能力，请保存制作定义后创建新副本');
}
export function validateAuthorSdkResult(value: unknown, context?: unknown, runId?: string): any {
  const result = shape('TemplateAuthorSdkResult', value);
  if (runId !== undefined && result.runId !== runId) throw Error('作者SDK结果所属Run不符');
  if (context !== undefined) {
    const fixed = validateAuthorSdkContext(context);
    if (result.contextId !== fixed.id || result.definitionSha256 !== fixed.definitionSha256)
      throw Error('作者SDK结果与固定上下文不符');
    validateData(fixed.resultSchema, result.value);
  }
  return result;
}
