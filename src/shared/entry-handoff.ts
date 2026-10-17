import { z } from 'zod';
import type { FlowArkP1 } from './contracts.generated';
import { templateSourceSchema } from './template-source';
export type HandoffSelection = NonNullable<FlowArkP1['EntryHandoffSelection']>;
export type HandoffPreview = NonNullable<FlowArkP1['EntryHandoffPreview']>;
export type HandoffRequest = NonNullable<FlowArkP1['EntryHandoffRequest']>;
export type HandoffReceipt = NonNullable<FlowArkP1['EntryHandoffReceipt']>;
const id = z.string().min(1).max(100);
export const handoffSelection = z.object({ flowId: id, source: templateSourceSchema }).strict();
export const handoffRequest = z
  .object({
    version: z.literal(1),
    selection: handoffSelection,
    token: z.string().regex(/^[a-f0-9]{64}$/),
    requestId: z.string().uuid(),
    reviewed: z.literal(true),
  })
  .strict();
export const handoffMethods = {
  'template.handoff.preview': handoffSelection,
  'template.handoff.confirm': handoffRequest,
  'template.handoff.get': z.object({ requestId: z.string().uuid() }).strict(),
  'template.handoff.list': z.object({ instanceId: id }).strict(),
};
export function mergeHandoff(current: HandoffReceipt | undefined, next: HandoffReceipt) {
  if (!current || current.requestId !== next.requestId) return next;
  return next.revision > current.revision ? next : current;
}
