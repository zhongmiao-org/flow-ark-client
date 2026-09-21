import { z } from 'zod';
import type { FlowArkP1 } from './contracts.generated';
import type { Flow, FlowRecord } from './types';
import type { RepairSelection } from './task-repair';
import { repairGenerateSchema, repairPreviewSchema, type RepairReference } from './task-repair';
import { planningScopeSchema, type PlanningScope } from './planning-scope';
import { webTargetMethods, WEB_CONTEXT_ID, type TaskWebTarget } from './task-web-target';

import { outputMethods, OUTPUT_CONTEXT_ID, type TaskOutputTarget } from './task-output';
import { attachmentMethods, ATTACHMENT_PREFIX, type TaskAttachment } from './task-attachments';

export type PlanningInput = NonNullable<FlowArkP1['AIPlanningRequest']>;
export type PlanningResult = NonNullable<FlowArkP1['AIPlanningResult']>;
export type PlanningContext = NonNullable<FlowArkP1['AIPlanningContext']>;
export type TaskStatus =
  | 'draft'
  | 'generating'
  | 'plan'
  | 'clarify'
  | 'unsupported'
  | 'failed'
  | 'cancelled';
export type PlanningTask = {
  attachments?: TaskAttachment[];
  webTarget?: TaskWebTarget;
  outputTarget?: TaskOutputTarget;
  scope?: PlanningScope;
  appliedRepair?: {
    proposalId: string;
    runId: string;
    nodeId: string;
    selection: RepairSelection;
    flowHash: string;
  };
  id: string;
  revision: number;
  description: string;
  context: PlanningInput['context'];
  answers: Record<string, string>;
  flowId: string;
  status: TaskStatus;
  updatedAt: string;
  provider?: 'deepseek' | 'openai-codex';
  model?: string;
  requestId?: string;
  error?: string;
};
export type PlanningProposal = {
  scope?: PlanningScope;
  repair?: RepairReference;
  id: string;
  baseRevision: number;
  baseFlowHash: string;
  baseFlow: Flow | null;
  result: PlanningResult;
  createdAt: string;
};
export type PlanningChange = {
  kind: 'added' | 'removed' | 'changed' | 'moved';
  path: string;
  label: string;
  nodeId?: string;
  before: unknown;
  after: unknown;
};
export type TaskDetail = {
  flowHash: string;
  task: PlanningTask;
  flow: FlowRecord | null;
  proposal?: PlanningProposal;
  changes: PlanningChange[];
  resources: string[];
  conflict: boolean;
  canUndo: boolean;
};
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const revision = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER - 1);
const task = z.object({ id }).strict();
const version = { id, revision };
const proposal = z.object({ ...version, proposalId: id }).strict();
const context = z
  .object({
    id,
    kind: z.enum(['text', 'web', 'file', 'image', 'application', 'mcp']),
    label: z.string().min(1).max(200),
    text: z.string().max(50000),
  })
  .strict();
export const taskMethods = {
  ...attachmentMethods,
  ...webTargetMethods,
  ...outputMethods,
  'task.repair.preview': repairPreviewSchema,
  'task.repair.generate': repairGenerateSchema,
  'task.create': z.object({ flowId: id.optional() }).strict(),
  'task.list': z.object({}).strict(),
  'task.detail': task,
  'task.save': z
    .object({
      ...version,
      description: z.string().max(20000),
      scope: planningScopeSchema.optional(),
      context: z
        .array(context)
        .max(20)
        .refine(
          (entries) => entries.reduce((n, e) => n + e.text.length, 0) <= 200000,
          '上下文总文本超过 200000 字符',
        )
        .refine(
          (entries) => new Set(entries.map((e) => e.id)).size === entries.length,
          '上下文 ID 重复',
        )
        .refine(
          (entries) =>
            entries.every(
              (e) =>
                e.id !== WEB_CONTEXT_ID &&
                e.id !== OUTPUT_CONTEXT_ID &&
                !e.id.startsWith(ATTACHMENT_PREFIX),
            ),
          '网页来源必须通过选择目标取得，不能伪造系统资料',
        ),
      answers: z
        .record(id, z.string().max(3000))
        .refine((value) => Object.keys(value).length <= 30),
    })
    .strict(),
  'task.generate': z
    .object({
      ...version,
      provider: z.enum(['deepseek', 'openai-codex']),
      model: z.string().trim().min(1).max(100),
      reviewed: z.literal(true),
    })
    .strict(),
  'task.cancel': task,
  'task.adopt': proposal,
  'task.reject': proposal,
  'task.undo': z.object(version).strict(),
};
