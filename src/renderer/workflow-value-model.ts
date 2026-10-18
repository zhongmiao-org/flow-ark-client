import type { Json } from '../shared/types';
import { composeReference, referenceOf, type ReferenceChoice } from './value-references';

export type JsonContainer = Record<string, Json> | Json[];
export const isJsonContainer = (value: Json): value is JsonContainer =>
  value !== null && typeof value === 'object';

/** A visual editor budget, not a change to the runtime value format or permissions. */
export function checkVisualValue(value: Json, choices?: ReferenceChoice[]) {
  const queue: { value: Json; depth: number }[] = [{ value, depth: 0 }];
  let visited = 0;
  while (queue.length) {
    const item = queue.pop()!;
    if (++visited > 10000 || item.depth > 32)
      throw Error('内容超过可视化编辑的层级或数量范围；原值保留，可使用高级配置核对。');
    const ref = choices !== undefined ? referenceOf(item.value) : undefined;
    if (ref !== undefined) {
      checkVisualReference(ref, choices!);
      continue;
    }
    if (item.value && typeof item.value === 'object')
      for (const child of Object.values(item.value))
        queue.push({ value: child, depth: item.depth + 1 });
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > 1048576)
    throw Error('内容超过可视化编辑的1MiB范围；原值保留，可使用高级配置核对。');
}

export function checkVisualReference(path: string, choices: ReferenceChoice[]) {
  const source = choices
    .filter((choice) => path === choice.path || path.startsWith(choice.path + '.'))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!source) throw Error('变量已缺失或不在当前作用域，请重新选择。');
  if (composeReference(choices, source.path, path.slice(source.path.length + 1)) !== path)
    throw Error('变量路径无效，请重新选择。');
}
