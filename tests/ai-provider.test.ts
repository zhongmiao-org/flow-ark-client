import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/ai/providers';
const base = {
  model: 'fixture-model',
  instructions: 'Echo only',
  input: { value: 3 },
  schema: {
    type: 'object',
    properties: { value: { type: 'number' } },
    required: ['value'],
    additionalProperties: false,
  },
};
test('bound provider transport uses structured JSON with no tools and rejects incomplete, malformed and HTTP failures without fallback', async () => {
  for (const provider of ['deepseek', 'openai-codex'] as const) {
    let calls = 0;
    const fake = (async (url: any, opts: any) => {
      calls++;
      const body = JSON.parse(opts.body);
      assert.equal(body.model, base.model);
      assert.equal(body.tools, undefined);
      assert.match(
        url,
        provider === 'deepseek' ? /deepseek.com\/chat\/completions/ : /openai.com\/v1\/responses/,
      );
      return new Response(
        JSON.stringify(
          provider === 'deepseek'
            ? { choices: [{ finish_reason: 'stop', message: { content: '{"value":3}' } }] }
            : {
                status: 'completed',
                output: [
                  { type: 'message', content: [{ type: 'output_text', text: '{"value":3}' }] },
                ],
              },
        ),
      );
    }) as typeof fetch;
    assert.deepEqual(
      (await generate({ ...base, provider }, 'fictional', new AbortController().signal, fake))
        .output,
      { value: 3 },
    );
    assert.equal(calls, 1);
    for (const status of [401, 429, 500]) {
      let n = 0;
      await assert.rejects(
        generate({ ...base, provider }, 'fictional', new AbortController().signal, (async () => {
          n++;
          return new Response('{}', { status });
        }) as typeof fetch),
      );
      assert.equal(n, 1);
    }
  }
  await assert.rejects(
    generate(
      { ...base, provider: 'deepseek' },
      'fictional',
      new AbortController().signal,
      (async () =>
        new Response(
          JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }),
        )) as typeof fetch,
    ),
    /未完成/,
  );
});
