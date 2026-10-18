/** Format/association reference only; cannot establish DOM rendering, visibility or provenance. */
import Ajv from 'ajv/dist/2020.js';
import schema from './p1.schema.json';

export const browserRenderedFieldsCapability = 'browser-rendered-fields-v1';
export const browserRenderedFieldsLimits = { fields: 20, rawFieldBytes: 8192, renderedFieldBytes: 65536, resultBytes: 131072, urlBytes: 16384, scanElements: 2000, scanNodes: 6000, ancestorDepth: 64 };
export const renderedIssueOrder = ['hidden-target', 'hidden-descendant', 'line-clamp', 'overflow-clip', 'unsupported-layout', 'embedded-content', 'generated-content'];
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema);
const forbidden = ['__proto__', 'prototype', 'constructor'];
function shape(name: string, value: unknown) {
  const validate = ajv.getSchema(schema.$id + '#/$defs/' + name)!;
  if (!validate(value)) throw Error('关联正文格式无效：' + ajv.errorsText(validate.errors));
}
function unicode(value: string) {
  if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.from(value)) !== value) throw Error('关联正文含无效Unicode');
}
function input(value: any, resolved: boolean) {
  if (value === null) return;
  if (typeof value === 'string') { unicode(value); return; }
  if (resolved) throw Error('关联正文引用尚未解析');
  const parts = value.$ref.split('.');
  if (parts.some((p: string) => !p || forbidden.includes(p)) || !['params', 'steps', 'item', 'index'].includes(parts[0]) || (['params', 'steps'].includes(parts[0]) && parts.length < 2) || (parts[0] === 'index' && parts.length !== 1)) throw Error('关联正文引用无效');
  unicode(value.$ref);
}
export function assertBrowserRenderedFieldsNode(value: unknown, resolved = false): any {
  shape('BrowserRenderedFieldsNode', value);
  const n = value as any;
  input(n.selector, resolved); n.framePath.forEach(unicode);
  const keys = new Set<string>();
  for (const f of n.fields) {
    if (keys.has(f.key) || forbidden.includes(f.key)) throw Error('关联正文字段名重复或使用保留键');
    keys.add(f.key); input(f.selector, resolved); input(f.attribute, resolved);
  }
  return n;
}
export function assertBrowserRenderedFieldsCapabilities(value: any, capabilities: string[], manifest?: any, entry?: any) {
  if (value?.type !== 'browser' || value.version !== 6) return;
  assertBrowserRenderedFieldsNode(value);
  if (!['browser', browserRenderedFieldsCapability].every(c => capabilities.includes(c))) throw Error('关联正文节点必须声明browser和browser-rendered-fields-v1能力');
  if (manifest && (!entry || !manifest.resources.some((r: any) => r.kind === 'browser' && r.access === 'use' && entry.resources.includes(r.id)))) throw Error('关联正文入口必须声明自己的browser/use资源');
}
export function renderedFieldStatus(f: any): string {
  if (f.count !== 1) {
    if (f.value !== null || f.issues.length) throw Error('非唯一正文字段不可带值或渲染原因');
    return f.count === 0 ? 'missing' : 'ambiguous';
  }
  if (f.operation !== 'rendered-text' && f.issues.length) throw Error('原始字段不可带渲染原因');
  if (f.issues.length) {
    if (f.value !== null) throw Error('不可采用正文不得返回隐藏或部分文字');
    if (JSON.stringify(f.issues) !== JSON.stringify(renderedIssueOrder.filter(v => f.issues.includes(v)))) throw Error('正文原因须唯一并按策略顺序排列');
    if (f.issues.some((v: string) => v.startsWith('hidden-'))) return 'hidden';
    if (f.issues.some((v: string) => ['line-clamp', 'overflow-clip'].includes(v))) return 'clipped';
    return 'unsupported';
  }
  if (f.value === null) {
    if (f.operation !== 'attribute') throw Error('唯一文字字段不得无原因返回null');
    return 'missing-attribute';
  }
  return f.value.trim() === '' ? 'empty' : 'ok';
}
/** Exact resolved input must be supplied by the host's own driver invocation. */
export function assertBrowserRenderedFieldsResult(node: unknown, value: unknown): any {
  const n = assertBrowserRenderedFieldsNode(node, true);
  shape('BrowserRenderedFieldsResult', value);
  const r = value as any;
  if (r.selector !== n.selector || JSON.stringify(r.framePath) !== JSON.stringify(n.framePath) || r.fields.length !== n.fields.length) throw Error('关联正文结果不属于本次配置');
  if (!n.framePath.length && r.url !== r.documentUrl) throw Error('顶层正文文档网址不一致');
  for (const url of [r.url, r.documentUrl]) { unicode(url); if (Buffer.byteLength(url) > browserRenderedFieldsLimits.urlBytes) throw Error('关联正文网址超限'); }
  let complete = true;
  for (let i = 0; i < n.fields.length; i++) {
    const f = r.fields[i], configured = n.fields[i];
    for (const key of ['key', 'selector', 'operation', 'attribute', 'required']) if (f[key] !== configured[key]) throw Error('关联正文字段顺序或配置不符');
    const status = renderedFieldStatus(f);
    if (status !== f.status) throw Error('关联正文字段计数、值、原因或状态不一致');
    if (typeof f.value === 'string') { unicode(f.value); if (Buffer.byteLength(f.value) > (f.operation === 'rendered-text' ? browserRenderedFieldsLimits.renderedFieldBytes : browserRenderedFieldsLimits.rawFieldBytes)) throw Error('关联正文单项超限'); }
    if (['ambiguous', 'hidden', 'clipped', 'unsupported'].includes(status) || (f.required && status !== 'ok')) complete = false;
  }
  if (r.complete !== complete) throw Error('关联正文完整性不符');
  if (Buffer.byteLength(JSON.stringify(r)) > browserRenderedFieldsLimits.resultBytes) throw Error('关联正文总结果超限，未截断或采用');
  return r;
}
