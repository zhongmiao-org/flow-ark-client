import { assertAIGenerationOptions } from '../../contracts/ai-generation';
import type { Bindings, Flow, Json, Step } from './types';
import { aiOutcomeModel } from './ai-outcome';

export const aiNodeCapability = 'ai-node-v1';
export type AINode = Extract<Step, { type: 'ai' }>;
export const defaultAISchema = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
};
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

export function aiNodes(steps: Step[]): AINode[] {
  return steps.flatMap((node): AINode[] =>
    node.type === 'ai'
      ? [node]
      : node.type === 'condition'
        ? [...aiNodes(node.then), ...aiNodes(node.else)]
        : node.type === 'loop'
          ? aiNodes(node.body)
          : [],
  );
}
export function assertAISchema(schema: unknown): asserts schema is Record<string, Json> {
  if (
    !schema ||
    typeof schema !== 'object' ||
    Array.isArray(schema) ||
    (schema as Record<string, unknown>).type !== 'object'
  )
    throw new Error('AI 输出格式必须为根类型 object 的 JSON Schema');
  if (bytes(schema) > 65536) throw new Error('AI 输出格式超过 64 KiB');
  let count = 0;
  function visit(value: unknown, depth: number, context: 'schema' | 'literal' | 'map' = 'schema') {
    if (++count > 5000 || depth > 32) throw new Error('AI 输出格式过于复杂');
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (
        context === 'schema' &&
        key === '$ref' &&
        (typeof child !== 'string' || !(child === '#' || child.startsWith('#/')))
      )
        throw new Error('AI 输出格式只允许本地 Schema 引用');
      const next =
        context === 'literal'
          ? 'literal'
          : context === 'map'
            ? 'schema'
            : ['const', 'enum', 'default', 'examples'].includes(key)
              ? 'literal'
              : [
                    'properties',
                    'patternProperties',
                    '$defs',
                    'definitions',
                    'dependentSchemas',
                  ].includes(key)
                ? 'map'
                : 'schema';
      visit(child, depth + 1, next);
    }
  }
  visit(schema, 0);
}
export function assertAIRequest(node: AINode, input: unknown = node.input) {
  if (node.version === 3) assertAIGenerationOptions(node.generation);
  if (!node.instructions.trim()) throw new Error('AI 指令不能为空或只有空白');
  assertAISchema(node.schema);
  if (bytes({ instructions: node.instructions, input, schema: node.schema }) > 1024 * 1024)
    throw new Error('AI 指令、输入与输出格式合计超过 1 MiB');
}
export function aiBinding(bindings: Bindings, id: string, version = 1) {
  const binding = bindings.resources?.[id];
  if (
    !binding ||
    !['deepseek', 'openai-codex'].includes(binding.provider ?? '') ||
    !binding.model ||
    !/^[\x21-\x7e]{1,100}$/.test(binding.model) ||
    (version >= 2 && !aiOutcomeModel.test(binding.model)) ||
    binding.path !== undefined ||
    binding.browserId !== undefined
  )
    throw new Error(`AI 资源「${id}」尚未绑定有效的服务与模型`);
  return { provider: binding.provider!, model: binding.model };
}
export function aiProviders(record: Pick<{ flow: Flow; bindings: Bindings }, 'flow' | 'bindings'>) {
  return [
    ...new Set(
      [
        ...aiNodes(record.flow.steps),
        ...conversationNodes(record.flow.steps),
        ...walkReduction(record.flow.steps),
      ].flatMap((node) => {
        const provider =
          record.bindings.resources?.[node.type === 'source-reduce' ? node.aiBinding : node.binding]
            ?.provider;
        return provider ? [provider] : [];
      }),
    ),
  ];
}
function walkReduction(steps: Step[]): Extract<Step, { type: 'source-reduce' }>[] {
  return steps.flatMap((n) =>
    n.type === 'source-reduce'
      ? [n]
      : n.type === 'condition'
        ? [...walkReduction(n.then), ...walkReduction(n.else)]
        : n.type === 'loop'
          ? walkReduction(n.body)
          : [],
  );
}

export function conversationNodes(steps: Step[]): Extract<Step, { type: 'conversation' }>[] {
  return steps.flatMap((n) =>
    n.type === 'conversation'
      ? [n]
      : n.type === 'condition'
        ? [...conversationNodes(n.then), ...conversationNodes(n.else)]
        : n.type === 'loop'
          ? conversationNodes(n.body)
          : [],
  );
}
