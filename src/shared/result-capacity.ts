import type { RunResultCapacity } from '../../contracts/result-capacity.mjs';
import { run_result_capacity_v1 } from './node-schema.generated';
import { savedResultBudget } from './typed-result-budget';

export type { RunResultCapacity };
export type CapacityReason = Extract<RunResultCapacity, { status: 'unavailable' }>['reason'];
export const capacityReasons: Record<CapacityReason, string> = {
  missing: '完整结果或原来源记录缺失',
  'owner-mismatch': '结果与原运行的来源身份不一致',
  integrity: '完整结果、索引或原值回执核对未通过',
  limit: '已保存结果超过本次运行的保存限额',
  storage: '本地存储暂时无法读取',
};

/** Browser-safe adapter for the fixed capacity relationships; never reconstructs content. */
export function checkedResultCapacity(
  value: unknown,
  runId: string,
  entries: ReadonlyArray<{ type: string; bytes: number }>,
): RunResultCapacity {
  if (!run_result_capacity_v1(value)) throw Error('结果保存空间响应无法核对');
  const capacity = value as RunResultCapacity;
  if (capacity.runId !== runId) throw Error('结果保存空间不属于本次运行');
  if (capacity.status === 'unavailable') {
    if (entries.length) throw Error('不可用结果不能包含部分可采用的目录');
    return capacity;
  }
  const budget = savedResultBudget(entries);
  if (
    budget.count !== capacity.count ||
    budget.bytes !== capacity.logicalBytes ||
    (capacity.count === 0) !== (capacity.logicalBytes === 0)
  )
    throw Error('结果保存空间与完整目录不一致');
  if (capacity.policy === 'legacy-full-values-v1') {
    if (capacity.logicalBytes !== capacity.retainedBytes) throw Error('原运行计量不一致');
  } else if (
    capacity.retainedBytes !== capacity.catalogBytes + capacity.copyBytes ||
    (capacity.copyCount === 0) !== (capacity.copyBytes === 0)
  )
    throw Error('结果目录与原值回执的实际保留量不一致');
  return capacity;
}
