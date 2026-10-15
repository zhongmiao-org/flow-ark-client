import { node_browser_4 } from './node-schema.generated.js';
import type { Step } from './types';

export type BrowserInspectionNode = Extract<Step, { type: 'browser'; version: 4 }>;
export const browserInspectionCapability = 'browser-observe-v1';
const encoder = new TextEncoder();
function unicode(text: string) {
  if (
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(encoder.encode(text)) !== text
  )
    throw Error('网页只读参数或结果含无效Unicode');
}
export function assertBrowserInspectionNode(
  value: unknown,
  resolved = false,
): asserts value is BrowserInspectionNode {
  if (!node_browser_4(value)) throw Error('网页只读配置无效，请核对目标、属性名和框架路径');
  const node = value as BrowserInspectionNode;
  for (const field of [node.selector, node.value]) {
    if (typeof field === 'string') unicode(field);
    else if (field && typeof field === 'object') {
      if (resolved) throw Error('网页只读参数尚未解析');
      const reference = field.$ref;
      const parts = reference.split('.');
      if (
        parts.some((p) => !p || ['__proto__', 'prototype', 'constructor'].includes(p)) ||
        !['params', 'steps', 'item', 'index'].includes(parts[0]) ||
        (['params', 'steps'].includes(parts[0]) && parts.length < 2) ||
        (parts[0] === 'index' && parts.length !== 1)
      )
        throw Error('网页只读参数引用无效');
      unicode(reference);
    }
  }
  for (const part of node.framePath) unicode(part);
}
export function assertBrowserInspectionResult(operation: string, result: unknown): unknown {
  if (operation === 'count') {
    if (!Number.isSafeInteger(result) || (result as number) < 0)
      throw Error('元素统计结果须为非负安全整数');
    return result;
  }
  if (operation === 'attribute' && result === null) return null;
  if (!['url', 'attribute'].includes(operation) || typeof result !== 'string')
    throw Error('网页只读结果类型无效');
  unicode(result);
  if (encoder.encode(result).length > (operation === 'url' ? 16384 : 65536))
    throw Error('网页只读结果超限，未截断或采用');
  return result;
}
