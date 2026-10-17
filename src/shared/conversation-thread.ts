import { z } from 'zod';
import type { Step } from './types';
import { conversationBytes } from './conversation';
import {
  conversation_thread_snapshot_v2,
  conversation_thread_event_v2,
  conversation_history_page_v2,
  conversation_thread_output_v2,
  conversation_context_v2,
  conversation_thread_prepared_v2,
  conversation_checkpoint_v2,
} from './node-schema.generated';
import type {
  ConversationThreadSnapshot,
  ConversationThreadEvent,
  ConversationThreadEntry,
  ConversationThreadPrepared,
  ConversationHistoryPage,
  ConversationCheckpoint,
  ConversationContext,
  ConversationThreadOutput,
} from './contracts.generated';
export type {
  ConversationContext,
  ConversationContextRef,
  ConversationContextProposal,
  ConversationThreadSnapshot,
  ConversationThreadActive,
  ConversationThreadEntry,
  ConversationThreadEvent,
  ConversationThreadPrepared,
  ConversationHistoryPage,
  ConversationHistoryCursor,
  ConversationHistoryRef,
  ConversationHistorySelection,
  ConversationCheckpoint,
  ConversationCheckpointEvidence,
  ConversationThreadOutput,
} from './contracts.generated';
export type ThreadNode = Extract<Step, { type: 'conversation'; version: 2 }>;
export const threadCapability = 'conversation-v2';
export const checkpointCapability = 'conversation-checkpoint-v1';
export type ThreadPreparedPreview = {
  prepared: ConversationThreadPrepared;
  token: string;
  expiresAt: string;
};
export type ThreadCheckpointSource = Omit<ConversationCheckpoint, 'id' | 'confirmedAt' | 'sha256'>;
export type ThreadCheckpointPreview = {
  source: ThreadCheckpointSource;
  sha256: string;
  token: string;
  expiresAt: string;
};
export type ThreadReceipt = {
  requestId: string;
  preparedId: string;
  preparedHash: string;
  state: 'generating' | 'complete' | 'failed' | 'cancelled' | 'withdrawn';
  ordinal: number | null;
};

function bounded(value: unknown, check: (v: unknown) => boolean, bytes = 1024 * 1024) {
  if (conversationBytes(value) > bytes || !check(value)) throw Error('持续会话数据格式或大小无效');
}
export function assertThread(value: unknown): asserts value is ConversationThreadSnapshot {
  bounded(value, conversation_thread_snapshot_v2);
  const s = value as ConversationThreadSnapshot;
  if (
    (s.status === 'generating') !== !!s.active ||
    s.requestCount !== s.historyCount + (s.active ? 1 : 0) ||
    s.turnCount > s.requestCount ||
    (s.historyCount === 0) !== (s.lastEntry === null) ||
    (s.lastEntry &&
      (s.lastEntry.sessionId !== s.id ||
        s.lastEntry.ordinal !== s.historyCount ||
        s.lastEntry.sha256 !== s.historyHash)) ||
    (s.active &&
      (s.active.context.id !== s.context.id || s.active.context.sha256 !== s.context.sha256)) ||
    (s.checkpointCurrent && (!s.latestCheckpoint || s.active || s.draft || s.contextProposalId)) ||
    (s.latestCheckpoint && s.latestCheckpoint.sessionId !== s.id)
  )
    throw Error('持续会话身份或状态不一致');
}
export function threadEvent(value: unknown): ConversationThreadEvent {
  bounded(value, conversation_thread_event_v2);
  const e = value as ConversationThreadEvent;
  assertThread(e.snapshot);
  const a = e.snapshot.active ?? e.snapshot.lastEntry;
  if (
    e.sessionId !== e.snapshot.id ||
    e.sequence !== e.snapshot.sequence ||
    e.eventId !== `thread:${e.sessionId}:${e.sequence}` ||
    e.requestId !== (a?.requestId ?? null) ||
    e.turnId !== (a?.turnId ?? null)
  )
    throw Error('持续会话事件身份或序号不一致');
  return e;
}
export function assertThreadPage(value: unknown): asserts value is ConversationHistoryPage {
  bounded(value, conversation_history_page_v2, 2 * 1024 * 1024);
  const p = value as ConversationHistoryPage;
  for (let i = 0; i < p.entries.length; i++) {
    const e = p.entries[i];
    if (
      e.sessionId !== p.cursor.sessionId ||
      (i > 0 &&
        (e.ordinal !== p.entries[i - 1].ordinal + 1 || e.previousHash !== p.entries[i - 1].sha256))
    )
      throw Error('历史页身份或顺序不一致');
  }
  const last = p.entries.at(-1),
    first = p.entries[0];
  if (
    (last && (last.ordinal !== p.cursor.before - 1 || last.sha256 !== p.cursor.sha256)) ||
    (!last && (p.cursor.before !== 1 || p.next !== null)) ||
    (first &&
      (first.ordinal === 1
        ? p.next !== null
        : p.next?.sessionId !== p.cursor.sessionId ||
          p.next.before !== first.ordinal ||
          p.next.sha256 !== first.previousHash))
  )
    throw Error('历史页游标不一致');
}
export function assertThreadContext(value: unknown): asserts value is ConversationContext {
  bounded(value, conversation_context_v2);
}
export function assertThreadPrepared(value: unknown): asserts value is ConversationThreadPrepared {
  bounded(value, conversation_thread_prepared_v2);
}
export function assertThreadCheckpoint(value: unknown): asserts value is ConversationCheckpoint {
  bounded(value, conversation_checkpoint_v2);
}
export function assertThreadOutput(value: unknown): asserts value is ConversationThreadOutput {
  bounded(value, conversation_thread_output_v2);
  const v = value as ConversationThreadOutput;
  if (v.evidence && v.evidence.sessionId !== v.sessionId) throw Error('确认输出来源身份不一致');
}
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const selection = z
  .array(
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('origin'), requestId: id }).strict(),
      z.object({ kind: z.literal('history'), ordinal: revision, sha256 }).strict(),
    ]),
  )
  .max(24);
const cursor = z.object({ sessionId: id, before: revision, sha256 }).strict();
const text = z.string().min(1).max(4000);
export const threadMethods = {
  'conversation.thread.selection': z.object({ id }).strict(),
  'conversation.thread.detail': z.object({ id }).strict(),
  'conversation.thread.context': z.object({ id }).strict(),
  'conversation.thread.origin': z.object({ id }).strict(),
  'conversation.thread.output': z.object({ id }).strict(),
  'conversation.thread.continue': z.object({ id, revision }).strict(),
  'conversation.thread.history': z.object({ id, cursor: cursor.nullable() }).strict(),
  'conversation.thread.draft': z.object({ id, revision, text: z.string().max(4000) }).strict(),
  'conversation.thread.preview': z
    .object({ id, revision, text, selection, retryOf: id.nullable() })
    .strict(),
  'conversation.thread.send': z
    .object({
      id,
      revision,
      requestId: id,
      preparedId: id,
      sha256,
      token: sha256,
      reviewed: z.literal(true),
    })
    .strict(),
  'conversation.thread.receipt': z.object({ id, requestId: id }).strict(),
  'conversation.thread.withdraw': z
    .object({ id, requestId: id, preparedId: id, sha256, reviewed: z.literal(true) })
    .strict(),
  'conversation.thread.cancel': z.object({ id, requestId: id }).strict(),
  'conversation.thread.checkpoint.preview': z.object({ id, revision, selection }).strict(),
  'conversation.thread.checkpoint.confirm': z
    .object({ id, revision, requestId: id, token: sha256, sha256, reviewed: z.literal(true) })
    .strict(),
  'conversation.thread.checkpoint.detail': z.object({ id, checkpointId: id }).strict(),
  'conversation.thread.proposal': z.object({ id }).strict(),
  'conversation.thread.context.adopt': z
    .object({ id, revision, proposalId: id, accept: z.boolean(), reviewed: z.literal(true) })
    .strict(),
};
