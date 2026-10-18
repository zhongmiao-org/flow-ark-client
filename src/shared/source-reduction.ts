import { z } from 'zod';
import {
  reduction_output_v1,
  reduction_attempt_v1,
  reduction_run_review_v1,
} from './node-schema.generated';
import { browserHash, browserDigest } from './conversation-archive';
import type { Step, Run } from './types';
export type {
  SourceReductionOutput,
  SourceReductionAttempt,
  SourceReductionProof,
  SourceReductionRecipe,
  SourceReductionCheckpoint,
  SourceReductionRef,
  SourceReductionRunReview,
  SourceReductionRunConfirmation,
  SourceReductionRunReviewReceipt,
} from './contracts.generated';
import type {
  SourceReductionOutput,
  SourceReductionAttempt,
  SourceReductionRunReview,
} from './contracts.generated';
import type { RunRerunPreview } from './run-rerun';
export type ReductionNode = Extract<Step, { type: 'source-reduce' }>;
export const reductionCapabilities = [
  'source-reduce-v1',
  'conversation-source-read-v1',
  'ai-node-v1',
];
const identity = (j: SourceReductionOutput['job']) =>
  JSON.stringify([
    j.version,
    j.jobId,
    j.recipeHash,
    j.source.version,
    j.source.archiveId,
    j.source.sessionId,
    j.source.sha256,
  ]);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const target = z
  .object({ runId: id, nodeId: id, nodeInstance: z.string().min(1).max(4000) })
  .strict();
const job = target.extend({ jobId: id }).strict();
const action = job
  .extend({
    revision: z
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER - 1),
    pendingAttemptId: id,
    requestId: id,
  })
  .strict();
export type ReductionTarget = z.infer<typeof target>;
export const reductionRunConfirmation = z
  .object({
    version: z.literal(1),
    reviewId: id,
    reviewSha256: z.string().regex(/^[a-f0-9]{64}$/),
    requestId: id,
    reviewed: z.literal(true),
  })
  .strict();
export type SourceReductionRunPlan = { source: SourceReductionRunReview; run: RunRerunPreview };
export type SourceReductionConfirmationOutcome =
  | { status: 'created'; run: Run }
  | { status: 'blocked' | 'unknown'; error: string };
export async function verifyReductionRunReview(value: unknown): Promise<SourceReductionRunReview> {
  if (
    new TextEncoder().encode(JSON.stringify(value)).length > 32768 ||
    !reduction_run_review_v1(value)
  )
    throw Error('来源运行核对格式或范围无效');
  const r = value as SourceReductionRunReview;
  const limit = r.phase === 'attention' ? 1 : r.phase === 'complete' ? 0 : r.batchLimit;
  const operation =
    r.phase === 'attention'
      ? 'retry-one'
      : r.phase === 'complete'
        ? 'use-complete'
        : 'continue-batch';
  if (
    r.requestLimit !== limit ||
    r.operation !== operation ||
    Date.parse(r.expiresAt) <= Date.parse(r.createdAt) ||
    Date.parse(r.expiresAt) - Date.parse(r.createdAt) > 600000 ||
    (r.phase === 'complete') !== (r.fragment === null) ||
    (r.phase === 'attention') !== (r.pending !== null) ||
    (await browserHash(r)) !== r.sha256
  )
    throw Error('来源运行核对的阶段、期限或摘要不一致');
  return r;
}
export const reductionMethods = {
  'reduction.runPreview': job,
  'reduction.runPlan': job,
  'reduction.runConfirm': reductionRunConfirmation,
  'reduction.forRun': target,
  'reduction.detail': job,
  'reduction.attempts': job
    .extend({ before: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable() })
    .strict(),
  'reduction.attempt': job
    .extend({ sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) })
    .strict(),
  'reduction.recover': action,
};
export function assertReductionOutput(value: unknown): asserts value is SourceReductionOutput {
  if (
    new TextEncoder().encode(JSON.stringify(value)).length > 131072 ||
    !reduction_output_v1(value)
  )
    throw Error('整理任务快照格式或预算无效');
  const o = value as SourceReductionOutput,
    c = o.checkpoint;
  if (
    identity(o.job) !== identity(c.job) ||
    c.revision !== c.chunks ||
    c.records > c.chunks ||
    o.attempts < c.chunks ||
    o.unknownUsageRequests > o.attempts ||
    (['running', 'attention'].includes(o.phase)
      ? o.pendingAttemptId === null
      : o.pendingAttemptId !== null) ||
    (o.phase === 'complete') !== (o.proof !== null) ||
    (c.next === null) !== (o.phase === 'complete')
  )
    throw Error('整理任务快照的身份或阶段不一致');
}
export async function verifyReductionOutput(value: unknown) {
  assertReductionOutput(value);
  const c = value.checkpoint,
    p = value.proof;
  if ((await browserHash(c)) !== c.sha256) throw Error('整理检查点摘要不一致');
  if (
    p &&
    ((await browserHash(p)) !== p.sha256 ||
      p.checkpointSha256 !== c.sha256 ||
      p.accumulatorSha256 !== (await browserDigest(c.accumulator)) ||
      p.chainHash !== c.chainHash ||
      p.chunks !== c.chunks ||
      p.records !== c.records ||
      p.bytes !== c.bytes ||
      identity(p.job) !== identity(value.job))
  )
    throw Error('完整覆盖证明与当前草稿不一致');
}
export function assertReductionAttempt(value: unknown): asserts value is SourceReductionAttempt {
  if (
    new TextEncoder().encode(JSON.stringify(value)).length > 1048576 ||
    !reduction_attempt_v1(value)
  )
    throw Error('整理请求记录格式或预算无效');
}
