import type { Run } from '../shared/types';

/** Display only: IDs remain the keys used for selection, routing and persistence. */
export function recordTime(value?: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '时间未记录';
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function runRecordLabel(run: Pick<Run, 'name' | 'createdAt'>): string {
  return `${run.name || '未命名流程'} · ${recordTime(run.createdAt)}`;
}
