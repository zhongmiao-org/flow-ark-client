import { z } from 'zod';
import type { Run, ScriptBundle } from './types';

const selection = {
  id: z.string().min(1).max(100),
  mode: z.enum(['snapshot', 'saved']),
  debug: z.boolean().optional(),
};
export const runRerunPreviewSchema = z.object(selection).strict();
export const runRerunConfirmSchema = z
  .object({
    ...selection,
    token: z.string().regex(/^[a-f0-9]{64}$/),
    requestId: z.string().uuid(),
    reviewed: z.literal(true),
  })
  .strict();

export type RunRerunMode = 'snapshot' | 'saved';
export type RunRerunPreviewInput = z.infer<typeof runRerunPreviewSchema>;
export type RunRerunConfirmInput = z.infer<typeof runRerunConfirmSchema>;
export type RunRerunSummary = Pick<
  Run,
  'id' | 'flowId' | 'name' | 'state' | 'versionId' | 'createdAt'
>;
export type RunRerunPreview = {
  token: string;
  mode: RunRerunMode;
  debug: boolean;
  source: RunRerunSummary;
  flow: {
    id: string;
    name: string;
    versionId: string;
    stepCount: number;
    parameterNames: string[];
    directoryBindings: string[];
    credentialRefs: string[];
    browserId?: string;
    scriptBundles: ScriptBundle[];
  };
  warnings: string[];
};
export type RunRerunDetails = {
  available: boolean;
  reason?: string;
  source?: RunRerunSummary;
  derived: RunRerunSummary[];
};
