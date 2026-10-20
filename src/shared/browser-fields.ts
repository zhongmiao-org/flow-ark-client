import {
  node_browser_5,
  node_browser_6,
  node_browser_7,
  node_browser_9,
  node_browser_10,
  node_browser_11,
  browser_visible_text_result_v6,
  browser_visible_text_invocation_v1,
  browser_empty_leaf_text_result_v5,
  browser_empty_leaf_text_invocation_v1,
  browser_fields_result_v1,
  browser_rendered_fields_result_v2,
  browser_scoped_rendered_fields_result_v3,
  browser_selection_text_result_v4,
  browser_selection_text_invocation_v1,
} from './node-schema.generated.js';
import type { Step } from './types';
import type {
  BrowserFieldsResult,
  BrowserRenderedFieldsResult,
  BrowserScopedRenderedFieldsResult,
  BrowserSelectionTextFieldsResult,
  BrowserEmptyLeafTextFieldsResult,
  BrowserVisibleTextFieldsResult,
} from './contracts.generated';

export type BrowserFieldsNode = Extract<
  Step,
  { type: 'browser'; version: 5 | 6 | 7 | 9 | 10 | 11 }
>;
export type ResolvedBrowserFieldsNode = Omit<BrowserFieldsNode, 'selector' | 'fields'> & {
  renderPolicy?:
    | 'bounded-selection-text-v1'
    | 'bounded-selection-text-v2'
    | 'bounded-visible-text-v1';
  selector: string;
  fields: (Omit<BrowserFieldsNode['fields'][number], 'selector' | 'attribute'> & {
    selector: string;
    attribute: string | null;
  })[];
};
export const browserFieldsCapability = 'browser-fields-v1';
export const browserRenderedFieldsCapability = 'browser-rendered-fields-v1';
export const browserScopedRenderedFieldsCapability = 'browser-rendered-fields-v2';
export const browserVisibleTextCapability = 'browser-visible-text-v1';
export const browserEmptyLeafTextCapability = 'browser-empty-leaf-text-v1';
export const browserSelectionTextCapability = 'browser-selection-text-v1';
export type BrowserCollectedResult =
  | BrowserFieldsResult
  | BrowserRenderedFieldsResult
  | BrowserScopedRenderedFieldsResult
  | BrowserSelectionTextFieldsResult
  | BrowserEmptyLeafTextFieldsResult
  | BrowserVisibleTextFieldsResult;
export const renderedIssueOrder = [
  'hidden-target',
  'hidden-descendant',
  'line-clamp',
  'overflow-clip',
  'unsupported-layout',
  'embedded-content',
  'generated-content',
] as const;
export function browserFieldsCapabilityFor(version: number) {
  return version === 11
    ? browserVisibleTextCapability
    : version === 10
      ? browserEmptyLeafTextCapability
      : version === 9
        ? browserSelectionTextCapability
        : version === 7
          ? browserScopedRenderedFieldsCapability
          : version === 6
            ? browserRenderedFieldsCapability
            : browserFieldsCapability;
}
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
  if (
    !node_browser_5(value) &&
    !node_browser_6(value) &&
    !node_browser_7(value) &&
    !node_browser_9(value) &&
    !node_browser_10(value) &&
    !node_browser_11(value)
  )
    throw Error('关联字段配置无效，请核对根定位、字段名、相对定位和读取方式');
  const n = value as BrowserFieldsNode;
  if ((n.version === 9 || n.version === 10 || n.version === 11) && typeof n.name === 'string')
    unicode(n.name);
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
  source: unknown,
  value: unknown,
): ResolvedBrowserFieldsNode {
  assertBrowserFieldsNode(source);
  const n = resolvedBrowserFields(value);
  if (
    (source.version === 9 || source.version === 10 || source.version === 11) &&
    (!('renderPolicy' in n) || source.renderPolicy !== n.renderPolicy)
  )
    throw Error('选区文字政策与固定节点不一致');
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
export function assertBrowserSelectionTextInvocation(source: unknown, value: unknown) {
  if (!browser_selection_text_invocation_v1(value)) throw Error('选区文字调用未解析或格式无效');
  const { nodeInstance, ...input } =
    value as import('./contracts.generated').BrowserSelectionTextFieldsInvocation;
  unicode(nodeInstance);
  const node = assertBrowserFieldsInvocation(source, input);
  if (node.version !== 9 || nodeInstance.split('/').at(-1) !== node.id)
    throw Error('选区文字调用身份与固定节点不符');
  return node;
}
export function assertBrowserEmptyLeafTextInvocation(source: unknown, value: unknown) {
  if (!browser_empty_leaf_text_invocation_v1(value)) throw Error('空叶子文字调用未解析或格式无效');
  const { nodeInstance, ...input } =
    value as import('./contracts.generated').BrowserEmptyLeafTextFieldsInvocation;
  unicode(nodeInstance);
  const node = assertBrowserFieldsInvocation(source, input);
  if (node.version !== 10 || nodeInstance.split('/').at(-1) !== node.id)
    throw Error('空叶子文字调用身份与固定节点不符');
  return node;
}
export function assertBrowserVisibleTextInvocation(source: unknown, value: unknown) {
  if (!browser_visible_text_invocation_v1(value)) throw Error('可见文字调用未解析或格式无效');
  const { nodeInstance, ...input } =
    value as import('./contracts.generated').BrowserVisibleTextFieldsInvocation;
  unicode(nodeInstance);
  const node = assertBrowserFieldsInvocation(source, input);
  if (node.version !== 11 || nodeInstance.split('/').at(-1) !== node.id)
    throw Error('可见文字调用身份与固定节点不符');
  return node;
}
export function assertBrowserSelectionTextCapabilities(
  value: any,
  capabilities: string[],
  manifest?: any,
  entry?: any,
) {
  if (value?.type !== 'browser' || ![9, 10, 11].includes(value.version)) return;
  assertBrowserFieldsNode(value);
  const required = ['browser', browserFieldsCapabilityFor(value.version)];
  if (!required.every((c) => capabilities.includes(c)))
    throw Error('选区文字节点缺少browser或独立能力');
  if (
    manifest &&
    (!entry ||
      !required.every((c) => entry.capabilities?.includes(c)) ||
      !manifest.resources.some(
        (r: any) => r.kind === 'browser' && r.access === 'use' && entry.resources?.includes(r.id),
      ))
  )
    throw Error('选区文字入口未声明能力或自己的browser/use资源');
}
export function assertBrowserFieldsResult(
  node: ResolvedBrowserFieldsNode,
  value: unknown,
): asserts value is BrowserCollectedResult {
  resolvedBrowserFields(node);
  if (
    !(node.version === 11
      ? browser_visible_text_result_v6(value)
      : node.version === 10
        ? browser_empty_leaf_text_result_v5(value)
        : node.version === 9
          ? browser_selection_text_result_v4(value)
          : node.version === 7
            ? browser_scoped_rendered_fields_result_v3(value)
            : node.version === 6
              ? browser_rendered_fields_result_v2(value)
              : browser_fields_result_v1(value))
  )
    throw Error('关联字段结果格式无效');
  const r = value as BrowserCollectedResult;
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
  let excludedHiddenEmptyLeaves = 0;
  let excludedHiddenTextLeaves = 0;
  for (let i = 0; i < node.fields.length; i++) {
    const f = r.fields[i],
      configured = node.fields[i];
    for (const key of ['key', 'selector', 'operation', 'attribute', 'required'] as const)
      if (f[key] !== configured[key]) throw Error('关联字段顺序或配置不符');
    if (typeof f.value === 'string') {
      unicode(f.value);
      if (
        encoder.encode(f.value).length >
        (['rendered-text', 'selection-text'].includes(f.operation) ? 65536 : 8192)
      )
        throw Error('关联字段单项结果超限');
    }
    if ('excludedHiddenTextLeaves' in f) {
      if ((f.operation !== 'selection-text' || f.count !== 1) && f.excludedHiddenTextLeaves !== 0)
        throw Error('隐藏文字叶子计数不属于唯一选区字段');
      excludedHiddenTextLeaves += f.excludedHiddenTextLeaves;
    }
    if ('excludedHiddenEmptyLeaves' in f) {
      if ((f.operation !== 'selection-text' || f.count !== 1) && f.excludedHiddenEmptyLeaves !== 0)
        throw Error('空叶子计数不属于唯一选区文字字段');
      excludedHiddenEmptyLeaves += f.excludedHiddenEmptyLeaves;
    }
    const issues: readonly string[] = 'issues' in f ? f.issues : [];
    if (
      'ignoredAncestorSpaces' in f &&
      (!['rendered-text', 'selection-text'].includes(f.operation) || f.count !== 1) &&
      f.ignoredAncestorSpaces !== 0
    )
      throw Error('祖先空格计数不属于唯一正文字段');
    if (
      'excludedAncestorDecorations' in f &&
      (((f.operation !== 'selection-text' || f.count !== 1) &&
        f.excludedAncestorDecorations !== 0) ||
        f.ignoredAncestorSpaces + f.excludedAncestorDecorations > 128)
    )
      throw Error('选区外装饰计数不属于本次文字选区或超限');
    if (
      issues.length &&
      (!['rendered-text', 'selection-text'].includes(f.operation) ||
        f.count !== 1 ||
        f.value !== null ||
        JSON.stringify(issues) !==
          JSON.stringify(renderedIssueOrder.filter((v) => issues.includes(v))))
    )
      throw Error('正文原因、范围或值不一致');
    const status =
      f.count === 0
        ? 'missing'
        : f.count > 1
          ? 'ambiguous'
          : issues.some((v) => v.startsWith('hidden-'))
            ? 'hidden'
            : issues.some((v) => v === 'line-clamp' || v === 'overflow-clip')
              ? 'clipped'
              : issues.length
                ? 'unsupported'
                : f.value === null
                  ? 'missing-attribute'
                  : f.value.trim() === ''
                    ? 'empty'
                    : 'ok';
    if (
      f.status !== status ||
      (f.count === 1 && f.operation !== 'attribute' && !issues.length && f.value === null) ||
      (f.count !== 1 && f.value !== null)
    )
      throw Error('关联字段计数、值或状态不一致');
    if (
      ['ambiguous', 'hidden', 'clipped', 'unsupported'].includes(status) ||
      (f.required && status !== 'ok')
    )
      complete = false;
  }
  if (excludedHiddenEmptyLeaves > 2000) throw Error('隐藏空叶子排除总数超限');
  if (excludedHiddenTextLeaves > 2000) throw Error('隐藏文字叶子排除总数超限');
  if (r.complete !== complete) throw Error('关联字段完整性不符');
  if (encoder.encode(JSON.stringify(r)).length > (node.version >= 6 ? 131072 : 65536))
    throw Error('关联字段总结果超限，未截断或采用');
}
/** Structural rendering check; provenance is verified by the host, never inferred from this value. */
export function assertBrowserFieldsValue(value: unknown): asserts value is BrowserCollectedResult {
  if (
    !browser_fields_result_v1(value) &&
    !browser_rendered_fields_result_v2(value) &&
    !browser_scoped_rendered_fields_result_v3(value) &&
    !browser_selection_text_result_v4(value) &&
    !browser_empty_leaf_text_result_v5(value) &&
    !browser_visible_text_result_v6(value)
  )
    throw Error('关联字段结果格式无效');
  const r = value as BrowserCollectedResult;
  const n = resolvedBrowserFields({
    id: 'result',
    type: 'browser',
    version:
      r.version === 6
        ? 11
        : r.version === 5
          ? 10
          : r.version === 4
            ? 9
            : r.version === 3
              ? 7
              : r.version === 2
                ? 6
                : 5,
    ...(r.version >= 4 && 'renderPolicy' in r ? { renderPolicy: r.renderPolicy } : {}),
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
