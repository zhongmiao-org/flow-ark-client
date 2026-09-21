import { z } from 'zod';

export const aiProvider = z.enum(['deepseek', 'openai-codex']);
export type AIProviderId = z.infer<typeof aiProvider>;
export const aiModel = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[\x21-\x7e]+$/);
export const aiKey = z
  .string()
  .min(8)
  .max(1000)
  .regex(/^[\x21-\x7e]+$/);
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const requestId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const aiConfigurationMethods = {
  'ai.configuration.get': z.object({ provider: aiProvider }).strict(),
  'ai.configuration.save': z
    .object({
      provider: aiProvider,
      revision: revision.nullable(),
      model: aiModel,
      apiKey: aiKey.optional(),
    })
    .strict(),
  'ai.configuration.remove': z
    .object({ provider: aiProvider, revision, confirmed: z.literal(true) })
    .strict(),
  'ai.configuration.test': z
    .object({ provider: aiProvider, revision, requestId, reviewedCost: z.literal(true) })
    .strict(),
  'ai.configuration.cancel': z.object({ provider: aiProvider, requestId }).strict(),
};
export const defaultAIModel = (provider: AIProviderId) =>
  provider === 'deepseek' ? 'deepseek-flash' : 'gpt-5.3-codex';
export type AIConfiguration = {
  provider: AIProviderId;
  configured: boolean;
  revision: string | null;
  model: string;
  tail?: string;
};
export type AIErrorCode =
  | 'authentication'
  | 'quota'
  | 'request'
  | 'network'
  | 'timeout'
  | 'output'
  | 'storage';
export type AIConnectionTest = {
  revision: string;
  requestId: string;
  status: 'testing' | 'passed' | 'failed' | 'cancelled' | 'interrupted';
  at: string;
  model?: string;
  code?: AIErrorCode;
};
export type AIConfigurationState = AIConfiguration & {
  test: AIConnectionTest | null;
  operation: 'saving' | 'removing' | 'testing' | null;
  inUse: boolean;
};
export const aiErrorMessage: Record<AIErrorCode, string> = {
  authentication: '鉴权失败，请核对该服务的 Key 和账号权限。',
  quota: '余额不足或请求受限，请处理额度或稍后主动重试。',
  request: '模型或请求不可用，请核对当前账号可用的模型 ID。',
  network: '服务暂时无法连接，请核对网络后重试。',
  timeout: '连接测试超时，配置已保留。',
  output: '服务返回的内容未通过固定测试格式校验。',
  storage: '系统凭据或本地状态不可用，请恢复后重试。',
};
