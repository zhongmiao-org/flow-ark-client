import { z } from 'zod';
import { runListSchema } from './run-history';
import { scheduleCreateSchema, scheduleUpdateSchema } from './schedules';
import { flowExportSchema } from './flow-export';
import { runRerunPreviewSchema, runRerunConfirmSchema } from './run-rerun';
import { taskMethods } from './planning';
import { learningMethods } from './learning';
import { runReviewConfirmSchema, runReviewPreviewSchema } from './run-review';
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
    template: z
      .object({
        instanceId: id,
        packageKey: z.string().min(1).max(240),
        entryId: id,
        digest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .optional(),
    resources: z
      .record(
        z.string(),
        z
          .object({
            path: z.string().max(4096).optional(),
            browserId: id.optional(),
            provider: z.enum(['deepseek', 'openai-codex']).optional(),
            model: z.string().max(100).optional(),
          })
          .strict(),
      )
      .optional(),
    grants: z.record(z.string(), z.enum(['deny', 'confirm', 'auto'])).optional(),
    configuration: z
      .object({ adapter: z.string().max(100), schema: z.unknown(), values: z.unknown() })
      .strict()
      .optional(),
  })
  .strict();
export const methods = {
  ...taskMethods,
  ...learningMethods,
  bootstrap: empty,
  'flow.save': z.object({ flow: z.unknown(), bindings }).strict(),
  'flow.create': empty,
  'flow.run': z.object({ id, debug: z.boolean().optional() }).strict(),
  'flow.run.preview': runReviewPreviewSchema,
  'flow.run.confirm': runReviewConfirmSchema,
  'run.detail': z.object({ id }).strict(),
  'run.rerun.preview': runRerunPreviewSchema,
  'run.rerun.confirm': runRerunConfirmSchema,
  'run.list': runListSchema,
  'run.artifacts.preview': z.object({ id }).strict(),
  'run.artifacts.clear': z
    .object({ id, token: z.string().regex(/^[a-f0-9]{64}$/), reviewed: z.literal(true) })
    .strict(),
  'artifact.reveal': z.object({ id }).strict(),
  'artifact.preview': z.object({ id }).strict(),
  'run.control': z.object({ id, action: z.enum(['pause', 'resume', 'step', 'cancel']) }).strict(),
  'browser.discover': empty,
  'browser.embedded.enable': empty,
  'browser.embedded.status': empty,
  'browser.embedded.pick.start': z.object({ requestId: id }).strict(),
  'browser.embedded.pick.status': z.object({ requestId: id }).strict(),
  'browser.embedded.pick.cancel': z.object({ requestId: id }).strict(),
  'browser.embedded.pick.validate': z
    .object({
      selector: z.string().min(1).max(4000),
      framePath: z.array(z.string().min(1).max(4000)).max(8),
    })
    .strict(),
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
  'schedule.save': scheduleCreateSchema,
  'schedule.update': scheduleUpdateSchema,
  'schedule.toggle': z.object({ id, enabled: z.boolean() }).strict(),
  'attention.read': z.object({ id }).strict(),
  'template.inspect': empty,
  'template.cancelImport': z.object({ token: id }).strict(),
  'template.install': z.object({ token: id }).strict(),
  'template.remove': z.object({ key: z.string().max(240) }).strict(),
  'template.export': z.object({ key: z.string().max(240) }).strict(),
  'template.create': z.object({ key: z.string().max(240), copyFrom: id.optional() }).strict(),
  'template.detail': z.object({ id }).strict(),
  'template.configure': z
    .object({
      id,
      configuration: z.unknown(),
      resources: bindings.shape.resources.unwrap(),
      grants: bindings.shape.grants.unwrap(),
    })
    .strict(),
  'template.input': z.object({ id, entryId: id, value: z.unknown() }).strict(),
  'template.answer': z.object({ id, value: z.unknown() }).strict(),
  'flow.export': flowExportSchema,
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
