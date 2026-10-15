import type { Flow, Step } from '../shared/types';
import { referenceKey, referenceOf } from './value-references';

/** Rename a draft parameter and exact structured references, never text or script code. */
export function renameParameter(flow: Flow, from: string, to: string) {
  if (!Object.hasOwn(flow.parameters, from)) throw new Error('原参数已不存在，请重新核对。');
  if (!referenceKey(to) || to.trim() !== to)
    throw new Error('名称不能为空、含点、首尾空格或原型相关属性。');
  if (from === to) return { flow, references: 0 };
  if (Object.hasOwn(flow.parameters, to)) throw new Error('参数名称已存在，请使用其他名称。');
  let references = 0;
  const prefix = 'params.' + from;
  const rewrite = (value: unknown): unknown => {
    const reference = referenceOf(value);
    if (
      referenceKey(from) &&
      reference !== undefined &&
      (reference === prefix || reference.startsWith(prefix + '.'))
    ) {
      references++;
      return { $ref: 'params.' + to + reference.slice(prefix.length) };
    }
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)]));
    return value;
  };
  const rewriteSteps = (steps: Step[]): Step[] =>
    steps.map((node) => {
      if (node.type === 'ai') return { ...node, input: rewrite(node.input) as typeof node.input };
      if (node.type === 'condition')
        return {
          ...node,
          ...(rewrite({ actual: node.actual, expected: node.expected }) as object),
          then: rewriteSteps(node.then),
          else: rewriteSteps(node.else),
        };
      if (node.type === 'loop')
        return {
          ...node,
          items: rewrite(node.items) as typeof node.items,
          body: rewriteSteps(node.body),
        };
      return rewrite(node) as Step;
    });
  return {
    flow: {
      ...flow,
      parameters: Object.fromEntries(
        Object.entries(flow.parameters).map(([key, value]) => [key === from ? to : key, value]),
      ),
      ...(flow.parameterSources
        ? {
            parameterSources: Object.fromEntries(
              Object.entries(flow.parameterSources).map(([key, value]) => [
                key === from ? to : key,
                rewrite(value),
              ]),
            ) as Flow['parameterSources'],
          }
        : {}),
      steps: rewriteSteps(flow.steps),
    },
    references,
  };
}
