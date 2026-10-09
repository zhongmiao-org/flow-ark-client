import type { FlowRecord } from '../shared/types';

export function filterFlows(
  records: FlowRecord[],
  filter: 'all' | 'recent' | 'template',
  query: string,
  now = new Date(),
) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
  const search = query.trim().toLocaleLowerCase();
  return records
    .filter((record) => {
      if (!record.flow.name.toLocaleLowerCase().includes(search)) return false;
      if (filter === 'template' && !record.flow.sourceTemplate) return false;
      const time = Date.parse(record.updatedAt);
      return (
        filter !== 'recent' || (Number.isFinite(time) && time >= start && time <= now.getTime())
      );
    })
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
}

export function relativeEditTime(value: string, now = new Date()) {
  const time = Date.parse(value),
    elapsed = now.getTime() - time;
  if (!Number.isFinite(time) || elapsed < 0) return '时间待核对';
  if (elapsed < 60_000) return '刚刚';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  return `${Math.floor(elapsed / 86_400_000)} 天前`;
}
