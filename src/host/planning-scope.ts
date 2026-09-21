import type { Flow, FlowRecord } from '../shared/types';
import type { PlanningResult } from '../shared/planning';
import type { PlanningScope } from '../shared/planning-scope';
import { canonical, digest } from '../shared/utils';
import { validateFlow, walk } from '../core/validate';

export const planningFlowHash = (flow: FlowRecord | null) =>
  digest(
    flow
      ? {
          flow: flow.flow,
          bindings: flow.bindings,
          ...(flow.webTarget ? { webTarget: flow.webTarget } : {}),
          ...(flow.outputTarget ? { outputTarget: flow.outputTarget } : {}),
        }
      : null,
  );

export function checkScope(scope: PlanningScope, flow: FlowRecord | null) {
  if (!flow || planningFlowHash(flow) !== scope.baseFlowHash)
    throw new Error('单步修改的流程或绑定已变化，请重新选择步骤；原草稿保持不变');
  validateFlow(flow.flow);
  if (!walk(flow.flow.steps).some((node) => node.id === scope.nodeId))
    throw new Error('所选步骤已不存在，请重新选择');
}

export function validateScopedPlan(result: PlanningResult, before: Flow, scope: PlanningScope) {
  if (result.kind !== 'plan' || !result.flow) return;
  const original = walk(before.steps).find((n) => n.id === scope.nodeId);
  const proposed = walk(result.flow.steps).find((n) => n.id === scope.nodeId);
  if (!original || !proposed) throw new Error('AI 删除或更换了所选步骤，提案已拒绝');
  const old = original as unknown as Record<string, unknown>;
  const next = proposed as unknown as Record<string, unknown>;
  const fixed = ['id', 'type', 'version', 'operation', 'binding', 'templateName', 'dependencies'];
  if (original.type === 'condition') fixed.push('then', 'else');
  if (original.type === 'loop') fixed.push('body');
  // HTTP body is editable; the endpoint, method and headers remain the same.
  if (original.type === 'http') fixed.push('url', 'method', 'headers');
  if (original.type === 'browser') {
    fixed.push('selector', 'framePath');
    if (original.operation === 'navigate') fixed.push('value');
  }
  if (original.type === 'file' || original.type === 'excel') fixed.push('name');
  if (original.type === 'file' && original.operation === 'copy') fixed.push('content');
  if (original.type === 'file' && original.version === 2) fixed.push('files');
  const equal = (a: unknown, b: unknown) => canonical({ value: a }) === canonical({ value: b });
  if (fixed.some((key) => !equal(old[key], next[key])))
    throw new Error('AI 修改了步骤身份、子步骤或静态资源，超出单步范围；提案已拒绝');
  const expected = structuredClone(before);
  const target = walk(expected.steps).find((n) => n.id === scope.nodeId)!;
  for (const key of Object.keys(target)) delete (target as any)[key];
  Object.assign(target, proposed);
  if (!equal(expected, result.flow))
    throw new Error('AI 修改了其他步骤、结构或流程字段，超出单步范围；提案已拒绝');
  if (equal(original, proposed)) throw new Error('AI 没有修改所选步骤，请补充具体要求');
}
