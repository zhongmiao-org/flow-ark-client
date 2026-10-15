import { z } from 'zod';
import { trial_preview_v1, trial_result_v1, trial_status_v1 } from './node-schema.generated';
export type {
  SkillTrialSource,
  SkillTrialPreview,
  SkillTrialRequest,
  SkillTrialResult,
  SkillTrialStatus,
} from './contracts.generated';
import type { SkillTrialPreview, SkillTrialResult, SkillTrialStatus } from './contracts.generated';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const trialSourceSchema = z
  .object({
    version: z.literal(1),
    proposalId: id,
    revision,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const trialRequestSchema = z
  .object({
    version: z.literal(1),
    requestId: id,
    source: trialSourceSchema,
    provider: z.enum(['deepseek', 'openai-codex']),
    model: z.string().min(1).max(100),
    instructions: z.string().max(16000),
  })
  .strict();
export const trialMethods = {
  'skill.trial.preview': z.object({ id, revision }).strict(),
  'skill.trial.start': trialRequestSchema,
  'conversation.trialStatus': z.object({ id }).strict(),
  'conversation.output': z.object({ id }).strict(),
};
export function assertTrialPreview(v: unknown): asserts v is SkillTrialPreview {
  if (!trial_preview_v1(v)) throw Error('试聊草稿预览格式无效');
}
export function assertTrialResult(v: unknown): asserts v is SkillTrialResult {
  if (!trial_result_v1(v)) throw Error('试聊回执格式无效');
}
export function assertTrialStatus(v: unknown): asserts v is SkillTrialStatus {
  if (!trial_status_v1(v)) throw Error('试聊来源状态格式无效');
}
