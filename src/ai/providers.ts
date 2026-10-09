import type { AIRequest, AIResult } from '../shared/types';
import { validateObject } from '../core/validate';
import { validateData } from '../../contracts/package-format';
import {
  ATTACHMENT_PREFIX,
  IMAGE_MAX_BYTES,
  IMAGE_TOTAL_BYTES,
  type PlanningImageV1,
} from '../shared/task-attachments';
export async function generate(
  input: AIRequest,
  key: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  images: PlanningImageV1[] = [],
  budget: 'standard' | 'planning' = 'standard',
): Promise<AIResult> {
  validateObject('AIRequest', input);
  const deep = input.provider === 'deepseek';
  const maxTokens = budget === 'planning' ? 16384 : 4096;
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
  const response = await fetcher(
    deep ? 'https://api.deepseek.com/chat/completions' : 'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
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
    },
  );
  if (!response.ok) throw new Error('AI 接口 HTTP ' + response.status + '；未重试或切换供应商');
  const body: any = await response.json();
  const incompleteReason = deep
    ? body.choices?.[0]?.finish_reason
    : body.incomplete_details?.reason;
  if (incompleteReason === 'length' || incompleteReason === 'max_output_tokens')
    throw new Error(
      'AI 生成达到输出或上下文长度限制，未返回完整结果。请减少本次内容或分次描述修改。',
    );
  if (incompleteReason === 'content_filter')
    throw new Error('AI 服务因内容限制未能提供完整结果。请检查任务描述和所选资料后重新生成。');
  if (deep && incompleteReason === 'insufficient_system_resource')
    throw new Error('AI 服务暂时无法完成生成，请稍后手动重试。');
  if (
    deep
      ? body.choices?.[0]?.finish_reason !== 'stop'
      : body.status !== 'completed' || body.error || body.incomplete_details
  )
    throw new Error('AI 返回未完成结果');
  const text = deep
    ? body.choices[0].message.content
    : body.output
        ?.filter((m: any) => m.type === 'message')
        .flatMap((m: any) => m.content ?? [])
        .filter((c: any) => c.type === 'output_text')
        .map((c: any) => c.text)
        .join('');
  const output: any = validateData(input.schema, JSON.parse(text));
  return {
    provider: input.provider,
    model: body.model ?? input.model,
    requestId: body.id ?? '',
    output,
    usage: body.usage ?? null,
  };
}
