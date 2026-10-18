import type { Step } from './types';
import type { FlowArkP1 } from './contracts.generated';
import { effect_prepare_result_v1, effect_resolve_result_v1 } from './node-schema.generated';

export type EffectNode = Extract<Step, { type: 'effect' }>;
export type EffectPrepareResult = NonNullable<FlowArkP1['EffectPrepareResult']>;
export type EffectResolveResult = NonNullable<FlowArkP1['EffectResolveResult']>;
export type EffectResult = EffectPrepareResult | EffectResolveResult;
export const effectNodeCapability = 'effect-node-v1';
export const effectOperations = { prepare: '准备操作', resolve: '登记结果' };
export const effectStates = {
  submitting: '提交中',
  confirmed: '已确认',
  failed: '失败',
  unknown: '结果未知',
};
export function assertEffectResult(value: unknown): asserts value is EffectResult {
  if (!effect_prepare_result_v1(value) && !effect_resolve_result_v1(value))
    throw Error('操作记录结果格式无效');
}
export function effectCapabilities(steps: Step[]): string[] {
  const result = new Set<string>();
  const walk = (nodes: Step[]) => {
    for (const n of nodes) {
      if (n.type === 'effect') {
        result.add('effect');
        result.add(effectNodeCapability);
        if (n.operation === 'prepare' && n.review) result.add('human-review-v1');
      }
      if (n.type === 'condition') {
        walk(n.then);
        walk(n.else);
      }
      if (n.type === 'loop') walk(n.body);
    }
  };
  walk(steps);
  return [...result];
}
