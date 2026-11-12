import { z } from 'zod';
export const desktopAutomationCapability = 'desktop-automation-v1';
const uuid = z.string().uuid(), scopeId = z.string().min(1).max(100);
const point = z.object({ x: z.number().finite().min(0).max(20000), y: z.number().finite().min(0).max(20000) }).strict();
export const desktopCommand = z.union([
  z.object({ kind: z.literal('activate') }).strict(),
  z.object({ kind: z.enum(['click', 'doubleClick']), elementId: z.string().regex(/^\d{1,4}$/) }).strict(),
  z.object({ kind: z.enum(['click', 'doubleClick']), point }).strict(),
  z.object({ kind: z.enum(['input', 'paste']), text: z.string().min(1).max(20000) }).strict(),
  z.object({ kind: z.literal('key'), key: z.enum(['a','s','c','v','x','z','f','Return','Tab','Escape','Backspace','Space','Left','Right','Down','Up','Home','End']), modifiers: z.array(z.enum(['command','shift','option','control'])).max(4).default([]) }).strict(),
  z.object({ kind: z.literal('scroll'), point, deltaX: z.number().int().min(-1000).max(1000), deltaY: z.number().int().min(-1000).max(1000) }).strict(),
  z.object({ kind: z.literal('drag'), from: point, to: point }).strict(),
]);
export const desktopAutomationMethods = {
  'desktop.automation.list': z.object({}).strict(),
  'desktop.automation.state': z.object({ scopeId }).strict(),
  'desktop.automation.bind': z.object({ scopeId, windowId: uuid, screenshotAllowed: z.boolean(), actionsAllowed: z.boolean(), durationMs: z.number().int().min(10000).max(3600000).default(3600000), reviewed: z.literal(true) }).strict(),
  'desktop.automation.release': z.object({ scopeId }).strict(),
  'desktop.automation.settings': z.object({ permission: z.enum(['accessibility','screen-recording']) }).strict(),
};
export const desktopSdkRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('readSelection'), observationId: uuid }).strict(),
  z.object({ operation: z.literal('decide'), observationId: uuid, instructions: z.string().min(1).max(12000), input: z.record(z.string(), z.unknown()).default({}), schema: z.record(z.string(), z.unknown()), useScreenshot: z.boolean().default(false) }).strict(),
  z.object({ operation: z.literal('observe'), screenshot: z.boolean().default(false) }).strict(),
  z.object({ operation: z.literal('act'), effectId: z.string().regex(/^[a-f0-9]{64}$/), observationId: uuid, effectKey: z.string().min(1).max(200), command: desktopCommand }).strict(),
]);
export type DesktopSdkRequest = z.infer<typeof desktopSdkRequest>;

const bounds = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().positive().max(20000), height: z.number().positive().max(20000) }).strict();
export const desktopDiscovery = z.object({ version: z.literal(1), accessibility: z.enum(['granted','not-granted']), screenRecording: z.boolean(), applicationPermissions: z.object({ accessibility: z.boolean(), screenRecording: z.string().max(30) }).strict().optional(), windows: z.array(z.object({ id: uuid, application: z.string().max(1024), bundleId: z.string().max(1024), title: z.string().max(4000), minimized: z.boolean() }).strict()).max(100) }).strict();
export const desktopObservation = z.object({ version: z.literal(1), observationId: uuid, title: z.string().max(4000), application: z.string().max(1024), bounds,
  elements: z.array(z.object({ id: z.string().regex(/^\d{1,4}$/), role: z.string().max(4000), subrole: z.string().max(4000), title: z.string().max(4000), description: z.string().max(4000), value: z.string().max(4000), depth: z.number().int().min(0).max(60), bounds: bounds.optional() }).strict()).max(2000), truncated: z.boolean(),
  focus: z.object({ role: z.string().max(4000), subrole: z.string().max(4000), elementId: z.string().regex(/^\d{1,4}$/).optional(), bounds: bounds.optional() }).strict().optional(),
  image: z.object({ mimeType: z.literal('image/png'), data: z.string().min(1).max(8*1024*1024), width: z.number().int().positive().max(4096), height: z.number().int().positive().max(4096) }).strict().optional(),
}).strict();
