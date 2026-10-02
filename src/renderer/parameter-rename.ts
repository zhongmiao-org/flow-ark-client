import type { Flow } from '../shared/types';
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
  return {
    flow: {
      ...flow,
      parameters: Object.fromEntries(
        Object.entries(flow.parameters).map(([key, value]) => [key === from ? to : key, value]),
      ),
      steps: rewrite(flow.steps) as Flow['steps'],
    },
    references,
  };
}
