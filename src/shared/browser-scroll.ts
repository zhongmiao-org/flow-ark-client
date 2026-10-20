/** Normative shape and fixed-source relations; no browser, Host, Store or UI dependency. */
import {
  node_browser_12,
  browser_scroll_invocation_v1,
  browser_scroll_result_v1,
} from './node-schema.generated.js';
import type { BrowserCommand, Step } from './types';
export type BrowserScrollNode = Extract<Step, { type: 'browser'; version: 12 }>;
export const browserScrollCapability = 'browser-scroll-v1';
export const browserScrollLimits = {
  selectorScalars: 2000,
  frames: 8,
  ancestors: 64,
  distance: 2000,
};
const canonical = (v: any): any =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function shape(name: string, value: unknown) {
  const validate =
    name === 'BrowserScrollNode'
      ? node_browser_12
      : name === 'BrowserScrollInvocation'
        ? browser_scroll_invocation_v1
        : browser_scroll_result_v1;
  if (!validate(value)) throw Error('滚动配置、调用或回执无效，请核对目标和范围');
}
function unicode(v: string) {
  if (
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      new TextEncoder().encode(v),
    ) !== v
  )
    throw Error('滚动目标含无效Unicode');
}
export function assertBrowserScrollNode(value: unknown): any {
  shape('BrowserScrollNode', value);
  const n = value as any;
  if (n.name !== undefined) unicode(n.name);
  n.framePath.forEach(unicode);
  if (typeof n.selector === 'string') unicode(n.selector);
  else {
    unicode(n.selector.$ref);
    const p = n.selector.$ref.split('.');
    if (
      p.some((s: string) => !s || ['__proto__', 'prototype', 'constructor'].includes(s)) ||
      !['params', 'steps', 'item', 'index'].includes(p[0]) ||
      (['params', 'steps'].includes(p[0]) && p.length < 2) ||
      (p[0] === 'index' && p.length !== 1)
    )
      throw Error('滚动目标引用无效');
  }
  return n;
}
export function assertBrowserScrollInvocation(source: unknown, value: unknown): any {
  const n = assertBrowserScrollNode(source);
  shape('BrowserScrollInvocation', value);
  const v = value as any;
  unicode(v.selector);
  unicode(v.nodeInstance);
  const { selector, ...fixed } = n;
  const { selector: resolved, nodeInstance, ...received } = v;
  if (
    !same(fixed, received) ||
    nodeInstance.split('/').at(-1) !== n.id ||
    (typeof selector === 'string' && selector !== resolved)
  )
    throw Error('滚动调用与当前固定节点不一致');
  return v;
}
export function assertBrowserScrollResult(input: any, value: unknown): any {
  shape('BrowserScrollResult', value);
  const r = value as any;
  for (const k of ['url', 'documentUrl', 'selector']) unicode(r[k]);
  r.framePath.forEach(unicode);
  for (const key of ['url', 'documentUrl']) {
    const u = new URL(r[key]);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
      throw Error('滚动回执网址无效');
  }
  const delta = r.offsetAfter - r.offsetBefore;
  if (
    r.selector !== input.selector ||
    !same(r.framePath, input.framePath) ||
    r.direction !== input.direction ||
    r.distance !== input.distance ||
    (!input.framePath.length && r.url !== r.documentUrl) ||
    (r.region === 'target' && r.ancestorDepth !== 0) ||
    (r.region === 'ancestor' && r.ancestorDepth === 0) ||
    r.offsetBefore > Math.max(0, r.heightBefore - r.viewportBefore) + 1 ||
    r.offsetAfter > Math.max(0, r.heightAfter - r.viewportAfter) + 1 ||
    r.moved !== (delta !== 0) ||
    Math.abs(delta) > r.distance + 1 ||
    (r.direction === 'down' ? delta < 0 : delta > 0) ||
    r.atStart !== r.offsetAfter <= 0.5 ||
    r.atEnd !== r.offsetAfter >= Math.max(0, r.heightAfter - r.viewportAfter) - 0.5
  )
    throw Error('滚动回执与调用、实际位移或边界不一致');
  return r;
}
export function assertBrowserScrollCapabilities(
  node: any,
  caps: string[],
  manifest?: any,
  entry?: any,
) {
  if (node?.type !== 'browser' || node.version !== 12) return;
  assertBrowserScrollNode(node);
  const required = ['browser', browserScrollCapability];
  if (!required.every((c) => caps.includes(c)))
    throw Error('滚动节点缺少browser或browser-scroll-v1能力');
  if (
    manifest &&
    (!entry ||
      !required.every((c) => entry.capabilities?.includes(c)) ||
      !manifest.resources.some(
        (r: any) => r.kind === 'browser' && r.access === 'use' && entry.resources?.includes(r.id),
      ))
  )
    throw Error('滚动入口须声明自己的browser/use资源及能力');
}

/** Drivers receive only a bounded, already resolved command. */
export function resolvedBrowserScroll(command: BrowserCommand) {
  if (
    command.version !== 12 ||
    typeof command.selector !== 'string' ||
    command.fields ||
    command.value !== undefined
  )
    throw Error('滚动命令未解析或版本无效');
  const node = {
    id: 'driver',
    type: 'browser',
    version: 12,
    operation: command.operation,
    selector: command.selector,
    framePath: command.framePath ?? [],
    direction: command.direction,
    distance: command.distance,
    ...(command.timeoutMs !== undefined ? { timeoutMs: command.timeoutMs } : {}),
  };
  return assertBrowserScrollNode(node) as BrowserScrollNode & { selector: string };
}
