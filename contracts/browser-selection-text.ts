/** Normative format/association reference only; no DOM, application, Store or network. */
import Ajv from 'ajv/dist/2020.js';
import schema from './p1.schema.json';
export const browserSelectionTextCapability = 'browser-selection-text-v1';
export const browserSelectionTextPolicy = 'bounded-selection-text-v1';
export const browserSelectionTextLimits = { fields: 20, rawFieldBytes: 8192, selectionFieldBytes: 65536, resultBytes: 131072, urlBytes: 16384, scanElements: 2000, scanNodes: 6000, ancestorDepth: 64, ancestorPseudos: 128 };
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema);
const forbidden = ['__proto__', 'prototype', 'constructor'];
const issueOrder = ['hidden-target', 'hidden-descendant', 'line-clamp', 'overflow-clip', 'unsupported-layout', 'embedded-content', 'generated-content'];
const bytes = (v: string) => new TextEncoder().encode(v).length;
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function shape(name: string, v: unknown) {
  const check = ajv.getSchema(schema.$id + '#/$defs/' + name)!;
  if (!check(v)) throw Error('选区文字格式无效：' + name + ' ' + ajv.errorsText(check.errors));
}
function unicode(v: string) {
  if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(new TextEncoder().encode(v)) !== v)
    throw Error('选区文字含无效Unicode');
}
function input(v: any, resolved: boolean) {
  if (v === null) return;
  if (typeof v === 'string') { unicode(v); return; }
  if (resolved) throw Error('选区文字引用尚未解析');
  unicode(v.$ref);
  const p = v.$ref.split('.');
  if (p.some((k: string) => !k || forbidden.includes(k)) || !['params', 'steps', 'item', 'index'].includes(p[0]) ||
      (['params', 'steps'].includes(p[0]) && p.length < 2) || (p[0] === 'index' && p.length !== 1))
    throw Error('选区文字引用路径无效');
}
export function assertBrowserSelectionTextNode(value: unknown, resolved = false): any {
  shape('BrowserSelectionTextFieldsNode', value);
  const n = value as any;
  if (typeof n.name === 'string') unicode(n.name);
  input(n.selector, resolved); n.framePath.forEach(unicode);
  const keys = new Set<string>();
  for (const f of n.fields) {
    if (keys.has(f.key) || forbidden.includes(f.key)) throw Error('选区文字字段名重复或使用保留键');
    keys.add(f.key); input(f.selector, resolved); input(f.attribute, resolved);
  }
  return n;
}
export function assertBrowserSelectionTextInvocation(source: unknown, value: unknown): any {
  const original = assertBrowserSelectionTextNode(source);
  shape('BrowserSelectionTextFieldsInvocation', value);
  const { nodeInstance, ...resolved } = value as any;
  assertBrowserSelectionTextNode(resolved, true); unicode(nodeInstance);
  const { selector: originalRoot, fields: originalFields, ...fixed } = original;
  const { selector: actualRoot, fields: actualFields, ...received } = resolved;
  if (!same(fixed, received) || nodeInstance.split('/').at(-1) !== original.id ||
      (typeof originalRoot === 'string' && originalRoot !== actualRoot) ||
      originalFields.length !== actualFields.length) throw Error('选区文字调用与固定节点不一致');
  for (let i = 0; i < originalFields.length; i++) {
    const { selector: s, attribute: a, ...f } = originalFields[i];
    const { selector: rs, attribute: ra, ...rf } = actualFields[i];
    if (!same(f, rf) || (typeof s === 'string' && s !== rs) ||
        ((a === null || typeof a === 'string') && a !== ra)) throw Error('选区文字固定字段不一致');
  }
  return value;
}
function fieldStatus(f: any): string {
  if (f.count !== 1) {
    if (f.value !== null || f.issues.length) throw Error('非唯一选区文字不得带值或原因');
    return f.count === 0 ? 'missing' : 'ambiguous';
  }
  if (f.operation !== 'selection-text' && f.issues.length) throw Error('原始字段不得带选区文字原因');
  if (f.issues.length) {
    if (f.value !== null || !same(f.issues, issueOrder.filter(k => f.issues.includes(k))))
      throw Error('选区文字不可采用部分值或无序原因');
    if (f.issues.some((k: string) => k.startsWith('hidden-'))) return 'hidden';
    if (f.issues.some((k: string) => ['line-clamp', 'overflow-clip'].includes(k))) return 'clipped';
    return 'unsupported';
  }
  if (f.value === null) {
    if (f.operation !== 'attribute') throw Error('唯一文字字段不得无原因返回null');
    return 'missing-attribute';
  }
  return f.value.trim() ? 'ok' : 'empty';
}
export function assertBrowserSelectionTextResult(source: unknown, value: unknown): any {
  const n = assertBrowserSelectionTextNode(source, true);
  shape('BrowserSelectionTextFieldsResult', value);
  const r = value as any;
  if (r.selector !== n.selector || !same(r.framePath, n.framePath) ||
      r.fields.length !== n.fields.length || (!r.framePath.length && r.url !== r.documentUrl))
    throw Error('选区文字结果来源不一致');
  for (const u of [r.url, r.documentUrl]) { unicode(u); if (bytes(u) > browserSelectionTextLimits.urlBytes) throw Error('选区文字网址超限'); }
  let complete = true;
  for (let i = 0; i < r.fields.length; i++) {
    const f = r.fields[i], configured = n.fields[i];
    for (const k of ['key', 'selector', 'operation', 'attribute', 'required'])
      if (f[k] !== configured[k]) throw Error('选区文字字段顺序或配置不一致');
    if (f.ignoredAncestorSpaces + f.excludedAncestorDecorations > browserSelectionTextLimits.ancestorPseudos)
      throw Error('选区文字祖先伪元素计数超限');
    const status = fieldStatus(f);
    if (status !== f.status) throw Error('选区文字字段状态不一致');
    if (typeof f.value === 'string') {
      unicode(f.value);
      if (bytes(f.value) > (f.operation === 'selection-text' ? browserSelectionTextLimits.selectionFieldBytes : browserSelectionTextLimits.rawFieldBytes)) throw Error('选区文字单项超限');
    }
    if (['ambiguous', 'hidden', 'clipped', 'unsupported'].includes(status) || (f.required && status !== 'ok')) complete = false;
  }
  if (r.complete !== complete || bytes(JSON.stringify(r)) > browserSelectionTextLimits.resultBytes)
    throw Error('选区文字完整性或总结果字节不符');
  return r;
}
export function assertBrowserSelectionTextCapabilities(value: any, capabilities: string[], manifest?: any, entry?: any) {
  if (value?.type !== 'browser' || value.version !== 9) return;
  assertBrowserSelectionTextNode(value);
  const required = ['browser', browserSelectionTextCapability];
  if (!required.every(c => capabilities.includes(c))) throw Error('选区文字节点缺少browser或独立能力');
  if (!manifest) return;
  if (!entry || !required.every(c => entry.capabilities?.includes(c)) ||
      !manifest.resources.some((r: any) => r.kind === 'browser' && r.access === 'use' && entry.resources?.includes(r.id)))
    throw Error('选区文字入口未声明能力或自己的browser/use资源');
}
