export type BatchDeclaration = {
  version: 1;
  decisionPath: string[];
  progressPath: string[];
  reasonPath: string[];
};
export type BatchDecision = {
  version: 1;
  decision: 'continue' | 'complete' | 'review';
  progress: string;
  reason: string;
};
export const batchCapability: 'entry-batches-v1';
export const batchDecisions: readonly ['continue', 'complete', 'review'];
export function assertBatchDeclaration(value: unknown, resultSchema: unknown): asserts value is BatchDeclaration;
export function extractBatchDecision(declaration: unknown, resultSchema: unknown, value: unknown): BatchDecision;
