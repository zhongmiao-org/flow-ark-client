/** Normative data validation; this module never reads a browser or executes a selector. */
import Ajv from 'ajv/dist/2020.js';
import schema from './p1.schema.json';

export const browserInspectionCapability = 'browser-observe-v1';
export const browserInspectionLimits = { selector: 2000, attribute: 128, urlBytes: 16384, attributeBytes: 65536 };
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema);
const validate = ajv.getSchema(schema.$id + '#/$defs/BrowserInspectionNode')!;
const isReference = (value: unknown): value is { $ref: string } => Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && typeof (value as any).$ref === 'string');
function unicode(text: string) {
  if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.from(text)) !== text)
    throw Error('网页只读参数或结果含无效Unicode');
}
function reference(value: { $ref: string }) {
  const parts = value.$ref.split('.');
  if (parts.some(p => !p || ['__proto__', 'prototype', 'constructor'].includes(p)) ||
    !['params', 'steps', 'item', 'index'].includes(parts[0]) ||
    (['params', 'steps'].includes(parts[0]) && parts.length < 2) ||
    (parts[0] === 'index' && parts.length !== 1)) throw Error('网页只读参数引用无效');
  unicode(value.$ref);
}
export function assertBrowserInspectionNode(value: unknown, resolved = false): any {
  if (!validate(value)) throw Error('网页只读节点无效：' + ajv.errorsText(validate.errors));
  const n = value as any;
  for (const field of ['selector', 'value']) {
    const v = n[field];
    if (isReference(v)) {
      if (resolved) throw Error('网页只读参数尚未解析');
      reference(v);
    } else if (typeof v === 'string') unicode(v);
  }
  for (const part of n.framePath) unicode(part);
  return n;
}
export function assertBrowserInspectionResult(operation: string, result: unknown): unknown {
  if (operation === 'count') {
    if (!Number.isSafeInteger(result) || (result as number) < 0) throw Error('元素统计结果须为非负安全整数');
    return result;
  }
  if (operation === 'attribute' && result === null) return null;
  if (!['url', 'attribute'].includes(operation) || typeof result !== 'string') throw Error('网页只读结果类型无效');
  unicode(result);
  const limit = operation === 'url' ? browserInspectionLimits.urlBytes : browserInspectionLimits.attributeBytes;
  if (Buffer.byteLength(result, 'utf8') > limit) throw Error('网页只读结果超限，未截断或采用');
  return result;
}
