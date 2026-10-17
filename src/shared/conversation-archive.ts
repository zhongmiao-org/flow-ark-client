import { z } from 'zod';
import {
  archive_capture_v1,
  archive_manifest_v1,
  archive_page_v1,
  archive_record_v1,
} from './node-schema.generated';
import { conversationBytes } from './conversation';
import type {
  ConversationArchiveCapture,
  ConversationArchiveManifest,
  ConversationArchiveRef,
  ConversationArchivePage,
} from './contracts.generated';
export type {
  ConversationArchiveCapture,
  ConversationArchiveManifest,
  ConversationArchiveRef,
  ConversationArchivePage,
  ConversationArchiveRecord,
  ConversationArchiveCursor,
} from './contracts.generated';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  sha = z.string().regex(/^[a-f0-9]{64}$/);
const number = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  revision = number.min(1);
const ref = z.object({ version: z.literal(1), archiveId: id, sessionId: id, sha256: sha }).strict();
const cursor = z.object({ source: ref, nextOrdinal: revision, previousHash: sha }).strict();
const operation = z
  .object({
    version: z.literal(1),
    id,
    sessionId: id,
    requestId: id,
    revision,
    capture: z.unknown(),
    state: z.enum(['preparing', 'review', 'confirmed', 'cancelled', 'failed']),
    recordCount: number,
    requestCount: number,
    verifiedRecords: number,
    totalRequests: revision,
    manifest: z.unknown().nullable(),
    confirmedAt: z.string().max(100).nullable(),
    error: z.string().max(2000),
    createdAt: z.string().max(100),
    updatedAt: z.string().max(100),
  })
  .strict();
export type ArchiveOperation = Omit<z.infer<typeof operation>, 'capture' | 'manifest'> & {
  capture: ConversationArchiveCapture;
  manifest: ConversationArchiveManifest | null;
};
export type ArchiveView = {
  operation: ArchiveOperation;
  headRevision: number;
  current: boolean;
  currentError: string;
  source: ConversationArchiveRef | null;
};
export type ArchiveEvent = {
  kind: 'conversation.archive.snapshot';
  sessionId: string;
  archiveId: string;
  eventId: string;
  sequence: number;
  snapshot: ArchiveView;
};
export function assertArchiveView(value: unknown): asserts value is ArchiveView {
  if (conversationBytes(value) > 65536) throw Error('完整来源进度超过预算');
  const v = z
    .object({
      operation,
      headRevision: revision,
      current: z.boolean(),
      currentError: z.string().max(2000),
      source: ref.nullable(),
    })
    .strict()
    .parse(value);
  const s = v.operation,
    c = s.capture as ConversationArchiveCapture,
    m = s.manifest as ConversationArchiveManifest | null;
  if (
    !archive_capture_v1(c) ||
    c.sessionId !== s.sessionId ||
    s.verifiedRecords > s.recordCount ||
    s.requestCount > s.totalRequests ||
    (s.state === 'review' || s.state === 'confirmed') !== !!m ||
    (s.state === 'confirmed') !== !!s.confirmedAt ||
    (s.state === 'confirmed') !== !!v.source
  )
    throw Error('完整来源进度身份或状态无效');
  if (
    m &&
    (!archive_manifest_v1(m) ||
      m.id !== s.id ||
      m.capture.sessionId !== s.sessionId ||
      m.recordCount !== s.recordCount ||
      m.requestCount !== s.requestCount ||
      s.requestCount !== s.totalRequests)
  )
    throw Error('完整来源清单与进度不一致');
  if (
    v.source &&
    (v.source.archiveId !== s.id ||
      v.source.sessionId !== s.sessionId ||
      v.source.sha256 !== m?.sha256)
  )
    throw Error('完整来源确认引用不一致');
}
export function archiveEvent(value: unknown): ArchiveEvent {
  const v = value as ArchiveEvent;
  assertArchiveView(v.snapshot);
  if (
    v.kind !== 'conversation.archive.snapshot' ||
    v.sessionId !== v.snapshot.operation.sessionId ||
    v.archiveId !== v.snapshot.operation.id ||
    v.sequence !== v.snapshot.operation.revision ||
    v.eventId !== `archive:${v.archiveId}:${v.sequence}`
  )
    throw Error('完整来源事件身份或序号无效');
  return v;
}
export function assertArchivePage(value: unknown): asserts value is ConversationArchivePage {
  if (conversationBytes(value) > 2 * 1024 * 1024 || !archive_page_v1(value))
    throw Error('完整来源页格式或大小无效');
}
// Browser implementation of the pinned canonical SHA rules; no runtime Ajv code generation.
const canonicalValue = (v: any): any =>
  Array.isArray(v)
    ? v.map(canonicalValue)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonicalValue(v[k])]),
        )
      : v;
export const browserHash = async (value: any) => {
  const { sha256: _sha, ...body } = value;
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalValue(body)));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
};
export async function verifyArchivePage(
  value: unknown,
  manifest: ConversationArchiveManifest,
  expected: import('./contracts.generated').ConversationArchiveCursor,
  previous: import('./contracts.generated').ConversationArchiveRecord | null,
) {
  assertArchivePage(value);
  const p = value;
  if (
    (await browserHash(manifest)) !== manifest.sha256 ||
    (await browserHash(p)) !== p.sha256 ||
    JSON.stringify(canonicalValue(p.cursor)) !== JSON.stringify(canonicalValue(expected)) ||
    p.cursor.source.archiveId !== manifest.id ||
    p.cursor.source.sessionId !== manifest.capture.sessionId ||
    p.cursor.source.sha256 !== manifest.sha256
  )
    throw Error('完整来源页与固定引用不一致');
  let ordinal = expected.nextOrdinal,
    hash = expected.previousHash;
  if (
    ordinal === 1
      ? hash !== manifest.rootHash
      : previous?.ordinal !== ordinal - 1 || previous.sha256 !== hash
  )
    throw Error('完整来源页缺少前序核对');
  for (const r of p.records) {
    if (
      r.archiveId !== manifest.id ||
      r.ordinal !== ordinal ||
      r.previousHash !== hash ||
      r.ordinal > manifest.recordCount ||
      (await browserHash(r)) !== r.sha256
    )
      throw Error('完整来源页重复、乱序或摘要不同');
    ordinal++;
    hash = r.sha256;
  }
  if (
    p.next
      ? p.next.nextOrdinal !== ordinal ||
        p.next.previousHash !== hash ||
        JSON.stringify(canonicalValue(p.next.source)) !==
          JSON.stringify(canonicalValue(expected.source)) ||
        ordinal > manifest.recordCount
      : ordinal !== manifest.recordCount + 1 || hash !== manifest.tailHash
  )
    throw Error('完整来源页终点无效');
  return p;
}
export async function verifyArchiveRecord(value: unknown, archiveId: string, ordinal: number) {
  const r = value as import('./contracts.generated').ConversationArchiveRecord;
  if (
    conversationBytes(value) > 1024 * 1024 + 4096 ||
    !archive_record_v1(value) ||
    r.archiveId !== archiveId ||
    r.ordinal !== ordinal ||
    (await browserHash(r)) !== r.sha256
  )
    throw Error('来源原记录的身份、摘要或预算无效');
  return r;
}
const base = { id, operationId: id };
export const archiveMethods = {
  'conversation.archive.latest': z.object({ id }).strict(),
  'conversation.archive.receipt': z.object({ id, requestId: id }).strict(),
  'conversation.archive.detail': z.object(base).strict(),
  'conversation.archive.prepare': z.object({ id, revision, requestId: id }).strict(),
  'conversation.archive.cancel': z.object({ ...base, revision }).strict(),
  'conversation.archive.resume': z.object({ ...base, revision }).strict(),
  'conversation.archive.page': z.object({ ...base, cursor: cursor.nullable() }).strict(),
  'conversation.archive.preview': z.object({ ...base, revision }).strict(),
  'conversation.archive.confirm': z
    .object({
      ...base,
      revision,
      requestId: id,
      token: sha,
      sha256: sha,
      reviewed: z.literal(true),
    })
    .strict(),
};
