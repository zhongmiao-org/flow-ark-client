import { templateSourceSchema } from './template-source';
import { z } from 'zod';
import type { Run, Schedule } from './types';

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
export const scheduleCreateSchema = z
  .object({
    flowId: id,
    ...scheduleTiming,
    templateSource: templateSourceSchema.optional(),
    flowUpdatedAt: z.iso.datetime().optional(),
  })
  .strict();
const update = { id, revision: id.nullable(), ...scheduleTiming };
export const scheduleUpdateSchema = z.discriminatedUnion('adoptLatest', [
  z.object({ ...update, adoptLatest: z.literal(false) }).strict(),
  z
    .object({ ...update, adoptLatest: z.literal(true), flowUpdatedAt: z.string().datetime() })
    .strict(),
]);
export const scheduleInspectSchema = z
  .object({
    id,
    cursor: z
      .object({
        scheduleId: id,
        ceiling: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER - 1),
        before: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((query) => !query.cursor || query.cursor.scheduleId === query.id, '计划记录来源不一致');
export type ScheduleCursor = NonNullable<z.infer<typeof scheduleInspectSchema>['cursor']>;
export type ScheduleInspection = {
  plan: Schedule;
  version: { id: string; name: string; savedAt: string } | null;
  records: {
    position: number;
    kind: 'occupied' | 'missed' | 'failed';
    reason: string;
    time?: number;
    from?: number;
    to?: number;
  }[];
  nextCursor: ScheduleCursor | null;
  activeRun: Pick<Run, 'id' | 'name' | 'state'> | null;
};
