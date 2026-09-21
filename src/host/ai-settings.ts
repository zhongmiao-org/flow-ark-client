import {
  aiConfigurationMethods,
  type AIConfiguration,
  type AIConfigurationState,
  type AIConnectionTest,
  type AIErrorCode,
  type AIProviderId,
} from '../shared/ai-settings';
import { generate } from '../ai/providers';
import { now } from '../shared/utils';
import { Store } from './store';

type Operation = {
  kind: AIConfigurationState['operation'];
  abort: AbortController;
  requestId?: string;
  promise?: Promise<any>;
};
const validationKind = 'ai-configuration-test';
// Credential reads cannot be cancelled at the OS backend. Stop awaiting their
// result on cancellation; the abandoned read has no writes or network effects.
async function readUntil<T>(read: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void;
  try {
    signal.throwIfAborted();
    return await Promise.race([
      read,
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}
export class AISettings {
  private operations = new Map<AIProviderId, Operation>();
  private epochs = new Map<string, number>();
  constructor(
    private store: Store,
    private deps: {
      assertAvailable: () => void;
      inUse: (provider: AIProviderId) => boolean;
      get: (provider: AIProviderId) => Promise<AIConfiguration>;
      change: (
        provider: AIProviderId,
        revision: string | null,
        update?: { model: string; apiKey?: string },
      ) => Promise<AIConfiguration>;
      key: (provider: AIProviderId, revision: string) => Promise<string>;
      generate?: typeof generate;
      timeoutMs?: number;
    },
  ) {
    for (const entry of store.list<AIConnectionTest & { provider: AIProviderId }>(validationKind)) {
      if (entry.status === 'testing')
        store.put(validationKind, entry.provider, { ...entry, status: 'interrupted', at: now() });
    }
  }
  assertReadable(provider: string) {
    const operation = this.operations.get(provider as AIProviderId);
    if (operation && operation.kind !== 'testing') throw new Error('AI 配置正在修改，请等待完成');
  }
  capture(providers: string[]) {
    const captured = new Map(
      providers.map((provider) => {
        this.assertReadable(provider);
        return [provider, this.epochs.get(provider) ?? 0] as const;
      }),
    );
    return () => {
      for (const [provider, epoch] of captured) {
        this.assertReadable(provider);
        if ((this.epochs.get(provider) ?? 0) !== epoch)
          throw new Error('检查期间 AI 配置已改变，请重新核对');
      }
    };
  }
  private project(config: AIConfiguration): AIConfigurationState {
    const test = this.store.get<AIConnectionTest>(validationKind, config.provider);
    return {
      ...config,
      test: test?.revision === config.revision ? test : null,
      operation: this.operations.get(config.provider)?.kind ?? null,
      inUse: this.deps.inUse(config.provider),
    };
  }
  async request(method: string, raw: unknown): Promise<any> {
    const schema = aiConfigurationMethods[method as keyof typeof aiConfigurationMethods];
    if (!schema) throw new Error('AI 配置方法未授权');
    const args: any = schema.parse(raw),
      provider = args.provider as AIProviderId;
    if (method === 'ai.configuration.get') return this.project(await this.deps.get(provider));
    if (method === 'ai.configuration.cancel') {
      const operation = this.operations.get(provider);
      if (operation?.kind !== 'testing' || operation.requestId !== args.requestId) return false;
      operation.abort.abort();
      const test = this.store.get<AIConnectionTest>(validationKind, provider);
      if (test?.requestId === args.requestId)
        this.store.put(validationKind, provider, { ...test, status: 'cancelled', at: now() });
      await operation.promise?.catch(() => {});
      return true;
    }
    this.deps.assertAvailable();
    if (this.operations.has(provider)) throw new Error('AI 配置正在保存、删除或测试，请等待完成');
    const testing = method === 'ai.configuration.test';
    if (!testing && this.deps.inUse(provider))
      throw new Error('该 AI 资源正在被运行或方案生成使用，请先等待结束');
    const operation: Operation = {
      kind: testing ? 'testing' : method.endsWith('.save') ? 'saving' : 'removing',
      abort: new AbortController(),
      ...(testing ? { requestId: args.requestId } : {}),
    };
    this.operations.set(provider, operation);
    if (!testing) this.epochs.set(provider, (this.epochs.get(provider) ?? 0) + 1);
    operation.promise = (async () => {
      try {
        if (!testing) {
          const config = await this.deps.change(
            provider,
            args.revision,
            method.endsWith('.save') ? { model: args.model, apiKey: args.apiKey } : undefined,
          );
          return this.project(config);
        }
        return await this.test(provider, args.revision, args.requestId, operation);
      } finally {
        if (this.operations.get(provider) === operation) this.operations.delete(provider);
      }
    })();
    const result = await operation.promise;
    return result && { ...result, operation: null };
  }
  private async test(
    provider: AIProviderId,
    revision: string,
    requestId: string,
    operation: Operation,
  ) {
    const deadline = setTimeout(
      () => operation.abort.abort('timeout'),
      this.deps.timeoutMs ?? 60000,
    );
    const signal = operation.abort.signal;
    const current = () => {
      this.deps.assertAvailable();
      signal.throwIfAborted();
      if (this.operations.get(provider) !== operation) throw new Error('测试已取消');
    };
    let config: AIConfiguration | undefined, key: string | undefined;
    try {
      config = await readUntil(this.deps.get(provider), signal);
      current();
      if (!config.configured || config.revision !== revision)
        throw new Error('AI 配置已变化，请重新读取后测试');
      this.store.put(validationKind, provider, {
        provider,
        revision,
        requestId,
        status: 'testing',
        at: now(),
      });
      key = await readUntil(this.deps.key(provider, revision), signal);
      current();
      const result = await (this.deps.generate ?? generate)(
        {
          provider,
          model: config.model,
          instructions: '仅返回输入中的 value，不添加内容。输出 JSON。',
          input: { value: 'fictional-check' },
          schema: {
            type: 'object',
            properties: { value: { type: 'string', const: 'fictional-check' } },
            required: ['value'],
            additionalProperties: false,
          },
        },
        key,
        signal,
      );
      current();
      if ((await readUntil(this.deps.get(provider), signal)).revision !== revision)
        throw new Error('AI 配置已变化');
      current();
      if (
        typeof result.model !== 'string' ||
        result.model.length > 100 ||
        result.model.includes(key)
      )
        throw new Error('AI 返回未完成结果');
      this.store.put(validationKind, provider, {
        provider,
        revision,
        requestId,
        status: 'passed',
        at: now(),
        model: result.model,
      });
    } catch (error) {
      if (!config || config.revision !== revision || !config.configured)
        throw new Error('AI 配置无法读取或已经变化，请重新核对');
      if (this.operations.get(provider) !== operation) return this.project(config);
      const stored = this.store.get<AIConnectionTest>(validationKind, provider);
      if (stored?.requestId !== requestId) return this.project(config);
      const cancelled = signal.aborted && signal.reason !== 'timeout';
      const message = error instanceof Error ? error.message : '';
      const status = /AI 接口 HTTP (\d+)/.exec(message)?.[1];
      const code: AIErrorCode =
        signal.reason === 'timeout' || /TimeoutError/.test(String(error))
          ? 'timeout'
          : !key
            ? 'storage'
            : status === '401' || status === '403'
              ? 'authentication'
              : status === '402' || status === '429'
                ? 'quota'
                : status === '400' || status === '404' || status === '422'
                  ? 'request'
                  : /JSON|格式|schema|Schema|未完成结果/.test(message)
                    ? 'output'
                    : 'network';
      this.store.put(validationKind, provider, {
        provider,
        revision,
        requestId,
        at: now(),
        status: cancelled ? 'cancelled' : 'failed',
        ...(!cancelled ? { code } : {}),
      });
    } finally {
      clearTimeout(deadline);
      key = undefined;
    }
    return this.project(config!);
  }
  async cancelAll() {
    const pending = [...this.operations.values()];
    for (const operation of pending) if (operation.kind === 'testing') operation.abort.abort();
    await Promise.all(pending.map((operation) => operation.promise?.catch(() => {})));
  }
}
