/** Format/association reference only. Does not create permission or persistent receipts. */
import Ajv from 'ajv/dist/2020.js';
import schema from './p1.schema.json';

export const effectNodeCapability = 'effect-node-v1';
export const effectNodeLimits = { keyBytes: 4096, descriptionBytes: 4096, targetBytes: 16384, contentBytes: 262144, evidenceBytes: 131072, evidenceDepth: 32, evidenceNodes: 10000 };
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema);
const forbidden = ['__proto__', 'prototype', 'constructor'];
function shape(name: string, value: unknown) {
  const validate = ajv.getSchema(schema.$id + '#/$defs/' + name)!;
  if (!validate(value)) throw Error('操作记录格式无效：' + ajv.errorsText(validate.errors));
}
function unicode(value: string) {
  if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.from(value)) !== value) throw Error('操作记录含无效Unicode');
}
function reference(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, '$ref')) return false;
  const v = value as any;
  if (Object.keys(v).length !== 1 || typeof v.$ref !== 'string') throw Error('操作记录引用格式无效');
  unicode(v.$ref);
  const parts = v.$ref.split('.');
  if (parts.some((p: string) => !p || forbidden.includes(p)) || !['params', 'steps', 'item', 'index'].includes(parts[0]) || (['params', 'steps'].includes(parts[0]) && parts.length < 2) || (parts[0] === 'index' && parts.length !== 1)) throw Error('操作记录引用范围无效');
  return true;
}
function text(value: any, bytes: number, nonblank: boolean, resolved: boolean) {
  if (!resolved && reference(value)) return;
  if (typeof value !== 'string' || (nonblank && !value.trim())) throw Error('操作记录输入必须为有效文本');
  unicode(value);
  if (Buffer.byteLength(value) > bytes) throw Error('操作记录文本超限，未截断');
}
function evidence(value: any) {
  let count = 0;
  const stack = new Set<object>();
  const walk = (v: any, depth: number) => {
    if (++count > effectNodeLimits.evidenceNodes || depth > effectNodeLimits.evidenceDepth) throw Error('操作证据结构超限');
    if (typeof v === 'string') unicode(v);
    else if (typeof v === 'number') { if (!Number.isFinite(v)) throw Error('操作证据数字无效'); }
    else if (v === null || typeof v === 'boolean') return;
    else if (typeof v === 'object') {
      if (stack.has(v) || (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v)))) throw Error('操作证据不是JSON');
      stack.add(v);
      for (const [key, item] of Object.entries(v)) { unicode(key); if (forbidden.includes(key)) throw Error('操作证据含保留键'); walk(item, depth + 1); }
      stack.delete(v);
    } else throw Error('操作证据不是JSON');
  };
  walk(value, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > effectNodeLimits.evidenceBytes) throw Error('操作证据总量超限，未截断');
}
export function assertEffectPrepareResult(value: unknown, expected?: { action: string; key: string }): any {
  shape('EffectPrepareResult', value);
  const r = value as any;
  unicode(r.action); unicode(r.runId); text(r.key, effectNodeLimits.keyBytes, true, true);
  if (expected && (r.action !== expected.action || r.key !== expected.key)) throw Error('准备回执与本次输入不一致');
  return r;
}
export function assertEffectNode(value: unknown, resolved = false): any {
  shape('EffectNode', value);
  const n = value as any;
  if (n.operation === 'prepare') {
    text(n.key, effectNodeLimits.keyBytes, true, resolved);
    if (n.description !== undefined) text(n.description, effectNodeLimits.descriptionBytes, false, resolved);
    if (n.review) {
      text(n.review.target, effectNodeLimits.targetBytes, true, resolved);
      text(n.review.content, effectNodeLimits.contentBytes, false, resolved);
    }
  } else {
    if (!resolved && reference(n.receipt)) { /* host resolves the complete receipt */ }
    else {
      const r = assertEffectPrepareResult(n.receipt);
      if (!r.execute || r.state !== 'submitting') throw Error('已有或终态回执不可登记为本次结果');
    }
    if (n.evidence !== undefined && (resolved || !reference(n.evidence))) evidence(n.evidence);
  }
  return n;
}
export function assertEffectNodeCapabilities(value: any, capabilities: string[], manifest?: any, entry?: any) {
  if (value?.type !== 'effect') return;
  const n = assertEffectNode(value);
  const required = ['effect', effectNodeCapability, ...(n.review ? ['human-review-v1'] : [])];
  if (!required.every(c => capabilities.includes(c))) throw Error('操作节点缺少effect/effect-node-v1或人工核对能力');
  if (!manifest) return;
  if (!entry || !required.every(c => entry.capabilities?.includes(c)) || !entry.actions?.length) throw Error('操作节点必须属于声明动作的当前模板入口');
  if (n.operation === 'prepare' && (!entry.actions.includes(n.action) || !manifest.actions.some((a: any) => a.id === n.action))) throw Error('准备操作未由当前入口声明');
  if (n.operation === 'resolve' && !reference(n.receipt) && (!entry.actions.includes(n.receipt.action) || !manifest.actions.some((a: any) => a.id === n.receipt.action))) throw Error('结果回执的动作未由当前入口声明');
}
/** Host must additionally verify its persistent submitting record and current Run ownership. */
export function assertEffectResolveResult(node: unknown, value: unknown): any {
  const n = assertEffectNode(node, true);
  if (n.operation !== 'resolve') throw Error('结果不属于登记节点');
  shape('EffectResolveResult', value);
  const r = value as any;
  if (r.id !== n.receipt.id || r.state !== n.state) throw Error('登记结果与本次回执或状态不一致');
  return r;
}
