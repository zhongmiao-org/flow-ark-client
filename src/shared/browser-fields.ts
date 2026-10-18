import { node_browser_5, browser_fields_result_v1 } from './node-schema.generated.js';
import type { Step } from './types';
import type { BrowserFieldsResult } from './contracts.generated';

export type BrowserFieldsNode = Extract<Step, { type: 'browser'; version: 5 }>;
export type ResolvedBrowserFieldsNode = Omit<BrowserFieldsNode, 'selector' | 'fields'> & {
  selector: string;
  fields: (Omit<BrowserFieldsNode['fields'][number], 'selector' | 'attribute'> & {
    selector: string;
    attribute: string | null;
  })[];
};
export const browserFieldsCapability = 'browser-fields-v1';
const encoder = new TextEncoder();
const forbidden = ['__proto__', 'prototype', 'constructor'];
function unicode(text: string) {
  if (
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(encoder.encode(text)) !== text
  )
    throw Error('关联字段含无效Unicode');
}
function input(value: unknown, resolved: boolean) {
  if (value === null) return;
  if (typeof value === 'string') {
    unicode(value);
    return;
  }
  if (resolved) throw Error('关联字段引用尚未解析');
  const ref = (value as { $ref: string }).$ref;
  const parts = ref.split('.');
  if (
    parts.some((p) => !p || forbidden.includes(p)) ||
    !['params', 'steps', 'item', 'index'].includes(parts[0]) ||
    (['params', 'steps'].includes(parts[0]) && parts.length < 2) ||
    (parts[0] === 'index' && parts.length !== 1)
  )
    throw Error('关联字段引用无效');
  unicode(ref);
}
export function assertBrowserFieldsNode(
  value: unknown,
  resolved = false,
): asserts value is BrowserFieldsNode {
  if (!node_browser_5(value))
    throw Error('关联字段配置无效，请核对根定位、字段名、相对定位和读取方式');
  const n = value as BrowserFieldsNode;
  input(n.selector, resolved);
  n.framePath.forEach(unicode);
  const keys = new Set<string>();
  for (const f of n.fields) {
    if (keys.has(f.key) || forbidden.includes(f.key)) throw Error('关联字段名重复或使用保留键');
    keys.add(f.key);
    input(f.selector, resolved);
    input(f.attribute, resolved);
  }
}
export function resolvedBrowserFields(value: unknown): ResolvedBrowserFieldsNode {
  assertBrowserFieldsNode(value, true);
  return value as ResolvedBrowserFieldsNode;
}
export function assertBrowserFieldsInvocation(
  source: BrowserFieldsNode,
  value: unknown,
): ResolvedBrowserFieldsNode {
  assertBrowserFieldsNode(source);
  const n = resolvedBrowserFields(value);
  for (const key of ['id', 'type', 'version', 'operation', 'name', 'timeoutMs'] as const)
    if (source[key] !== n[key]) throw Error('关联字段不属于当前固定节点');
  const fixed = (a: unknown, b: unknown) => (typeof a === 'object' && a !== null) || a === b;
  if (
    !fixed(source.selector, n.selector) ||
    JSON.stringify(source.framePath) !== JSON.stringify(n.framePath) ||
    source.fields.length !== n.fields.length
  )
    throw Error('关联字段范围与固定节点不符');
  source.fields.forEach((f, i) => {
    const v = n.fields[i];
    if (
      f.key !== v.key ||
      f.operation !== v.operation ||
      f.required !== v.required ||
      !fixed(f.selector, v.selector) ||
      !fixed(f.attribute, v.attribute)
    )
      throw Error('关联字段顺序或配置与固定节点不符');
  });
  return n;
}
export function assertBrowserFieldsResult(
  node: ResolvedBrowserFieldsNode,
  value: unknown,
): asserts value is BrowserFieldsResult {
  resolvedBrowserFields(node);
  if (!browser_fields_result_v1(value)) throw Error('关联字段结果格式无效');
  const r = value as BrowserFieldsResult;
  if (
    r.selector !== node.selector ||
    JSON.stringify(r.framePath) !== JSON.stringify(node.framePath) ||
    r.fields.length !== node.fields.length
  )
    throw Error('关联字段结果不属于本次配置');
  if (!node.framePath.length && r.url !== r.documentUrl) throw Error('顶层采集文档网址不一致');
  for (const url of [r.url, r.documentUrl]) {
    unicode(url);
    if (encoder.encode(url).length > 16384) throw Error('关联字段网址超限');
  }
  let complete = true;
  for (let i = 0; i < node.fields.length; i++) {
    const f = r.fields[i],
      configured = node.fields[i];
    for (const key of ['key', 'selector', 'operation', 'attribute', 'required'] as const)
      if (f[key] !== configured[key]) throw Error('关联字段顺序或配置不符');
    if (typeof f.value === 'string') {
      unicode(f.value);
      if (encoder.encode(f.value).length > 8192) throw Error('关联字段单项结果超限');
    }
    const status =
      f.count === 0
        ? 'missing'
        : f.count > 1
          ? 'ambiguous'
          : f.value === null
            ? 'missing-attribute'
            : f.value.trim() === ''
              ? 'empty'
              : 'ok';
    if (
      f.status !== status ||
      (f.count === 1 && f.operation === 'text' && f.value === null) ||
      (f.count !== 1 && f.value !== null)
    )
      throw Error('关联字段计数、值或状态不一致');
    if (status === 'ambiguous' || (f.required && status !== 'ok')) complete = false;
  }
  if (r.complete !== complete) throw Error('关联字段完整性不符');
  if (encoder.encode(JSON.stringify(r)).length > 65536)
    throw Error('关联字段总结果超限，未截断或采用');
}
/** Structural rendering check; provenance is verified by the host, never inferred from this value. */
export function assertBrowserFieldsValue(value: unknown): asserts value is BrowserFieldsResult {
  if (!browser_fields_result_v1(value)) throw Error('关联字段结果格式无效');
  const r = value as BrowserFieldsResult;
  const n = resolvedBrowserFields({
    id: 'result',
    type: 'browser',
    version: 5,
    operation: 'collect',
    selector: r.selector,
    framePath: r.framePath,
    fields: r.fields.map(({ key, selector, operation, attribute, required }) => ({
      key,
      selector,
      operation,
      attribute,
      required,
    })),
  });
  assertBrowserFieldsResult(n, r);
}
