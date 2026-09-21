import type { AIRequest, AIResult } from '../shared/types';
import { validateObject } from '../core/validate';
import { validateData } from '../../contracts/package-format';
export async function generate(
  input: AIRequest,
  key: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<AIResult> {
  validateObject('AIRequest', input);
  const deep = input.provider === 'deepseek';
  const response = await fetcher(
    deep ? 'https://api.deepseek.com/chat/completions' : 'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
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
                { role: 'user', content: JSON.stringify(input.input) },
              ],
              response_format: { type: 'json_object' },
              max_tokens: 4096,
              stream: false,
            }
          : {
              model: input.model,
              store: false,
              instructions: input.instructions,
              input: JSON.stringify(input.input),
              max_output_tokens: 4096,
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
