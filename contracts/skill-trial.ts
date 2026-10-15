/** Normative JSON checks only; local ownership, transactions and Key access remain host duties. */
import Ajv from 'ajv/dist/2020.js';
import schema from './p1.schema.json';
import { canonical, sha256 } from './package-format';

const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema);
export const SKILL_TRIAL_LIMITS = { bytes: 2 * 1024 * 1024, values: 50000, depth: 40, requests: 10 };
const editable = new Set(['draft', 'failed', 'conflict']);
function budget(value: unknown) {
  let count = 0;
  const seen = new Set<object>();
  const unicode = (text: string) => {
    if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.from(text)) !== text)
      throw Error('来源或试聊含无效Unicode');
  };
  const visit = (v: any, depth: number) => {
    if (++count > SKILL_TRIAL_LIMITS.values || depth > SKILL_TRIAL_LIMITS.depth)
      throw Error('来源或试聊数据层级或数量超限');
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (typeof v === 'string') { unicode(v); return; }
    if (!v || typeof v !== 'object' || seen.has(v) ||
      (!Array.isArray(v) && ![null, Object.prototype].includes(Object.getPrototypeOf(v))))
      throw Error('来源与试聊只接受有限JSON');
    seen.add(v);
    if (Array.isArray(v) && (Object.keys(v).length !== v.length ||
      Object.keys(v).some((key, index) => key !== String(index)))) throw Error('数组须连续');
    for (const [key, child] of Object.entries(v)) {
      unicode(key);
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw Error('含保留键');
      visit(child, depth + 1);
    }
    seen.delete(v);
  };
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > SKILL_TRIAL_LIMITS.bytes)
    throw Error('来源或试聊数据超过2MiB');
}
function shape(name: string, value: unknown): any {
  budget(value);
  const check = ajv.getSchema(schema.$id + '#/$defs/' + name)!;
  if (!check(value)) throw Error(name + '格式无效：' + ajv.errorsText(check.errors));
  return value;
}
const hash = (value: unknown) => sha256(Buffer.from(canonical(value), 'utf8'));
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

export function confirmedConversationEvidence(value: unknown): any {
  const s = shape('ConversationSnapshot', value);
  if (s.status !== 'confirmed' || !s.confirmedAt || !Number.isFinite(Date.parse(s.confirmedAt)) ||
    s.draft || s.attempts.at(-1)?.state !== 'complete' || s.skillTrial)
    throw Error('来源须为已确认的普通会话；试聊不自动成为事实来源');
  if (s.attempts.length > s.maxRequests ||
    new Set(s.messages.map((m: any) => m.id)).size !== s.messages.length ||
    new Set(s.attempts.map((a: any) => a.id)).size !== s.attempts.length ||
    s.attempts.some((a: any) => a.state === 'generating'))
    throw Error('会话来源身份或请求状态不一致');
  for (const m of s.messages) {
    if (m.role !== 'assistant' || m.state !== 'complete') continue;
    if (!s.attempts.some((a: any) => a.id === m.requestId && a.turnId === m.turnId && a.state === 'complete') ||
      !s.messages.some((u: any) => u.role === 'user' && u.turnId === m.turnId && u.state === 'complete'))
      throw Error('完整回复缺少对应请求或用户轮次');
  }
  return shape('ConversationEvidence', {
    kind: 'conversation', label: s.title, sessionId: s.id, revision: s.revision,
    sequence: s.sequence, sha256: hash({ version: 1, snapshot: s }),
  });
}
export function verifyConversationEvidence(value: unknown, confirmedSnapshot: unknown): any {
  const e = shape('ConversationEvidence', value), actual = confirmedConversationEvidence(confirmedSnapshot);
  // Labels are user-editable display text. Identity and digest always come from the saved snapshot.
  if (!same({ ...e, label: '' }, { ...actual, label: '' })) throw Error('会话来源与本机确认记录不一致');
  return e;
}
export function conversationOutput(value: unknown): any {
  const s = shape('ConversationSnapshot', value);
  const confirmed = s.status === 'confirmed';
  return shape('ConversationOutput', {
    sessionId: s.id, status: s.status, revision: s.revision, sequence: s.sequence,
    transcript: confirmed ? s.messages.filter((m: any) => m.state === 'complete')
      .map((m: any) => ({ role: m.role, text: m.text })) : [],
    evidence: confirmed ? confirmedConversationEvidence(s) : null,
  });
}
export function validateConversationOutput(value: unknown, confirmedSnapshot?: unknown): any {
  const v = shape('ConversationOutput', value);
  if (v.evidence && (v.evidence.sessionId !== v.sessionId || v.evidence.revision !== v.revision ||
    v.evidence.sequence !== v.sequence)) throw Error('会话输出与来源身份不一致');
  if (confirmedSnapshot !== undefined && !same(v, conversationOutput(confirmedSnapshot)))
    throw Error('会话输出与真实快照不一致');
  return v;
}
export function skillTrialDigest(key: unknown, base: unknown, draft: unknown): string {
  const body = { version: 1, key, base, draft };
  budget(body);
  shape('SkillDraft', draft);
  // Reuse the preview schema to validate the key and optional parent reference.
  shape('SkillTrialPreview', {
    ...body, source: { version: 1, proposalId: 'shape-only', revision: 1, sha256: '0'.repeat(64) },
  });
  return hash(body);
}
export function skillTrialPreview(value: unknown): any {
  const s = shape('SkillProposalSnapshot', value);
  if (!editable.has(s.status)) throw Error('当前草稿状态不能建立试聊');
  return shape('SkillTrialPreview', {
    version: 1,
    source: { version: 1, proposalId: s.id, revision: s.revision,
      sha256: skillTrialDigest(s.key, s.base, s.draft) },
    key: s.key, base: s.base, draft: s.draft,
  });
}
export function validateSkillTrialPreview(value: unknown, proposal?: unknown): any {
  const p = shape('SkillTrialPreview', value);
  if (p.source.sha256 !== skillTrialDigest(p.key, p.base, p.draft)) throw Error('试聊预览摘要不一致');
  if (proposal !== undefined && !same(p, skillTrialPreview(proposal))) throw Error('草稿已变化，请重新核对');
  return p;
}
export function validateSkillTrialRequest(value: unknown, preview?: unknown): any {
  const r = shape('SkillTrialRequest', value);
  if (!r.model.trim()) throw Error('模型标识不能为空白');
  if (preview !== undefined && !same(r.source, validateSkillTrialPreview(preview).source))
    throw Error('试聊请求不是当前核对的草稿');
  return r;
}
export function validateSkillTrialResult(value: unknown, request?: unknown): any {
  const r = shape('SkillTrialResult', value);
  if (request !== undefined) {
    const q = validateSkillTrialRequest(request);
    if (q.requestId !== r.requestId || !same(q.source, r.source)) throw Error('试聊回执身份不一致');
  }
  return r;
}
export function validateSkillTrialStatus(value: unknown): any {
  const v = shape('SkillTrialStatus', value);
  const matches = v.current && v.current.revision === v.source.revision &&
    v.current.sha256 === v.source.sha256;
  if (v.usable !== (v.reason === 'ready') ||
    (v.usable && (!matches || !editable.has(v.current.status))) ||
    (v.reason === 'unavailable' && v.current !== null) ||
    (v.reason !== 'unavailable' && v.current === null) ||
    (v.reason === 'changed' && matches) ||
    (v.reason === 'blocked' && editable.has(v.current?.status)))
    throw Error('试聊可用状态与当前草稿不一致');
  return v;
}
