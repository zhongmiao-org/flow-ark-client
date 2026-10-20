import { assertAIGenerationOptions, type AIGenerationOptions } from '../../contracts/ai-generation';
import type { AIRequest, AIResult } from '../shared/types';
import Ajv from 'ajv/dist/2020.js';
import { aiMetadata } from '../shared/ai-outcome';
import { assertAISchema } from '../shared/ai-node';
import { AIRequestFailureError } from './request-failure';
import { outputFieldFeedback } from './output-feedback';
import { validateObject } from '../core/validate';
import { validateData } from '../../contracts/package-format';
import {
  ATTACHMENT_PREFIX,
  IMAGE_MAX_BYTES,
  IMAGE_TOTAL_BYTES,
  type PlanningImageV1,
} from '../shared/task-attachments';

function requestPending<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => {
      signal.removeEventListener('abort', stop);
      reject(signal.reason);
    };
    pending.then(
      (value) => {
        signal.removeEventListener('abort', stop);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', stop);
        reject(error);
      },
    );
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
  });
}
// JSON.parse accepts overflow such as 1e400 as Infinity. Do not let serialization
// silently turn that model value into null, even when the output schema is open.
function finiteJsonNumbers(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === 'number' && !Number.isFinite(item)) return false;
    if (item && typeof item === 'object')
      for (const child of Object.values(item)) pending.push(child);
  }
  return true;
}
export async function generate(
  input: AIRequest,
  key: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  images: PlanningImageV1[] = [],
  budget: 'standard' | 'planning' = 'standard',
  structuredOutcome = false,
  generation?: AIGenerationOptions,
): Promise<AIResult> {
  validateObject('AIRequest', input);
  if (generation !== undefined) assertAIGenerationOptions(generation, input.provider);
  // Local preparation is outside the request fault boundary. Invalid schemas are not
  // model failures and must never consume a request or become a handled result.
  let validateOutput: ReturnType<Ajv['compile']> | undefined;
  if (structuredOutcome) {
    assertAISchema(input.schema);
    validateOutput = new Ajv({ strict: false, allErrors: true, logger: false }).compile(
      input.schema as any,
    );
    if ((validateOutput as any).$async) throw new Error('结构化AI节点不支持异步输出Schema');
  }
  let metadata = aiMetadata(input.provider, input.model);
  let httpStatus: number | null = null;
  const fail = (
    code: ConstructorParameters<typeof AIRequestFailureError>[0],
    message: string,
  ): never => {
    if (!structuredOutcome) throw new Error(message);
    throw new AIRequestFailureError(code, metadata, httpStatus, message);
  };
  const deep = input.provider === 'deepseek';
  const maxTokens = generation?.maxOutputTokens ?? (budget === 'planning' ? 16384 : 4096);
  const timeoutMs = budget === 'planning' ? 120000 : 45000;
  let total = 0;
  if (images.length > 4) throw new Error('每次最多发送四张图片');
  for (const image of images) {
    if (typeof image.data !== 'string' || image.data.length > Math.ceil(IMAGE_MAX_BYTES / 3) * 4)
      throw new Error('图片输入无效或超过限制');
    const bytes = Buffer.from(image.data, 'base64');
    if (
      !['image/png', 'image/jpeg'].includes(image.mimeType) ||
      !bytes.length ||
      bytes.length > IMAGE_MAX_BYTES ||
      bytes.toString('base64') !== image.data
    )
      throw new Error('图片输入无效或超过限制');
    total += bytes.length;
  }
  if (total > IMAGE_TOTAL_BYTES) throw new Error('图片总量超过 12 MiB');
  const inputText = JSON.stringify(input.input);
  const pictureParts = images.flatMap((image) => [
    deep
      ? { type: 'text', text: `附件 ${ATTACHMENT_PREFIX}${image.id}：${image.name}` }
      : { type: 'input_text', text: `附件 ${ATTACHMENT_PREFIX}${image.id}：${image.name}` },
    deep
      ? { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } }
      : {
          type: 'input_image',
          image_url: `data:${image.mimeType};base64,${image.data}`,
          detail: 'auto',
        },
  ]);
  const requestTimeout = AbortSignal.timeout(timeoutMs);
  const requestSignal = AbortSignal.any([signal, requestTimeout]);
  const requestOptions: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    signal: requestSignal,
    redirect: 'error',
    body: JSON.stringify(
      deep
        ? {
            model: input.model,
            messages: [
              {
                role: 'system',
                content:
                  input.instructions +
                  '\n只输出符合以下 JSON Schema 的完整 JSON：' +
                  JSON.stringify(input.schema),
              },
              {
                role: 'user',
                content: images.length
                  ? [{ type: 'text', text: inputText }, ...pictureParts]
                  : inputText,
              },
            ],
            response_format: { type: 'json_object' },
            max_tokens: maxTokens,
            ...(generation && generation.thinking !== 'provider-default'
              ? { thinking: { type: generation.thinking } }
              : {}),
            stream: false,
          }
        : {
            model: input.model,
            store: false,
            instructions: input.instructions,
            input: images.length
              ? [
                  {
                    role: 'user',
                    content: [{ type: 'input_text', text: inputText }, ...pictureParts],
                  },
                ]
              : inputText,
            max_output_tokens: maxTokens,
            text: {
              format: {
                type: 'json_schema',
                name: 'template_result',
                strict: true,
                schema: input.schema,
              },
            },
          },
    ),
  };
  const pendingResponse = fetcher(
    deep ? 'https://api.deepseek.com/chat/completions' : 'https://api.openai.com/v1/responses',
    requestOptions,
  );
  let response: Response;
  try {
    response = structuredOutcome
      ? await requestPending(pendingResponse, requestSignal)
      : await pendingResponse;
  } catch (error) {
    if (!structuredOutcome) throw error;
    signal.throwIfAborted();
    if (requestTimeout.aborted) fail('request-timeout', 'AI 请求等待超时');
    if (error instanceof TypeError) fail('network', 'AI 网络请求未完成');
    throw error;
  }
  httpStatus = response.status;
  if (structuredOutcome) {
    signal.throwIfAborted();
    if (requestTimeout.aborted) fail('request-timeout', 'AI 请求等待超时');
    metadata = aiMetadata(
      input.provider,
      input.model,
      undefined,
      response.headers.get('x-request-id'),
    );
  }
  if (!response.ok)
    fail(
      response.status === 401 || response.status === 403
        ? 'authentication'
        : response.status === 429
          ? 'rate-limit'
          : 'http',
      'AI 接口 HTTP ' + response.status + '；未重试或切换供应商',
    );
  const pendingBody = response.json();
  let body: any;
  try {
    body = structuredOutcome ? await requestPending(pendingBody, requestSignal) : await pendingBody;
  } catch (error) {
    if (!structuredOutcome) throw error;
    signal.throwIfAborted();
    if (requestTimeout.aborted) fail('request-timeout', 'AI 请求等待超时');
    if (error instanceof SyntaxError) fail('invalid-response', 'AI 响应JSON无效');
    if (error instanceof TypeError) fail('network', 'AI 响应体网络读取未完成');
    throw error;
  }
  if (structuredOutcome)
    metadata = aiMetadata(input.provider, input.model, body, metadata.requestId);
  if (structuredOutcome) {
    signal.throwIfAborted();
    if (requestTimeout.aborted) fail('request-timeout', 'AI 请求等待超时');
    if (!body || typeof body !== 'object' || Array.isArray(body))
      fail('invalid-response', 'AI 响应结构无效');
    if (
      deep
        ? !Array.isArray(body.choices) ||
          !body.choices[0]?.message ||
          typeof body.choices[0].message !== 'object'
        : !Array.isArray(body.output) || typeof body.status !== 'string'
    )
      fail('invalid-response', 'AI 响应结构无效');
    const refused = deep
      ? typeof body.choices[0].message.refusal === 'string'
      : body.output.some(
          (m: any) =>
            m?.type === 'message' &&
            Array.isArray(m.content) &&
            m.content.some((c: any) => c?.type === 'refusal'),
        );
    if (refused) fail('refused', 'AI 服务拒绝生成');
  }
  const incompleteReason = deep
    ? body.choices?.[0]?.finish_reason
    : body.incomplete_details?.reason;
  if (incompleteReason === 'length' || incompleteReason === 'max_output_tokens')
    fail(
      'incomplete',
      'AI 生成达到输出或上下文长度限制，未返回完整结果。请减少本次内容或分次描述修改。',
    );
  if (incompleteReason === 'content_filter')
    fail('refused', 'AI 服务因内容限制未能提供完整结果。请检查任务描述和所选资料后重新生成。');
  if (deep && incompleteReason === 'insufficient_system_resource')
    fail('incomplete', 'AI 服务暂时无法完成生成，请稍后手动重试。');
  if (
    deep
      ? body.choices?.[0]?.finish_reason !== 'stop'
      : body.status !== 'completed' || body.error || body.incomplete_details
  )
    fail('incomplete', 'AI 返回未完成结果');
  if (
    structuredOutcome &&
    !deep &&
    body.output.some(
      (m: any) =>
        !m ||
        typeof m !== 'object' ||
        (m.type === 'message' &&
          (!Array.isArray(m.content) ||
            m.content.some(
              (c: any) =>
                !c ||
                typeof c !== 'object' ||
                (c.type === 'output_text' && typeof c.text !== 'string'),
            ))),
    )
  )
    fail('invalid-response', 'AI 消息结构无效');
  const text = deep
    ? body.choices[0].message.content
    : body.output
        ?.filter((m: any) => m.type === 'message')
        .flatMap((m: any) => m.content ?? [])
        .filter((c: any) => c.type === 'output_text')
        .map((c: any) => c.text)
        .join('');
  let output: any;
  if (structuredOutcome) {
    if (typeof text !== 'string') fail('invalid-response', 'AI 输出正文类型无效');
    try {
      output = JSON.parse(text);
    } catch (error) {
      if (error instanceof SyntaxError) fail('invalid-response', 'AI 输出JSON无效');
      throw error;
    }
    if (!finiteJsonNumbers(output)) fail('invalid-response', '模型返回的数字无效，未采用此结果。');
    if (!validateOutput!(output))
      fail('invalid-response', outputFieldFeedback(input.schema, output, validateOutput!.errors));
    signal.throwIfAborted();
    if (requestTimeout.aborted) fail('request-timeout', 'AI 请求等待超时');
  } else output = validateData(input.schema, JSON.parse(text));
  return {
    provider: input.provider,
    model: body.model ?? input.model,
    requestId: body.id ?? '',
    output,
    usage: body.usage ?? null,
  };
}
