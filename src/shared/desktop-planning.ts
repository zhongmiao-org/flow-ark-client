import { z } from 'zod';
import { aiProvider, aiModel } from './ai-settings';
import { desktopSelectionInspection, selectionReference } from './desktop-windows';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const taskIdentity = {
  id,
  revision: z
    .number()
    .int()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER - 1),
};
export const desktopPlanGenerate = selectionReference.extend({
  ...taskIdentity,
  requestId: z.string().uuid(),
  provider: aiProvider,
  configurationRevision: z.string().regex(/^[a-f0-9]{64}$/),
  reviewed: z.literal(true),
});
export const desktopPlanInspect = selectionReference.extend({
  ...taskIdentity,
  requestId: z.string().uuid(),
});
export const desktopPlanInspection = desktopSelectionInspection.extend({
  ...taskIdentity,
  requestId: z.string().uuid(),
});
export type DesktopPlanInspection = z.infer<typeof desktopPlanInspection>;
export const desktopPlanMethods = {
  'desktop.plan.inspect': desktopPlanInspect,
  'desktop.plan.generate': desktopPlanGenerate,
  'desktop.plan.cancel': z.object({ id, requestId: z.string().uuid() }).strict(),
};
export const desktopPlanResult = z
  .object({
    kind: z.enum(['proposal', 'unsupported']),
    summary: z.string().trim().min(1).max(1000),
    replacement: z.string().max(20000),
    limitations: z.array(z.string().trim().min(1).max(1000)).max(10),
  })
  .strict()
  .refine((v) => (v.kind === 'proposal' ? !!v.replacement.trim() : v.replacement === ''));
export const desktopPlanResponse = selectionReference.extend({
  version: z.literal(1),
  ...taskIdentity,
  requestId: z.string().uuid(),
  provider: aiProvider,
  model: aiModel,
  expiresAt: z.number().int().positive(),
  result: desktopPlanResult,
});
export type DesktopPlanGenerate = z.infer<typeof desktopPlanGenerate>;
export type DesktopPlanResponse = z.infer<typeof desktopPlanResponse>;
