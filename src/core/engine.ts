import type { Flow, Step } from '../shared/types';
export type Execution = {
  signal: AbortSignal;
  boundary(instance: string, node: Step): Promise<void>;
  captureResults?: boolean;
  emit(type: string, instance: string, data: any): Promise<void>;
  perform(node: Step, resolved: any, instance: string): Promise<any>;
  human(message: string): Promise<any>;
};
export function resolveValue(value: any, scope: any): any {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (Object.keys(value).length === 1 && typeof value.$ref === 'string') {
      let result: any = scope;
      for (const part of value.$ref.split('.')) {
        if (
          ['__proto__', 'constructor', 'prototype'].includes(part) ||
          result == null ||
          !Object.prototype.hasOwnProperty.call(Object(result), part)
        )
          throw new Error('引用值不存在：' + value.$ref);
        result = result[part];
      }
      return structuredClone(result);
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveValue(v, scope)]));
  }
  return Array.isArray(value) ? value.map((v) => resolveValue(v, scope)) : value;
}
function stable(v: any): string {
  return JSON.stringify(
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, JSON.parse(stable(v[k]))]),
        )
      : Array.isArray(v)
        ? v.map((x) => JSON.parse(stable(x)))
        : v,
  );
}
export function compare(actual: any, op: string, expected: any): boolean {
  if (op === 'exists') return actual !== null && actual !== undefined;
  if (op === 'equals') return stable(actual) === stable(expected);
  if (op === 'notEquals') return stable(actual) !== stable(expected);
  if (op === 'gt')
    return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
  if (op === 'contains')
    return typeof actual === 'string'
      ? actual.includes(String(expected))
      : Array.isArray(actual) && actual.some((v) => stable(v) === stable(expected));
  throw new Error('未知条件');
}
export async function execute(flow: Flow, params: any, ctx: Execution) {
  let executions = 0;
  async function block(nodes: Step[], scope: any, path: string): Promise<any> {
    const local = { ...scope, steps: { ...scope.steps } };
    const outputs: Record<string, any> = {};
    for (const n of nodes) {
      const instance = path + n.id;
      ctx.signal.throwIfAborted();
      await ctx.boundary(instance, n);
      ctx.signal.throwIfAborted();
      if (++executions > 10000) throw new Error('单次运行超过 10000 步');
      await ctx.emit('node-start', instance, { type: n.type });
      let result: any;
      if (n.type === 'condition')
        result = await block(
          compare(resolveValue(n.actual, local), n.operator, resolveValue(n.expected, local))
            ? n.then
            : n.else,
          local,
          instance + '/',
        );
      else if (n.type === 'loop') {
        const items = resolveValue(n.items, local);
        if (!Array.isArray(items) || items.length > 1000)
          throw new Error('循环输入必须是最多 1000 项的数组');
        result = [];
        for (let i = 0; i < items.length; i++)
          result.push(
            await block(n.body, { ...local, item: items[i], index: i }, instance + `[${i}]/`),
          );
      } else if (n.type === 'value') result = resolveValue(n.value, local);
      else if (n.type === 'assert') {
        if (!compare(resolveValue(n.actual, local), n.operator, resolveValue(n.expected, local)))
          throw new Error('结果断言失败：' + n.id);
        result = { verified: true };
      } else if (n.type === 'human') result = await ctx.human(n.message);
      else result = await ctx.perform(n, resolveValue(n, local), instance);
      local.steps[n.id] = outputs[n.id] = result ?? null;
      await ctx.emit('node-end', instance, {
        completed: true,
        ...(ctx.captureResults ? { result: result ?? null } : {}),
      });
    }
    return outputs;
  }
  return block(flow.steps, { params, steps: {} }, '');
}
