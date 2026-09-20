import { z } from 'zod';

const id = z.string().min(1).max(100);
export const scheduleTiming = {
  intervalMinutes: z.number().int().min(1).max(525600),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    }, '请填写有效时区，例如 Asia/Shanghai'),
};
export const scheduleCreateSchema = z.object({ flowId: id, ...scheduleTiming }).strict();
const update = { id, revision: id.nullable(), ...scheduleTiming };
export const scheduleUpdateSchema = z.discriminatedUnion('adoptLatest', [
  z.object({ ...update, adoptLatest: z.literal(false) }).strict(),
  z
    .object({ ...update, adoptLatest: z.literal(true), flowUpdatedAt: z.string().datetime() })
    .strict(),
]);
