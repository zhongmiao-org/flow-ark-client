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
export const runDisplayLabels: Record<RunState, string> = {
  ...runStateLabels,
  RUNNING: '运行中',
  SUCCEEDED: '已完成',
  FAILED: '已失败',
  CANCELLING: '取消中',
};
export const runListSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(1024).optional(),
    query: z.string().max(200).optional(),
    state: z.enum(Object.keys(runStateLabels) as [RunState, ...RunState[]]).optional(),
    source: z.enum(['manual', 'schedule', 'debug', 'rerun']).optional(),
    flowId: z.string().min(1).max(200).optional(),
    createdFrom: z.iso.datetime({ offset: true }).optional(),
    createdBefore: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(
    (q) =>
      !q.createdFrom || !q.createdBefore || Date.parse(q.createdFrom) < Date.parse(q.createdBefore),
    { message: '运行记录时间范围无效' },
  );
export type RunListQuery = z.infer<typeof runListSchema>;
export type RunListPage = {
  runs: Run[];
  nextCursor: string | null;
  totalCount: number;
  newerCount: number;
  matchedCount: number;
  elapsed: Record<
    string,
    {
      kind: 'live' | 'final' | 'recorded' | 'unknown';
      milliseconds: number | null;
      startedAt: string | null;
    }
  >;
};

export function runSource(run: Pick<Run, 'source' | 'debug' | 'rerun'>) {
  return run.rerun ? 'rerun' : run.debug ? 'debug' : run.source;
}
export const runSourceLabels: Record<string, string> = {
  manual: '手动运行',
  schedule: '本机计划',
  debug: '逐步调试',
  rerun: '关联重跑',
};

export function historyTimeRange(days: number | null, now = new Date()) {
  if (!days) return { createdFrom: undefined, createdBefore: undefined };
  return {
    createdFrom: new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - days + 1,
    ).toISOString(),
    createdBefore: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString(),
  };
}
export type RunOverview = {
  total: number;
  queued: number;
  active: Run | null;
  latest: Run[];
  today?: { date: string; total: number; succeeded: number; failed: number; interrupted: number };
};
