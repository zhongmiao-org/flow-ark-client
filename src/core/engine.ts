import type { Flow, Step } from '../shared/types';
import { NodeDeadline } from './node-deadline';
export type Execution = {
  signal: AbortSignal;
  boundary(instance: string, node: Step, signal: AbortSignal): Promise<void>;
  captureResults?: boolean;
  emit(type: string, instance: string, data: any): Promise<void>;
  perform(node: Step, resolved: any, instance: string, signal: AbortSignal): Promise<any>;
  human(message: string, signal: AbortSignal): Promise<any>;
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
  const root = new NodeDeadline(ctx.signal);
  async function block(
    nodes: Step[],
    scope: any,
    path: string,
    parent: NodeDeadline,
  ): Promise<any> {
    const local = { ...scope, steps: { ...scope.steps } };
    const outputs: Record<string, any> = {};
    for (const n of nodes) {
      const instance = path + n.id;
      parent.check();
      await parent.run(() => ctx.boundary(instance, n, parent.signal));
      parent.check();
      if (++executions > 10000) throw new Error('单次运行超过 10000 步');
      await parent.run(() => ctx.emit('node-start', instance, { type: n.type }));
      const timeout =
        n.timeoutMs ??
        (['condition', 'loop', 'value', 'assert', 'human'].includes(n.type) ? undefined : 60000);
      const deadline = new NodeDeadline(parent, instance, timeout);
      let result: any;
      try {
        result = await deadline.run(async () => {
          let output: any;
          if (n.type === 'condition') {
            const chosen = compare(
              resolveValue(n.actual, local),
              n.operator,
              resolveValue(n.expected, local),
            )
              ? n.then
              : n.else;
            deadline.check();
            output = await block(chosen, local, instance + '/', deadline);
          } else if (n.type === 'loop') {
            const items = resolveValue(n.items, local);
            deadline.check();
            if (!Array.isArray(items) || items.length > 1000)
              throw new Error('循环输入必须是最多 1000 项的数组');
            output = [];
            for (let i = 0; i < items.length; i++) {
              deadline.check();
              output.push(
                await block(
                  n.body,
                  { ...local, item: items[i], index: i },
                  instance + `[${i}]/`,
                  deadline,
                ),
              );
            }
          } else if (n.type === 'value') output = resolveValue(n.value, local);
          else if (n.type === 'assert') {
            if (
              !compare(resolveValue(n.actual, local), n.operator, resolveValue(n.expected, local))
            )
              throw new Error('结果断言失败：' + n.id);
            output = { verified: true };
          } else if (n.type === 'human') output = await ctx.human(n.message, deadline.signal);
          else {
            const resolved = resolveValue(n, local);
            deadline.check();
            output = await ctx.perform(n, resolved, instance, deadline.signal);
          }
          deadline.check();
          return output;
        });
      } finally {
        deadline.dispose();
      }
      // Work has completed within this node's budget. A slow durable event reply must
      // not retroactively time out that completed node; an enclosing budget still applies.
      parent.check();
      local.steps[n.id] = outputs[n.id] = result ?? null;
      await parent.run(() =>
        ctx.emit('node-end', instance, {
          completed: true,
          ...(ctx.captureResults ? { result: result ?? null } : {}),
        }),
      );
    }
    return outputs;
  }
  try {
    return await block(flow.steps, { params, steps: {} }, '', root);
  } finally {
    root.dispose();
  }
}
