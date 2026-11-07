import { z } from 'zod';
export const desktopActionReceipt = z.object({
  status: z.enum(['performed','not-executed','unknown']), reason: z.string().max(4000).optional(), actionId: z.string().uuid().optional(),
  previous: z.object({runId:z.string(),status:z.enum(['performed','not-executed','unknown']),actionId:z.string()}).strict().optional(),
}).strict();
export const desktopSelectionResult = z.object({version:z.literal(1),text:z.string().max(256*1024),source:z.literal('bound-window-selection')}).strict();
// Public SDK shapes describe the existing host protocol; runtime authorization remains in the host.
export const effectPrepareInput = z.object({action:z.string().min(1),key:z.string().min(1),description:z.string().optional(),review:z.record(z.string(),z.unknown()).optional()}).strict();
export const effectResolveInput = z.object({id:z.string().regex(/^[a-f0-9]{64}$/),state:z.enum(['confirmed','failed','unknown']),evidence:z.unknown().optional()}).strict();
export const effectPrepareResult = z.object({id:z.string(),instanceId:z.string(),runId:z.string(),action:z.string(),key:z.string(),state:z.enum(['submitting','confirmed','failed','unknown']),time:z.string(),execute:z.boolean(),evidence:z.unknown().optional()}).strict();
