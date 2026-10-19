/** Normative format and invocation relations only; never reads a browser or Store. */
import Ajv from 'ajv/dist/2020.js';
import schema from './p1.schema.json';

export const browserTargetCapability = 'browser-target-input-v1';
export const browserTargetLimits = { selectorScalars: 2000, frames: 8, readBytes: 65536 };
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema);
function shape(name: string, value: unknown) {
  const validate = ajv.getSchema(schema.$id + '#/$defs/' + name)!;
  if (!validate(value)) throw Error(name + '无效：' + ajv.errorsText(validate.errors));
}
function unicode(value: string) {
  if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(new TextEncoder().encode(value)) !== value)
    throw Error('网页目标含无效Unicode');
}
function reference(value: string) {
  unicode(value);
  const parts = value.split('.');
  if (parts.some(x => !x || ['__proto__', 'prototype', 'constructor'].includes(x)) ||
      !['params', 'steps', 'item', 'index'].includes(parts[0]) ||
      (['params', 'steps'].includes(parts[0]) && parts.length < 2) ||
      (parts[0] === 'index' && parts.length !== 1)) throw Error('网页目标引用无效');
}
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function assertBrowserTargetNode(value: unknown): any {
  shape('BrowserTargetNode', value);
  const node = value as any;
  if (typeof node.name === 'string') unicode(node.name);
  for (const part of node.framePath) unicode(part);
  if (typeof node.selector === 'string') unicode(node.selector);
  else reference(node.selector.$ref);
  return node;
}
export function assertBrowserTargetInvocation(source: unknown, value: unknown): any {
  const original = assertBrowserTargetNode(source);
  shape('BrowserTargetInvocation', value);
  const input = value as any;
  unicode(input.selector);
  unicode(input.nodeInstance);
  const { selector, ...fixed } = original;
  const { selector: resolved, nodeInstance, ...received } = input;
  if (!same(fixed, received) || nodeInstance.split('/').at(-1) !== original.id ||
      (typeof selector === 'string' && selector !== resolved)) throw Error('网页目标调用与固定节点不一致');
  return input;
}
export function assertBrowserTargetResult(operation: string, value: unknown): unknown {
  const names: Record<string, string> = { read: 'BrowserTargetReadResult', click: 'BrowserTargetClickResult', wait: 'BrowserTargetWaitResult' };
  if (!names[operation]) throw Error('网页目标操作无效');
  shape(names[operation], value);
  if (operation === 'read') {
    unicode(value as string);
    if (Buffer.byteLength(value as string, 'utf8') > browserTargetLimits.readBytes)
      throw Error('网页文字超过65536 UTF-8字节，未截断或采用');
  }
  return value;
}
export function assertBrowserTargetCapabilities(value: any, capabilities: string[], manifest?: any, entry?: any) {
  if (value?.type !== 'browser' || value.version !== 8) return;
  assertBrowserTargetNode(value);
  const required = ['browser', browserTargetCapability];
  if (!required.every(c => capabilities.includes(c))) throw Error('网页目标节点缺少browser或browser-target-input-v1能力');
  if (!manifest) return;
  if (!entry || !required.every(c => entry.capabilities?.includes(c)) ||
      !manifest.resources.some((r: any) => r.kind === 'browser' && r.access === 'use' && entry.resources?.includes(r.id)))
    throw Error('网页目标入口未声明能力或自己的browser/use资源');
  if (value.operation === 'click' && (!Array.isArray(entry.actions) || !entry.actions.length))
    throw Error('网页目标点击入口须声明独立动作；运行仍需核对授权');
}
