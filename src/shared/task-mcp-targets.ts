import { z } from 'zod';
import type { ToolDefinition } from './tool-connections';
import type { PlanningContext } from './planning';
import type { Flow, Step } from './types';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const revision = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER - 1);
const task = { id, revision };
export const TOOL_CONTEXT_PREFIX = '_flowark_tool_';
export const toolsExecutionNotice =
  '选择和采纳不会调用工具；执行需从原任务核对工具、参数和外部影响，再明确确认本次试运行。';
export type TaskMcpTarget = {
  version: 1;
  selectionId: string;
  taskId: string;
  connectionId: string;
  connectionRevision: number;
  capabilityDigest: string;
  selectedAt: string;
  displayName: string;
  source: string;
  transport: 'http' | 'stdio';
  protocolVersion: string;
  testedAt: string;
  tools: ToolDefinition[];
};
export type TaskMcpPreview = { token: string; expiresAt: number; target: TaskMcpTarget };
export type TaskMcpState = { selectionId: string; current: boolean; reason?: string };
export const taskToolMethods = {
  'task.tools.preview': z
    .object({
      ...task,
      connectionId: id,
      connectionRevision: revision,
      toolNames: z
        .array(z.string().min(1).max(500))
        .min(1)
        .max(30)
        .refine((names) => new Set(names).size === names.length),
    })
    .strict(),
  'task.tools.select': z.object({ ...task, token: id }).strict(),
  'task.tools.cancel': z.object({ id, token: id }).strict(),
  'task.tools.clear': z.object({ ...task, selectionId: id }).strict(),
};
export function toolContexts(targets: readonly TaskMcpTarget[] = []): PlanningContext[] {
  return targets.map((target) => ({
    id: TOOL_CONTEXT_PREFIX + target.selectionId,
    kind: 'mcp',
    label: target.displayName,
    text: JSON.stringify({
      target: target.selectionId,
      name: target.displayName,
      source: target.source,
      tools: target.tools,
    }),
  }));
}

export function assertMcpPlan(
  flow: Flow,
  targets: readonly TaskMcpTarget[] = [],
  outputBinding?: string,
) {
  const visit = (steps: Step[]) => {
    for (const node of steps) {
      if (node.type === 'mcp') {
        const target = targets.find((target) => target.selectionId === node.target);
        if (!target?.tools.some((tool) => tool.name === node.tool))
          throw new Error('方案使用了未选择的连接或工具：' + node.id);
      } else if (targets.length && node.type === 'file') {
        if (!outputBinding || node.binding !== outputBinding)
          throw new Error('工具方案只能写入明确选择的任务输出');
      } else if (
        targets.length &&
        !['value', 'assert', 'condition', 'loop', 'human'].includes(node.type)
      )
        throw new Error('工具方案不支持通过其他连接、HTTP、脚本或网页绕过所选工具范围');
      if (node.type === 'condition') {
        visit(node.then);
        visit(node.else);
      }
      if (node.type === 'loop') visit(node.body);
    }
  };
  visit(flow.steps);
}
