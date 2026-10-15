import { z } from 'zod';
import {
  conversation_snapshot_v1 as validateSnapshot,
  conversation_event_v1 as validateEvent,
  conversation_output_v1 as validateOutput,
} from './node-schema.generated.js';
import type { Step } from './types';
export type {
  ConversationSnapshot,
  ConversationEvent,
  ConversationOutput,
} from './contracts.generated';
import type { ConversationSnapshot, ConversationEvent } from './contracts.generated';
export type ConversationNode = Extract<Step, { type: 'conversation' }>;
export const conversationCapability = 'conversation-v1';
export function assertConversationOutput(
  v: unknown,
): asserts v is import('./contracts.generated').ConversationOutput {
  if (!validateOutput(v) || conversationBytes(v) > 2 * 1024 * 1024)
    throw Error('会话来源结果格式无效');
}
export const conversationBytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
export function assertConversationNode(node: ConversationNode) {
  if (typeof node.key === 'string' && (!node.key.trim() || node.key.length > 100))
    throw new Error('会话键须为 1–100 字符的非空白文本');
  if (!node.instructions.trim() || !node.title.trim()) throw new Error('会话标题与指令不能为空白');
  if (conversationBytes(node) > 1024 * 1024) throw new Error('会话配置超过 1 MiB');
}
export function assertConversation(value: unknown): asserts value is ConversationSnapshot {
  if (conversationBytes(value) > 1024 * 1024 || !validateSnapshot(value))
    throw new Error('会话快照格式或大小无效');
  const s = value as ConversationSnapshot;
  if (
    s.attempts.length > s.maxRequests ||
    new Set(s.messages.map((m) => m.id)).size !== s.messages.length ||
    new Set(s.attempts.map((a) => a.id)).size !== s.attempts.length
  )
    throw new Error('会话身份或请求数量无效');
  const last = s.attempts.at(-1);
  if ((s.status === 'generating') !== (last?.state === 'generating'))
    throw new Error('会话与请求状态不一致');
  if (s.status === 'confirmed' && (!s.confirmedAt || s.draft || last?.state !== 'complete'))
    throw new Error('会话尚不可确认');
}
export function conversationEvent(value: unknown): ConversationEvent {
  if (!validateEvent(value)) throw new Error('会话事件格式无效');
  const event = value as ConversationEvent;
  assertConversation(event.snapshot);
  const last = event.snapshot.attempts.at(-1);
  if (
    event.sessionId !== event.snapshot.id ||
    event.sequence !== event.snapshot.sequence ||
    event.eventId !== `${event.sessionId}:${event.sequence}` ||
    event.requestId !== (last?.id ?? null) ||
    event.turnId !== (last?.turnId ?? null)
  )
    throw new Error('会话事件身份或序号不一致');
  return event;
}
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const conversationMethods = {
  'conversation.detail': z.object({ id }).strict(),
  'conversation.draft': z.object({ id, revision, text: z.string().max(4000) }).strict(),
  'conversation.send': z
    .object({
      id,
      revision,
      requestId: id,
      text: z.string().trim().min(1).max(4000),
      reviewed: z.literal(true),
    })
    .strict(),
  'conversation.retry': z
    .object({ id, revision, requestId: id, reviewed: z.literal(true) })
    .strict(),
  'conversation.cancel': z.object({ id, requestId: id }).strict(),
  'conversation.confirm': z.object({ id, revision }).strict(),
};
