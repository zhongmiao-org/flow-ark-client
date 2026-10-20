import { z } from 'zod';
import type { FlowArkP1 } from './contracts.generated';
export type BatchLimits = NonNullable<FlowArkP1['BatchLimits']>;
export type BatchDeclaration = NonNullable<FlowArkP1['BatchDeclaration']>;
export type BatchScope = NonNullable<FlowArkP1['BatchScope']>;
export type BatchRunReference = NonNullable<FlowArkP1['BatchRunReference']>;
export type BatchRunLink = NonNullable<FlowArkP1['BatchRunLink']>;
export type BatchAdmissionProof = NonNullable<FlowArkP1['BatchAdmissionProof']>;
export type BatchDecisionProof = NonNullable<FlowArkP1['BatchDecisionProof']>;
export type BatchSessionView = NonNullable<FlowArkP1['BatchSessionView']>;
export type BatchStopReason = NonNullable<FlowArkP1['BatchStopReason']>;
export type BatchStopRequest = NonNullable<FlowArkP1['BatchStopRequest']>;
export type BatchStopReceipt = NonNullable<FlowArkP1['BatchStopReceipt']>;
export type BatchSessionPage = NonNullable<FlowArkP1['BatchSessionPage']>;
export type BatchHistoryPage = NonNullable<FlowArkP1['BatchHistoryPage']>;
export type BatchHistoryRow = NonNullable<FlowArkP1['BatchHistoryRow']>;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const position = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const ceiling = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER - 1);
export const batchLimitsSchema = z
  .object({
    maxBatches: z.number().int().min(1).max(1000),
    maxDurationMs: z.number().int().min(60000).max(86400000),
    delayMs: z.number().int().min(1000).max(300000),
  })
  .strict();
const listCursor = z.object({ flowId: id, ceiling, before: position }).strict();
const historyCursor = z.object({ sessionId: id, ceiling, before: position }).strict();
const list = z
  .object({ flowId: id, cursor: listCursor.optional() })
  .strict()
  .refine(
    (v) => !v.cursor || (v.cursor.flowId === v.flowId && v.cursor.before <= v.cursor.ceiling + 1),
    '连续运行列表游标来源或范围不一致',
  );
const history = z
  .object({ sessionId: id, cursor: historyCursor.optional() })
  .strict()
  .refine(
    (v) =>
      !v.cursor || (v.cursor.sessionId === v.sessionId && v.cursor.before <= v.cursor.ceiling + 1),
    '批次历史游标来源或范围不一致',
  );
export const batchMethods = {
  'run.batch.get': z.object({ sessionId: id }).strict(),
  'run.batch.list': list,
  'run.batch.history': history,
  'run.batch.stop': z
    .object({
      requestId: z.string().uuid(),
      sessionId: id,
      mode: z.enum(['after-batch', 'cancel-current']),
    })
    .strict(),
};
