import { z } from 'zod';
import {
  source_cursor_v1,
  source_read_v1,
  source_manifest_output_v1,
} from './node-schema.generated';
import type { Step } from './types';
import { browserHash } from './conversation-archive';
export type SourceNode = Extract<Step, { type: 'source' }>;
export type {
  ConversationSourceCursor,
  ConversationSourceRead,
  ConversationSourceManifestOutput,
} from './contracts.generated';
export const sourceCapability = 'conversation-source-read-v1';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const sourceRefSchema = z
  .object({ version: z.literal(1), archiveId: id, sessionId: id, sha256: hash })
  .strict();
export const sourceTargetSchema = z
  .object({ kind: z.enum(['flow', 'instance']), id, revision: z.string().min(1).max(100) })
  .strict();
export type SourceTarget = z.infer<typeof sourceTargetSchema>;
export const sourceMethods = {
  'source.list': z
    .object({
      target: sourceTargetSchema,
      query: z.string().max(200),
      cursor: z
        .object({
          ceiling: z
            .number()
            .int()
            .min(0)
            .max(Number.MAX_SAFE_INTEGER - 1),
          before: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
          query: z.string().max(200),
        })
        .strict()
        .nullable(),
    })
    .strict(),
  'source.select': z
    .object({ target: sourceTargetSchema, binding: id, ref: sourceRefSchema })
    .strict(),
  'source.inspect': z
    .object({ target: sourceTargetSchema, binding: id, ref: sourceRefSchema })
    .strict(),
  'source.page': z
    .object({ target: sourceTargetSchema, binding: id, ref: sourceRefSchema, cursor: z.unknown() })
    .strict(),
  'source.runRecord': z
    .object({
      runId: id,
      nodeId: id,
      ordinal: z
        .number()
        .int()
        .min(1)
        .max(Number.MAX_SAFE_INTEGER - 1),
    })
    .strict(),
};
export function assertSourceCursor(v: unknown) {
  if (!source_cursor_v1(v)) throw Error('来源读取位置格式无效');
}
export function assertSourceResult(v: unknown) {
  if (
    new TextEncoder().encode(JSON.stringify(v)).length > 131072 ||
    (!source_read_v1(v) && !source_manifest_output_v1(v))
  )
    throw Error('来源读取结果格式或预算无效');
}
const refIdentity = (r: any) => JSON.stringify([r.version, r.archiveId, r.sessionId, r.sha256]);
export async function verifySourceResult(value: unknown) {
  assertSourceResult(value);
  const v = value as any;
  if (v.manifest) {
    if (
      (await browserHash(v.manifest)) !== v.manifest.sha256 ||
      v.source.archiveId !== v.manifest.id ||
      v.source.sessionId !== v.manifest.capture.sessionId ||
      v.source.sha256 !== v.manifest.sha256
    )
      throw Error('来源清单摘要或引用不一致');
  } else {
    const c = v.chunk,
      a = v.cursor;
    if (
      (await browserHash(c)) !== c.sha256 ||
      c.recordOrdinal !== a.recordOrdinal ||
      c.byteOffset !== a.byteOffset ||
      refIdentity(c.source) !== refIdentity(a.source) ||
      c.byteEnd <= c.byteOffset ||
      c.byteEnd > c.recordBytes ||
      new TextEncoder().encode(c.text).length !== c.byteEnd - c.byteOffset ||
      c.byteEnd - c.byteOffset > 16384 ||
      v.done !== (v.next === null)
    )
      throw Error('来源片段摘要、范围或后继无效');
    if (
      v.next &&
      (refIdentity(v.next.source) !== refIdentity(a.source) ||
        (c.byteEnd < c.recordBytes
          ? v.next.recordOrdinal !== c.recordOrdinal ||
            v.next.byteOffset !== c.byteEnd ||
            v.next.previousHash !== a.previousHash
          : v.next.recordOrdinal !== c.recordOrdinal + 1 ||
            v.next.byteOffset !== 0 ||
            v.next.previousHash !== c.recordHash))
    )
      throw Error('来源片段下一位置不连续');
    if (!v.next && c.byteEnd !== c.recordBytes) throw Error('来源原记录尚未读完，不能宣称终点');
  }
}
