import type { ErrorObject, ValidateFunction } from 'ajv';
import * as nodeSchemas from '../shared/node-schema.generated.js';
import type { Flow, Step } from '../shared/types';
import { framePathOf, validateFormCommand } from '../core/browser-command';
import { changeSteps, checkStructure, flatten } from './flow-editing';

const validators = nodeSchemas as Record<string, ValidateFunction>;
const typeLabels: Record<string, string> = {
  string: '文字',
  number: '数字',
  integer: '整数',
  boolean: '布尔值',
  array: '数组',
  object: '对象',
  null: 'null',
};
function explain(error: ErrorObject | undefined, path: string): string {
  if (!error) return `${path}：节点字段不符合当前契约`;
  const field = path + error.instancePath;
  const params = error.params;
  switch (error.keyword) {
    case 'required':
      return `${field}：缺少字段 ${params.missingProperty}`;
    case 'type':
      return `${field}：必须是${typeLabels[params.type] ?? params.type}`;
    case 'additionalProperties':
      return `${field}：不支持字段 ${params.additionalProperty}`;
    case 'enum':
      return `${field}：请选择 ${params.allowedValues.join('、')}`;
    case 'const':
      return `${field}：必须为 ${JSON.stringify(params.allowedValue)}`;
    case 'minimum':
      return `${field}：不能小于 ${params.limit}`;
    case 'maximum':
      return `${field}：不能大于 ${params.limit}`;
    case 'minLength':
      return `${field}：至少需要 ${params.limit} 个字符`;
    case 'maxLength':
      return `${field}：不能超过 ${params.limit} 个字符`;
    case 'maxItems':
      return `${field}：不能超过 ${params.limit} 项`;
    case 'minItems':
      return `${field}：至少需要 ${params.limit} 项`;
    case 'pattern':
      return `${field}：格式不符合要求`;
    default:
      return `${field}：${error.message ?? '字段不符合当前契约'}`;
  }
}

function validateNode(
  value: unknown,
  path: string,
  depth: number,
  count: { value: number },
): asserts value is Step {
  if (depth > 16) throw new Error(`${path}：流程嵌套超过 16 层`);
  if (++count.value > 1000) throw new Error('流程最多包含 1000 个步骤');
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${path}：节点必须是对象`);
  const node = value as Record<string, unknown>;
  if (typeof node.type !== 'string') throw new Error(`${path}/type：必须是文字`);
  if (!Number.isInteger(node.version)) throw new Error(`${path}/version：必须是整数`);
  const key = `node_${node.type}_${node.version}`;
  if (!Object.hasOwn(validators, key))
    throw new Error(`${path}：不支持此节点类型或版本，请核对 type 和 version`);
  // Visit children first so a nested failure is reported against its own variant,
  // rather than an unrelated branch of the Node oneOf schema.
  const children =
    node.type === 'condition' ? ['then', 'else'] : node.type === 'loop' ? ['body'] : [];
  for (const field of children) {
    const items = node[field];
    if (Array.isArray(items))
      items.forEach((child, index) =>
        validateNode(child, `${path}/${field}/${index}`, depth + 1, count),
      );
  }
  const validate = validators[key];
  if (!validate(node)) throw new Error(explain(validate.errors?.[0], path));
  if (node.type === 'browser') {
    try {
      framePathOf(node as Extract<Step, { type: 'browser' }>);
      validateFormCommand(node as Extract<Step, { type: 'browser' }>, true);
    } catch (reason) {
      throw new Error(`${path}：${reason instanceof Error ? reason.message : '网页动作字段无效'}`);
    }
  }
}

export function parseNodeDraft(text: string, current: Step, flow: Flow): Step {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('节点配置必须是 JSON 对象');
  const identity = value as Record<string, unknown>;
  if (identity.id !== current.id || identity.type !== current.type)
    throw new Error('ID 和类型不可在此修改');
  validateNode(value, '$', 0, { value: 0 });
  const steps = changeSteps(flow.steps, current.id, () => value);
  const ids = new Set<string>();
  for (const node of flatten(steps)) {
    if (ids.has(node.id)) throw new Error(`节点 ID 重复：${node.id}`);
    ids.add(node.id);
  }
  checkStructure(flow.steps, steps, flow.parameters);
  return value;
}
