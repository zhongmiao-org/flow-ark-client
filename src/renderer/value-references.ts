import type { Flow, Step } from '../shared/types';

export type ReferenceChoice = {
  path: string;
  label: string;
  group: '流程参数' | '前序步骤' | '当前循环';
  hint: string;
};
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export const referenceKey = (key: string) => !!key && !key.includes('.') && !forbidden.has(key);
export function referenceOf(value: unknown): string | undefined {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    '$ref' in value &&
    typeof value.$ref === 'string'
  )
    return value.$ref;
}

/** The same lexical, preceding-sibling scope used by execute and referenceIssues. */
export function referenceScope(
  steps: Step[],
  selected: string,
): { steps: Step[]; loop?: Step } | undefined {
  function block(nodes: Step[], inherited: Step[], loop?: Step): ReturnType<typeof referenceScope> {
    const prior = [...inherited];
    for (const node of nodes) {
      if (node.id === selected) return { steps: prior, loop };
      const child =
        node.type === 'condition'
          ? (block(node.then, prior, loop) ?? block(node.else, prior, loop))
          : node.type === 'loop'
            ? block(node.body, prior, node)
            : undefined;
      if (child) return child;
      prior.push(node);
    }
  }
  return block(steps, []);
}
export function referenceChoices(flow: Flow, selected: string): ReferenceChoice[] {
  const scope = referenceScope(flow.steps, selected);
  if (!scope) return [];
  const result: ReferenceChoice[] = [];
  function add(path: string, label: string, group: ReferenceChoice['group'], hint: string) {
    result.push({ path, label, group, hint });
  }
  // Do not inspect runtime data. Limit expanded examples, retaining every source root.
  function fields(
    value: unknown,
    path: string,
    label: string,
    group: ReferenceChoice['group'],
    depth = 0,
    budget = { left: 100 },
  ) {
    if (!value || typeof value !== 'object' || referenceOf(value) !== undefined || depth >= 4)
      return;
    for (const [key, child] of Object.entries(value)) {
      if (!referenceKey(key) || budget.left-- <= 0) continue;
      add(path + '.' + key, label + ' / ' + key, group, '字段来自草稿结构；实际值以本次运行为准');
      fields(child, path + '.' + key, label + ' / ' + key, group, depth + 1, budget);
    }
  }
  for (const [key, value] of Object.entries(flow.parameters)) {
    if (!referenceKey(key)) continue;
    add('params.' + key, key, '流程参数', '使用本次运行的参数值');
    fields(value, 'params.' + key, key, '流程参数');
  }
  for (const node of scope.steps) {
    const label =
      typeof node.name === 'string' && !['file', 'excel'].includes(node.type) ? node.name : node.id;
    const path = 'steps.' + node.id;
    add(
      path,
      label,
      '前序步骤',
      node.type === 'condition'
        ? '仅实际执行分支的子步骤有输出；子路径需与分支一致'
        : node.type === 'loop'
          ? '结果为每次迭代的输出数组；索引取决于实际迭代次数'
          : '本步骤的完整输出；未知字段可在高级子路径中指定',
    );
    if (node.type === 'value') fields(node.value, path, label, '前序步骤');
    const known =
      node.type === 'assert'
        ? ['verified']
        : node.type === 'browser'
          ? ((
              {
                navigate: ['url', 'title'],
                click: ['clicked', 'verified'],
                check: ['checked'],
              } as Record<string, string[]>
            )[node.operation] ?? [])
          : [];
    for (const key of known) add(path + '.' + key, label + ' / ' + key, '前序步骤', '步骤输出字段');
  }
  if (scope.loop) {
    add('item', '当前项', '当前循环', '最近一层循环的当前项；对象字段可指定子路径');
    add('index', '当前序号（从 0 开始）', '当前循环', '最近一层循环的整数序号');
  }
  return result;
}
export function composeReference(choices: ReferenceChoice[], base: string, suffix: string): string {
  if (!choices.some((choice) => choice.path === base)) throw new Error('请选择当前可用的变量');
  if (!suffix) return base;
  if (base === 'index') throw new Error('循环序号没有子字段');
  if (suffix.split('.').some((key) => !referenceKey(key)))
    throw new Error('子路径不能有空段或原型相关属性');
  return base + '.' + suffix;
}
