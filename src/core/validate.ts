import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../contracts/p1.schema.json';
import type { Flow, Step } from '../shared/types';
import { framePathOf, validateFormCommand } from './browser-command';
import { declaredDependencies } from './script-dependencies';
import { referenceIssues } from '../shared/flow-references';
import { mappingPreview } from '../shared/excel-mapping';
import { validateFileCreate } from '../shared/file-create';
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
  'file-create-v1',
  'excel',
  'excel-mapping-v1',
  'browser',
  'browser-frames-v1',
  'browser-forms-v1',
  'human',
  'condition',
  'loop',
  'openai-codex',
  'deepseek',
  'template-sdk-v1',
  'ai',
  'state',
  'attention',
  'effect',
];
export function validateFlow(value: unknown): Flow {
  const flow = validateObject<Flow>('FlowDefinition', value);
  for (const c of flow.requiredCapabilities)
    if (!capabilities.includes(c)) throw new Error('缺少能力：' + c);
  const all = new Set<string>();
  let count = 0;
  function block(steps: Step[], depth: number) {
    if (depth > 16) throw new Error('流程嵌套超过 16 层');
    for (const n of steps) {
      if (++count > 1000 || all.has(n.id)) throw new Error('节点数量过多或 ID 重复：' + n.id);
      all.add(n.id);
      if (n.type === 'file' && n.operation === 'create') {
        if (!flow.requiredCapabilities.includes('file-create-v1'))
          throw new Error('新建文本文件需要声明 file-create-v1 能力');
        validateFileCreate(n, flow.parameters);
      }
      if (n.type === 'excel' && n.operation === 'map') {
        if (!flow.requiredCapabilities.includes('excel-mapping-v1'))
          throw new Error('Excel 字段映射需要声明 excel-mapping-v1 能力');
        mappingPreview(n, flow.parameters);
      }
      if (n.type === 'browser') {
        framePathOf(n);
        validateFormCommand(n, true);
      }
      if (n.type === 'condition') {
        block(n.then, depth + 1);
        block(n.else, depth + 1);
      }
      if (n.type === 'loop') block(n.body, depth + 1);
    }
  }
  block(flow.steps, 0);
  const issue = referenceIssues(flow.steps, flow.parameters)[0];
  if (issue) throw new Error(`${issue.message}：${issue.reference}（${issue.nodeId}）`);
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
