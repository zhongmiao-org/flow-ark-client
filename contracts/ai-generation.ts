/** Normative options and declarations only. No credentials, network or model execution. */
export const aiGenerationCapability = 'ai-generation-v1';
export type AIGenerationOptions = {
  thinking: 'provider-default' | 'disabled' | 'enabled';
  maxOutputTokens: number;
};
export function assertAIGenerationOptions(value: unknown, provider?: string): asserts value is AIGenerationOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('AI生成设置必须为对象');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 2 || !Object.hasOwn(v, 'thinking') || !Object.hasOwn(v, 'maxOutputTokens') ||
      !['provider-default', 'disabled', 'enabled'].includes(v.thinking as string) ||
      !Number.isSafeInteger(v.maxOutputTokens) || (v.maxOutputTokens as number) < 256 || (v.maxOutputTokens as number) > 16384)
    throw Error('AI生成设置无效：输出预算须为256至16384的整数');
  if (provider !== undefined && !['deepseek', 'openai-codex'].includes(provider)) throw Error('AI供应商无效');
  if (provider === 'openai-codex' && v.thinking !== 'provider-default')
    throw Error('当前OpenAI服务仅支持默认思考模式，请在运行前修改设置');
}
export function assertAIGenerationCapabilities(node: any, capabilities: readonly string[], manifest?: any, entry?: any) {
  if (node?.type !== 'ai' || node.version !== 3) return;
  assertAIGenerationOptions(node.generation);
  for (const c of ['ai-node-v1', 'ai-outcome-v1', aiGenerationCapability]) {
    if (!capabilities.includes(c) || (entry && !entry.capabilities.includes(c))) throw Error('AI生成设置未声明能力：' + c);
  }
  if (manifest && entry) {
    const resource = manifest.resources.find((r: any) => r.id === node.binding);
    if (!entry.capabilities.includes('ai') || !entry.resources.includes(node.binding) || resource?.kind !== 'ai' || resource.access !== 'use')
      throw Error('AI生成设置未声明本入口ai/use资源');
  }
}
