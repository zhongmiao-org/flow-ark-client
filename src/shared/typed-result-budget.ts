/** Existing complete-value budget; display and admission use the same units and limits. */
export const TYPED_RESULT_LIMITS = { count: 1000, bytes: 8 * 1048576 } as const;

export const typedResultNames: Record<string, string> = {
  document: '资料解析',
  skill: '个人 Skill',
  context: '配置与状态',
  conversation: '会话结果',
  browser: '网页结构化结果',
  'run-result': '读取已保存结果',
  source: '完整来源',
  'source-reduce': '来源整理',
  effect: '操作准备与回执',
};

export function savedResultBudget(entries: ReadonlyArray<{ type: string; bytes: number }>) {
  const groups = new Map<string, { type: string; count: number; bytes: number }>();
  let bytes = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0)
      throw Error('结果容量元数据无法核对，请保留原运行记录');
    bytes += entry.bytes;
    if (!Number.isSafeInteger(bytes)) throw Error('结果容量总数无法核对');
    const group = groups.get(entry.type) ?? { type: entry.type, count: 0, bytes: 0 };
    group.count++;
    group.bytes += entry.bytes;
    groups.set(entry.type, group);
  }
  return {
    count: entries.length,
    bytes,
    remainingCount: Math.max(0, TYPED_RESULT_LIMITS.count - entries.length),
    remainingBytes: Math.max(0, TYPED_RESULT_LIMITS.bytes - bytes),
    groups: [...groups.values()].sort((a, b) => b.bytes - a.bytes || b.count - a.count),
  };
}

export function resultBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} 字节`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${(bytes / 1048576).toFixed(2)} MiB`;
}
