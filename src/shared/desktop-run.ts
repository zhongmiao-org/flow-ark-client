import { z } from 'zod';
import { selectionReference } from './desktop-windows';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const desktopBind = selectionReference.extend({
  flowId: id,
  taskId: id,
  revision: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER - 1),
  flowHash: hash,
  requestId: uuid,
});
export const desktopRunMethods = {
  'desktop.run.bind': desktopBind,
  'desktop.run.cancel': z.object({ requestId: uuid }).strict(),
  'desktop.run.release': z.object({ bindingId: uuid }).strict(),
};
export const desktopBinding = z
  .object({
    bindingId: uuid,
    expiresAt: z.number().int().positive(),
    windowTitle: z.string().max(1024),
    sourceHash: hash,
    replacementHash: hash,
  })
  .strict();
export type DesktopBinding = z.infer<typeof desktopBinding>;
export const desktopBindingCheck = desktopBinding.extend({
  original: z.string().min(1).max(20000),
});
export const nativeDesktopWrite = z.discriminatedUnion('status', [
  z.object({ status: z.literal('verified'), readback: z.string().min(1).max(20000) }).strict(),
  z
    .object({ status: z.enum(['not-written', 'unknown']), reason: z.string().min(1).max(100) })
    .strict(),
]);
export const desktopWriteResult = z
  .object({
    status: z.enum(['verified', 'not-written', 'unknown']),
    message: z.string().max(1000),
    original: z.string().max(20000).optional(),
    readback: z.string().max(20000).optional(),
  })
  .strict();
export type DesktopWriteResult = z.infer<typeof desktopWriteResult>;
export type DesktopReceipt = DesktopWriteResult & {
  runId: string;
  nodeId: string;
  bindingId: string;
  attemptedAt: string;
  completedAt?: string;
};
export const desktopNativeMethods = {
  'desktop.binding.hold': selectionReference.extend({ bindingId: uuid, replacementHash: hash }),
  'desktop.binding.verify': z.object({ bindingId: uuid, runId: uuid.optional() }).strict(),
  'desktop.binding.claim': z.object({ bindingId: uuid, runId: uuid }).strict(),
  'desktop.binding.release': z.object({ bindingId: uuid, runId: uuid.optional() }).strict(),
  'desktop.binding.write': z
    .object({ bindingId: uuid, runId: uuid, text: z.string().min(1).max(20000) })
    .strict(),
};
