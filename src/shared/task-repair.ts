import { z } from 'zod';
import type { PlanningInput } from './planning';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const repairSelectionSchema = z
  .object({
    requestId: z.string().uuid(),
    resourceId: id,
    documentRevision: z.number().int().nonnegative(),
    url: z.string(),
    title: z.string(),
    target: z
      .object({
        selector: z.string().min(1).max(4000),
        framePath: z.array(z.string().min(1).max(4000)).max(8),
        label: z.string().max(100),
        tag: z.string(),
        inputType: z.string(),
        structural: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type RepairSelection = z.infer<typeof repairSelectionSchema>;
export const repairPreviewSchema = z
  .object({
    id,
    revision: z
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER - 1),
    runId: id,
    nodeId: id,
    pickRequestId: z.string().uuid(),
  })
  .strict();
export const repairGenerateSchema = repairPreviewSchema.extend({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  provider: z.enum(['deepseek', 'openai-codex']),
  model: z.string().trim().min(1).max(100),
  reviewed: z.literal(true),
});
export type RepairInput = z.infer<typeof repairPreviewSchema>;
export type RepairReference = Pick<RepairInput, 'runId' | 'nodeId' | 'pickRequestId'> & {
  token: string;
};
export type RepairPreview = {
  token: string;
  input: PlanningInput;
  selection: RepairSelection;
  source: {
    id: string;
    state: string;
    nodeId: string;
    nodeName: string;
    operation: string;
    selector: string;
    framePath: string[];
  };
};
