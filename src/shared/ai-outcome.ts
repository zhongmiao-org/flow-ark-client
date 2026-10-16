import type { AINodeReceipt, AIRequestFailure } from './types';
import type { AIUsage } from './contracts.generated';

export const aiOutcomeCapability = 'ai-outcome-v1';
export const aiOutcomeModel = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/;
export const aiRequestId = (value: unknown): string | null =>
  typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,200}$/.test(value) ? value : null;

export const aiFailureMessages = {
  authentication: 'AI 服务拒绝鉴权，请检查自己的 Key 与模型权限。',
  'rate-limit': 'AI 服务限流，请稍后自行重新运行。',
  http: 'AI 接口返回请求错误，请核对服务状态与请求配置。',
  network: 'AI 网络请求未完成，请核对连接后自行重新运行。',
  'request-timeout': 'AI 请求等待超时，未采用结果；不会自动重试。',
  refused: 'AI 服务拒绝生成，未采用正文。',
  incomplete: 'AI 未返回完整结果，未采用部分正文。',
  'invalid-response': 'AI 响应或输出格式无效，未采用正文。',
} as const satisfies Record<AIRequestFailure['error']['code'], string>;

const counters = [
  'prompt_tokens',
  'completion_tokens',
  'total_tokens',
  'input_tokens',
  'output_tokens',
  'prompt_cache_hit_tokens',
  'prompt_cache_miss_tokens',
];
const details = [
  'prompt_tokens_details',
  'completion_tokens_details',
  'input_tokens_details',
  'output_tokens_details',
];
const detailCounters = [
  'cached_tokens',
  'reasoning_tokens',
  'audio_tokens',
  'accepted_prediction_tokens',
  'rejected_prediction_tokens',
];
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const counter = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

/** Only known numeric counters enter receipts; no response strings or inferred zeroes. */
export function aiUsage(value: unknown): AIUsage {
  if (!object(value)) return null;
  const result: Record<string, number | Record<string, number>> = {};
  for (const key of counters) if (counter(value[key])) result[key] = value[key];
  for (const key of details) {
    const source = value[key];
    if (!object(source)) continue;
    const retained = Object.fromEntries(
      detailCounters.filter((k) => counter(source[k])).map((k) => [k, source[k] as number]),
    );
    if (Object.keys(retained).length) result[key] = retained;
  }
  if (!Object.keys(result).length || new TextEncoder().encode(JSON.stringify(result)).length > 4096)
    return null;
  return result as AIUsage;
}

export function aiMetadata(
  provider: AIRequestFailure['provider'],
  model: string,
  body?: unknown,
  headerId?: unknown,
) {
  const source = object(body) ? body : {};
  return {
    provider,
    model:
      typeof source.model === 'string' && aiOutcomeModel.test(source.model)
        ? source.model
        : aiOutcomeModel.test(model)
          ? model
          : 'unknown-model',
    requestId: aiRequestId(source.id) ?? aiRequestId(headerId),
    usage: aiUsage(source.usage),
  };
}

export function aiReceiptMessage(receipt: AINodeReceipt): string {
  return receipt.status === 'failed'
    ? receipt.error.message
    : 'AI请求成功，已取得通过格式校验的完整结构化结果；业务事实与外发仍须独立核对。';
}
