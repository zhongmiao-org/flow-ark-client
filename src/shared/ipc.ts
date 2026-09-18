import { z } from 'zod';
const id = z.string().min(1).max(100);
const empty = z.object({}).strict();
const bindings = z
  .object({
    browserId: id.optional(),
    files: z.record(z.string(), z.string().max(4096)),
    credentials: z.array(id).max(30),
    scriptPackages: z
      .record(
        z.string().max(214),
        z.object({ path: z.string().min(1).max(4096), version: z.string().max(100) }).strict(),
      )
      .optional(),
    policy: z.unknown().optional(),
    configuration: z
      .object({ adapter: z.string().max(100), schema: z.unknown(), values: z.unknown() })
      .strict()
      .optional(),
  })
  .strict();
export const methods = {
  bootstrap: empty,
  'flow.save': z.object({ flow: z.unknown(), bindings }).strict(),
  'flow.create': z.object({ templateId: id.optional() }).strict(),
  'flow.run': z.object({ id, debug: z.boolean().optional() }).strict(),
  'run.detail': z.object({ id }).strict(),
  'artifact.reveal': z.object({ id }).strict(),
  'run.control': z.object({ id, action: z.enum(['pause', 'resume', 'step', 'cancel']) }).strict(),
  'browser.discover': empty,
  'browser.embedded.enable': empty,
  'browser.embedded.status': empty,
  'browser.embedded.navigate': z
    .object({
      url: z
        .string()
        .url()
        .max(8192)
        .refine((v) => /^https?:\/\//.test(v)),
    })
    .strict(),
  'browser.embedded.viewport': z
    .object({
      x: z.number().int().min(0).max(20000),
      y: z.number().int().min(0).max(20000),
      width: z.number().int().min(0).max(20000),
      height: z.number().int().min(0).max(20000),
    })
    .strict(),
  'browser.embedded.visibility': z.object({ visible: z.boolean() }).strict(),
  'script.package.inspect': z.object({ path: z.string().min(1).max(4096) }).strict(),
  'browser.bind': z
    .object({
      path: z.string().min(1).max(4096),
      driver: z.string().max(4096).optional(),
    })
    .strict(),
  'schedule.save': z
    .object({
      id: id.optional(),
      flowId: id,
      intervalMinutes: z.number().int().min(1).max(525600),
      timezone: z.string().max(100),
    })
    .strict(),
  'schedule.toggle': z.object({ id, enabled: z.boolean() }).strict(),
  'attention.read': z.object({ id }).strict(),
  'action.confirm': z.object({ id, policyHash: z.string().length(64) }).strict(),
  'flow.export': z.object({ id, reviewed: z.literal(true) }).strict(),
  'flow.import': empty,
  'file.choose': z.object({ kind: z.enum(['directory', 'browser', 'file', 'driver']) }).strict(),
  'credentials.set': z
    .object({
      id: z.enum(['openai-codex', 'deepseek']),
      value: z.string().min(8).max(1000),
    })
    .strict(),
  'ai.test': z
    .object({
      provider: z.enum(['openai-codex', 'deepseek']),
      model: z.string().min(1).max(100),
    })
    .strict(),
  'clipboard.copy': z.object({ value: z.string().max(20000) }).strict(),
  'app.showData': empty,
};
export type Method = keyof typeof methods;
export function validateIPC(method: string, args: unknown) {
  if (!Object.prototype.hasOwnProperty.call(methods, method)) throw new Error('IPC 方法不在白名单');
  if (JSON.stringify(args).length > 2 * 1024 * 1024) throw new Error('IPC 数据超过 2 MiB');
  return methods[method as Method].parse(args);
}
