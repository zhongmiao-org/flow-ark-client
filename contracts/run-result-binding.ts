/** Format and declarations only; never proves an actual historical source or permission. */
import Ajv from 'ajv/dist/2020.js';
import schema from './run-result-binding.schema.json';

export const runResultCapability = 'run-result-read-v1';
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema);
export function assertRunResultNode(node: any, capabilities: string[], definition?: any, entry?: any) {
  if (node.type !== 'run-result') return;
  const check = ajv.getSchema(schema.$id + '#/$defs/Node')!;
  if (!check(node)) throw Error('已保存结果读取节点格式无效');
  if (!capabilities.includes(runResultCapability)) throw Error('流程未声明已保存结果读取能力');
  if (!definition) return;
  const resource = definition.resources.find((r: any) => r.id === node.binding);
  if (resource?.kind !== 'run-result' || resource.access !== 'read' ||
      !entry?.resources?.includes(node.binding) || !entry?.capabilities?.includes(runResultCapability))
    throw Error('入口未声明对应只读结果资源或读取能力');
}
export function assertRunResultResources(definition: any) {
  const entries = new Set(definition.entries.map((e: any) => e.id));
  const check = ajv.getSchema(schema.$id + '#/$defs/Resource')!;
  for (const resource of definition.resources.filter((r: any) => r.kind === 'run-result')) {
    if (!check(resource) || resource.sourceEntries.some((id: string) => !entries.has(id)))
      throw Error('已保存结果来源入口声明无效');
  }
}
