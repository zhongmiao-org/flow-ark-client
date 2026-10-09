import { z } from 'zod';
import {
  aiKey,
  aiModel,
  aiProvider,
  defaultAIModel,
  type AIConfiguration,
  type AIProviderId,
} from '../shared/ai-settings';
import type { Vault } from './vault';

const record = z
  .object({
    kind: z.literal('flowark-ai-configuration'),
    version: z.literal(1),
    model: aiModel,
    apiKey: aiKey,
    tail: z.string().length(4).optional(),
  })
  .strict();
type ProtectedRecord = z.infer<typeof record>;
// Main owns the only writer. Metadata and Key share one atomic encrypted file.
export class ProviderConfigurations {
  private writing = new Set<AIProviderId>();
  constructor(
    private vault: Pick<Vault, 'readEntry' | 'set' | 'removeProvider'>,
    private remember: (key: string) => void = () => {},
  ) {}
  private async read(provider: AIProviderId) {
    aiProvider.parse(provider);
    const entry = await this.vault.readEntry(provider);
    if (!entry) return null;
    let config: ProtectedRecord;
    if (entry.value.startsWith('{')) {
      config = record.parse(JSON.parse(entry.value));
      if (config.tail && config.tail !== config.apiKey.slice(-4))
        throw new Error('AI 配置元数据无效');
    } else {
      // Existing protected credentials remain usable; they have no tail metadata.
      config = {
        kind: 'flowark-ai-configuration',
        version: 1,
        model: defaultAIModel(provider),
        apiKey: aiKey.parse(entry.value),
      };
    }
    this.remember(config.apiKey);
    return { config, revision: entry.revision };
  }
  private project(
    provider: AIProviderId,
    entry: Awaited<ReturnType<ProviderConfigurations['read']>>,
  ): AIConfiguration {
    return {
      provider,
      configured: !!entry,
      revision: entry?.revision ?? null,
      model: entry?.config.model ?? defaultAIModel(provider),
      ...(entry?.config.tail ? { tail: entry.config.tail } : {}),
    };
  }
  async get(provider: AIProviderId) {
    return this.project(provider, await this.read(provider));
  }
  async key(provider: AIProviderId, revision?: string) {
    if (this.writing.has(provider)) throw new Error('AI 配置正在修改');
    const entry = await this.read(provider);
    if (this.writing.has(provider)) throw new Error('AI 配置正在修改');
    if (!entry || (revision && entry.revision !== revision))
      throw new Error('AI 配置已变化或尚未保存');
    return entry.config.apiKey;
  }
  async change(
    provider: AIProviderId,
    expected: string | null,
    update?: { model: string; apiKey?: string },
  ) {
    aiProvider.parse(provider);
    if (this.writing.has(provider)) throw new Error('AI 配置正在修改');
    this.writing.add(provider);
    try {
      const old = await this.read(provider);
      if ((old?.revision ?? null) !== expected) throw new Error('AI 配置已变化，请重新读取后保存');
      if (!update) {
        await this.vault.removeProvider(provider);
        return this.project(provider, null);
      }
      const model = aiModel.parse(update.model),
        key = aiKey.parse(update.apiKey ?? old?.config.apiKey);
      const config: ProtectedRecord = {
        kind: 'flowark-ai-configuration',
        version: 1,
        model,
        apiKey: key,
        ...(update.apiKey
          ? { tail: key.slice(-4) }
          : old?.config.tail
            ? { tail: old.config.tail }
            : {}),
      };
      if (old && JSON.stringify(config) === JSON.stringify(old.config) && old.config.tail)
        return this.project(provider, old);
      const revision = await this.vault.set(provider, JSON.stringify(config));
      return this.project(provider, { config, revision });
    } finally {
      this.writing.delete(provider);
    }
  }
}
