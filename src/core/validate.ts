import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../contracts/p1.schema.json';
import type { Flow, Step } from '../shared/types';
import { framePathOf, validateFormCommand } from './browser-command';
import { declaredDependencies } from './script-dependencies';
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema(schema);
export function validateObject<T>(name: string, value: unknown): T {
  const validator = ajv.getSchema(schema.$id + '#/$defs/' + name)!;
  if (!validator(value))
    throw new Error(
      `格式无效 (${name}): ` + ajv.errorsText(validator.errors, { separator: '; ' }).slice(0, 1500),
    );
  return value as T;
}
export const capabilities = [
  'value',
  'assert',
  'http',
  'script',
  'file',
  'excel',
  'browser',
  'browser-frames-v1',
  'browser-forms-v1',
  'human',
  'condition',
  'loop',
  'recruiting',
  'recruiting-job-filter-v1',
  'boss',
  'zhaopin',
  'openai-codex',
  'deepseek',
];
const badKeys = new Set(['__proto__', 'constructor', 'prototype']);
export function validateFlow(value: unknown): Flow {
  const flow = validateObject<Flow>('FlowDefinition', value);
  for (const c of flow.requiredCapabilities)
    if (!capabilities.includes(c)) throw new Error('缺少能力：' + c);
  const all = new Set<string>();
  let count = 0;
  function values(v: any, scope: Set<string>, inLoop: boolean) {
    if (!v || typeof v !== 'object') return;
    if ('$ref' in v) {
      if (Object.keys(v).length !== 1 || typeof v.$ref !== 'string')
        throw new Error('引用必须是单键 $ref 对象');
      const [root, id, ...tail] = v.$ref.split('.');
      if ([id, ...tail].some((p) => badKeys.has(p))) throw new Error('非法引用属性');
      if (
        root === 'steps'
          ? !scope.has(id)
          : root === 'params'
            ? !(id in flow.parameters)
            : root === 'item' || root === 'index'
              ? !inLoop
              : true
      )
        throw new Error('引用不存在或作用域越界：' + v.$ref);
    } else
      for (const [k, x] of Object.entries(v)) {
        if (badKeys.has(k)) throw new Error('非法属性');
        values(x, scope, inLoop);
      }
  }
  function block(steps: Step[], inherited: Set<string>, inLoop: boolean, depth: number) {
    if (depth > 16) throw new Error('流程嵌套超过 16 层');
    const scope = new Set(inherited);
    for (const n of steps) {
      if (++count > 1000 || all.has(n.id)) throw new Error('节点数量过多或 ID 重复：' + n.id);
      all.add(n.id);
      if (n.type === 'browser') {
        framePathOf(n);
        validateFormCommand(n, true);
      }
      const { then: yes, else: no, body, ...rest } = n as any;
      values(rest, scope, inLoop);
      if (n.type === 'condition') {
        block(n.then, scope, inLoop, depth + 1);
        block(n.else, scope, inLoop, depth + 1);
      }
      if (n.type === 'loop') block(n.body, scope, true, depth + 1);
      scope.add(n.id);
    }
  }
  block(flow.steps, new Set(), false, 0);
  declaredDependencies(walk(flow.steps));
  return flow;
}
export function walk(steps: Step[]): Step[] {
  return steps.flatMap((n) => [
    n,
    ...(n.type === 'condition'
      ? [...walk(n.then), ...walk(n.else)]
      : n.type === 'loop'
        ? walk(n.body)
        : []),
  ]);
}
