import { z } from 'zod';
const id = z.string().min(1).max(100);
export const templateSourceSchema = z
  .object({
    instanceId: id,
    entryId: id,
    revision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type TemplateSource = z.infer<typeof templateSourceSchema>;
