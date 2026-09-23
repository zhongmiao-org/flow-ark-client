import { z } from 'zod';
import type { ToolDefinition } from './tool-connections';
import type { PlanningContext } from './planning';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const revision = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER - 1);
const task = { id, revision };
export const TOOL_CONTEXT_PREFIX = '_flowark_tool_';
export const toolsNotExecutable =
  '当前版本支持选择与保存工具对象；工具规划与执行尚未接入。可保留草稿，或移除工具选择后继续规划。';
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
