import { z } from 'zod';
import type { Run, RunState } from './types';

export const runStateLabels: Record<RunState, string> = {
  QUEUED: '排队中',
  RUNNING: '正在运行',
  PAUSED: '已暂停',
  WAITING_INPUT: '等待人工',
  CANCELLING: '正在取消',
  CANCELLED: '已取消',
  INTERRUPTED: '已中断',
  SUCCEEDED: '执行完成',
  FAILED: '执行失败',
};
export const runListSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(1024).optional(),
    query: z.string().max(200).optional(),
    state: z.enum(Object.keys(runStateLabels) as [RunState, ...RunState[]]).optional(),
    source: z.enum(['manual', 'schedule']).optional(),
  })
  .strict();
export type RunListQuery = z.infer<typeof runListSchema>;
export type RunListPage = {
  runs: Run[];
  nextCursor: string | null;
  totalCount: number;
  newerCount: number;
};
export type RunOverview = {
  total: number;
  queued: number;
  active: Run | null;
  latest: Run[];
  today?: { date: string; total: number; succeeded: number; failed: number; interrupted: number };
};
