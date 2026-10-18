/** Normative format/association validation only. Never executes a selector or proves browser provenance. */
import Ajv from 'ajv/dist/2020.js';
import schema from './p1.schema.json';

export const browserFieldsCapability = 'browser-fields-v1';
export const browserFieldsLimits = { fields: 20, fieldBytes: 8192, resultBytes: 65536, urlBytes: 16384 };
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema);
const forbidden = ['__proto__', 'prototype', 'constructor'];
function shape(name: string, value: unknown) {
  const validate = ajv.getSchema(schema.$id + '#/$defs/' + name)!;
  if (!validate(value)) throw Error('关联字段格式无效：' + ajv.errorsText(validate.errors));
}
function unicode(value: string) {
  if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.from(value)) !== value)
    throw Error('关联字段含无效Unicode');
}
function input(value: any, resolved: boolean) {
  if (value === null) return;
  if (typeof value === 'string') { unicode(value); return; }
  if (resolved) throw Error('关联字段引用尚未解析');
  const parts = value.$ref.split('.');
  if (parts.some((p: string) => !p || forbidden.includes(p)) ||
      !['params', 'steps', 'item', 'index'].includes(parts[0]) ||
      (['params', 'steps'].includes(parts[0]) && parts.length < 2) ||
      (parts[0] === 'index' && parts.length !== 1)) throw Error('关联字段引用无效');
  unicode(value.$ref);
}
export function assertBrowserFieldsNode(value: unknown, resolved = false): any {
  shape('BrowserFieldsNode', value);
  const n = value as any;
  input(n.selector, resolved);
  for (const part of n.framePath) unicode(part);
  const keys = new Set<string>();
  for (const f of n.fields) {
    if (keys.has(f.key) || forbidden.includes(f.key)) throw Error('关联字段名重复或使用保留键');
    keys.add(f.key); input(f.selector, resolved); input(f.attribute, resolved);
  }
  return n;
}
export function assertBrowserFieldsCapabilities(value: any, capabilities: string[], manifest?: any, entry?: any) {
  if (value?.type !== 'browser' || value.version !== 5) return;
  assertBrowserFieldsNode(value);
  if (!['browser', browserFieldsCapability].every(c => capabilities.includes(c)))
    throw Error('关联字段节点必须声明browser和browser-fields-v1能力');
  if (manifest && (!entry || !manifest.resources.some((r: any) =>
    r.kind === 'browser' && r.access === 'use' && entry.resources.includes(r.id))))
    throw Error('关联字段入口必须声明自己的browser/use资源');
}
/** The caller must supply the exact resolved node used by its own driver operation. */
export function assertBrowserFieldsResult(node: unknown, value: unknown): any {
  const n = assertBrowserFieldsNode(node, true);
  shape('BrowserFieldsResult', value);
  const r = value as any;
  if (r.selector !== n.selector || JSON.stringify(r.framePath) !== JSON.stringify(n.framePath) || r.fields.length !== n.fields.length)
    throw Error('关联字段结果不属于本次配置');
  if (!n.framePath.length && r.url !== r.documentUrl) throw Error('顶层采集文档网址不一致');
  for (const url of [r.url, r.documentUrl]) {
    unicode(url);
    if (Buffer.byteLength(url) > browserFieldsLimits.urlBytes) throw Error('关联字段网址超限');
  }
  let complete = true;
  for (let i = 0; i < n.fields.length; i++) {
    const f = r.fields[i], configured = n.fields[i];
    for (const key of ['key', 'selector', 'operation', 'attribute', 'required'])
      if (f[key] !== configured[key]) throw Error('关联字段顺序或配置不符');
    if (typeof f.value === 'string') {
      unicode(f.value);
      if (Buffer.byteLength(f.value) > browserFieldsLimits.fieldBytes) throw Error('关联字段单项结果超限');
    }
    const status = f.count === 0 ? 'missing' : f.count > 1 ? 'ambiguous' :
      f.value === null ? 'missing-attribute' : f.value.trim() === '' ? 'empty' : 'ok';
    if (f.status !== status || (f.count === 1 && f.operation === 'text' && f.value === null) ||
        (f.count !== 1 && f.value !== null)) throw Error('关联字段计数、值或状态不一致');
    if (status === 'ambiguous' || (f.required && status !== 'ok')) complete = false;
  }
  if (r.complete !== complete) throw Error('关联字段完整性不符');
  if (Buffer.byteLength(JSON.stringify(r)) > browserFieldsLimits.resultBytes) throw Error('关联字段总结果超限，未截断或采用');
  return r;
}
