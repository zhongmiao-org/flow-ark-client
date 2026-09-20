import { z } from 'zod';

export const templateContentLimit = 2 * 1024 * 1024;

/** Export captures a draft definition, never its local bindings or configuration values. */
export const flowExportSchema = z
  .object({
    flow: z.unknown(),
    configuration: z
      .object({ adapter: z.string().min(1).max(100), schema: z.unknown() })
      .strict()
      .optional(),
    reviewed: z.literal(true),
  })
  .strict()
  .refine((value) => JSON.stringify(value).length <= templateContentLimit, 'IPC 数据超过 2 MiB');
