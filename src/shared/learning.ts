import { z } from 'zod';

export const learningPrompt =
  '读取我明确选择的网页标题，非空时在我选择的输出目录新建“页面标题.txt”，同名自动加序号并保留原文件；标题为空时结束并提醒我。只读取这个网页，不提交表单、不发送消息。请先确认网页和输出目录，展示步骤后再由我决定试运行。';
export const learningSteps = ['选目标', '看方案', '试一次', '找结果'] as const;
export type LearningProgress = {
  revision: number;
  status: 'new' | 'active' | 'skipped' | 'completed';
  attemptId?: string;
  taskId?: string;
  updatedAt?: string;
  achieved: {
    target?: { at: string; selectionId: string };
    plan?: { at: string; flowHash: string };
    trial?: { at: string; runId: string };
    result?: { at: string; runId: string; artifactId: string };
  };
};
export type LearningStatus = LearningProgress & { taskExists: boolean; latestRunId?: string };
const revision = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER - 1);
export const learningMethods = {
  'learning.status': z.object({}).strict(),
  'learning.start': z.object({ revision, mode: z.enum(['continue', 'restart']) }).strict(),
  'learning.skip': z.object({ revision }).strict(),
};
