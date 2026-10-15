/** Normative data checks only. Host transactions and authorization remain separate. */
import Ajv from 'ajv/dist/2020.js';
import schema from './p1.schema.json';
import { canonical, sha256, assertSchema, validateData } from './package-format';
import { validateConfigurationSchema } from './configuration-schema';

export const TEMPLATE_DATA_LIMITS = { bytes: 2 * 1024 * 1024, values: 50000, depth: 40 };
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema);
function budget(value: unknown) {
  let count = 0;
  const seen = new Set<object>();
  const unicode = (text: string) => {
    if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.from(text)) !== text)
      throw Error('模板数据含无效Unicode');
  };
  const visit = (v: any, depth: number) => {
    if (++count > TEMPLATE_DATA_LIMITS.values || depth > TEMPLATE_DATA_LIMITS.depth)
      throw Error('模板数据层级或成员数量超限');
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (typeof v === 'string') {
      unicode(v);
      return;
    }
    if (!v || typeof v !== 'object' || seen.has(v) ||
      (!Array.isArray(v) && ![null, Object.prototype].includes(Object.getPrototypeOf(v))))
      throw Error('模板数据须为有限JSON');
    seen.add(v);
    if (Array.isArray(v) && (Object.keys(v).length !== v.length ||
      Object.keys(v).some((key, index) => key !== String(index)))) throw Error('模板数据数组须为连续JSON项');
    for (const [key, child] of Object.entries(v)) {
      unicode(key);
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw Error('模板数据含保留键');
      visit(child, depth + 1);
    }
    seen.delete(v);
  };
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > TEMPLATE_DATA_LIMITS.bytes)
    throw Error('模板数据超过2MiB');
}
function shape(name: string, value: unknown): any {
  budget(value);
  const validate = ajv.getSchema(schema.$id + '#/$defs/' + name)!;
  if (!validate(value)) throw Error(name + '无效：' + ajv.errorsText(validate.errors));
  return value;
}
function localSchema(value: any) {
  const visit = (v: any) => {
    if (!v || typeof v !== 'object') return;
    for (const [key, child] of Object.entries(v)) {
      if (key === '$id' || ((key === '$ref' || key === '$dynamicRef') &&
        (typeof child !== 'string' || !child.startsWith('#/'))))
        throw Error('模板数据Schema禁止外部引用或自定义身份');
      visit(child);
    }
  };
  visit(value);
  assertSchema(value);
}
export function templateDataSchemaDigest(configurationSchema: unknown, stateSchema: unknown) {
  budget({ configurationSchema, stateSchema });
  return sha256(Buffer.from(canonical({ configurationSchema, stateSchema })));
}
/** A new debug form can be unready; a Run must explicitly request ready validation. */
export function validateTemplateDataContext(value: unknown, ready = false): any {
  const v = shape('TemplateDataContext', value);
  validateConfigurationSchema(v.configurationSchema);
  localSchema(v.configurationSchema);
  localSchema(v.stateSchema);
  if (v.schemaSha256 !== templateDataSchemaDigest(v.configurationSchema, v.stateSchema))
    throw Error('模板数据Schema摘要不一致');
  if (ready) validateData(v.configurationSchema, v.configuration);
  return v;
}
export function validateTemplateDataState(value: unknown, context?: unknown): any {
  const v = shape('TemplateDataState', value);
  if (context) {
    const c = validateTemplateDataContext(context);
    if (v.contextId !== c.id) throw Error('状态不属于本上下文');
    validateData(c.stateSchema, v.value);
  }
  return v;
}
export function validateTemplateDataWriteRequest(value: unknown, context?: unknown): any {
  const v = shape('TemplateDataWriteRequest', value);
  if (context) {
    const c = validateTemplateDataContext(context, true);
    if (v.contextId !== c.id) throw Error('写入不属于本上下文');
    validateData(c.stateSchema, v.value);
  }
  return v;
}
export function validateTemplateDataOutput(value: unknown): any {
  const v = shape('TemplateDataOutput', value);
  if (v.operation === 'configuration' && v.revision < 1) throw Error('配置修订从1开始');
  if (v.operation === 'state.write' && v.revision !== v.previousRevision + 1)
    throw Error('状态写入修订须恰好增加1');
  return v;
}
export function validateTemplateDataReceipt(value: unknown, request?: unknown): any {
  const v = shape('TemplateDataWriteReceipt', value);
  if (v.status === 'written') {
    const output = validateTemplateDataOutput(v.result);
    if (output.contextId !== v.contextId || output.operationId !== v.operationId)
      throw Error('写入回执与结果身份不一致');
  }
  if (request) {
    const r = validateTemplateDataWriteRequest(request);
    if (v.contextId !== r.contextId || v.operationId !== r.operationId ||
      v.requestSha256 !== sha256(Buffer.from(canonical(r))))
      throw Error('写入请求身份或内容与回执不一致');
    if (v.status === 'written' && (v.result.previousRevision !== r.expectedRevision ||
      canonical(v.result.value) !== canonical(r.value)))
      throw Error('写入回执与预期内容不一致');
  }
  return v;
}
export function validateTemplateDataEdit(value: unknown): any {
  return shape('TemplateDataEditRequest', value);
}
export function validateTemplateDataEditResult(value: unknown): any {
  const v = shape('TemplateDataEditResult', value);
  const c = validateTemplateDataContext(v.context, true);
  validateTemplateDataState(v.state, c);
  return v;
}
