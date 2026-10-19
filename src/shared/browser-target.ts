import type { BrowserTargetInvocation } from './contracts.generated';
import {
  node_browser_8,
  browser_target_invocation_v1,
  browser_target_click_result_v1,
  browser_target_wait_result_v1,
  browser_target_read_result_v1,
} from './node-schema.generated.js';
import type { BrowserCommand, Step } from './types';

export const browserTargetCapability = 'browser-target-input-v1';
export type BrowserTargetNode = Extract<Step, { type: 'browser'; version: 8 }>;
const encoder = new TextEncoder();
function unicode(value: string) {
  if (
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(encoder.encode(value)) !==
    value
  )
    throw Error('网页目标含无效Unicode');
}
export function assertBrowserTargetNode(value: unknown): asserts value is BrowserTargetNode {
  if (!node_browser_8(value)) throw Error('网页目标配置无效：请核对目标、框架与期限');
  const node = value as BrowserTargetNode;
  if (typeof node.name === 'string') unicode(node.name);
  node.framePath.forEach(unicode);
  if (typeof node.selector === 'string') unicode(node.selector);
  else {
    const ref = node.selector.$ref,
      parts = ref.split('.');
    unicode(ref);
    if (
      parts.some((p) => !p || ['__proto__', 'prototype', 'constructor'].includes(p)) ||
      !['params', 'steps', 'item', 'index'].includes(parts[0]) ||
      (['params', 'steps'].includes(parts[0]) && parts.length < 2) ||
      (parts[0] === 'index' && parts.length !== 1)
    )
      throw Error('网页目标引用无效');
  }
}
const canonical = (value: any): any =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
export function assertBrowserTargetInvocation(source: unknown, value: unknown) {
  assertBrowserTargetNode(source);
  if (!browser_target_invocation_v1(value)) throw Error('网页目标调用尚未解析或格式无效');
  const input = value as BrowserTargetInvocation;
  unicode(input.selector);
  unicode(input.nodeInstance);
  const { selector, ...fixed } = source;
  const { selector: resolved, nodeInstance, ...received } = input;
  if (
    JSON.stringify(canonical(fixed)) !== JSON.stringify(canonical(received)) ||
    nodeInstance.split('/').at(-1) !== source.id ||
    (typeof selector === 'string' && selector !== resolved)
  )
    throw Error('网页目标调用与固定节点不一致');
}
export function assertBrowserTargetCapabilities(
  value: any,
  capabilities: string[],
  manifest?: any,
  entry?: any,
) {
  if (value?.type !== 'browser' || value.version !== 8) return;
  assertBrowserTargetNode(value);
  const required = ['browser', browserTargetCapability];
  if (!required.every((c) => capabilities.includes(c)))
    throw Error('网页目标节点缺少browser或browser-target-input-v1能力');
  if (!manifest) return;
  if (
    !entry ||
    !required.every((c) => entry.capabilities?.includes(c)) ||
    !manifest.resources.some(
      (r: any) => r.kind === 'browser' && r.access === 'use' && entry.resources?.includes(r.id),
    )
  )
    throw Error('网页目标入口未声明能力或自己的browser/use资源');
  if (value.operation === 'click' && (!Array.isArray(entry.actions) || !entry.actions.length))
    throw Error('网页目标点击入口须声明独立动作；运行仍需核对授权');
}
export function assertBrowserTargetResult(operation: string, value: unknown) {
  const valid =
    operation === 'read'
      ? browser_target_read_result_v1(value)
      : operation === 'click'
        ? browser_target_click_result_v1(value)
        : operation === 'wait'
          ? browser_target_wait_result_v1(value)
          : false;
  if (!valid) throw Error('网页变量目标结果格式无效');
  if (operation === 'read') {
    unicode(value as string);
    if (encoder.encode(value as string).length > 65536)
      throw Error('网页文字超过65536 UTF-8字节，未截断或采用');
  }
}
/** Drivers accept only the already resolved, bounded v8 command. */
export function resolvedBrowserTarget(command: BrowserCommand) {
  if (command.version !== 8 || typeof command.selector !== 'string' || command.fields)
    throw Error('网页变量目标命令尚未解析或版本无效');
  const node = {
    id: 'driver',
    type: 'browser',
    version: 8,
    operation: command.operation,
    selector: command.selector,
    framePath: command.framePath ?? [],
    value: command.value,
    ...(command.timeoutMs !== undefined ? { timeoutMs: command.timeoutMs } : {}),
  };
  assertBrowserTargetNode(node);
  return node as BrowserTargetNode & { selector: string };
}
