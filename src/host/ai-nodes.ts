import Ajv from 'ajv/dist/2020.js';
import { generate } from '../ai/providers';
import { aiBinding, aiNodes, assertAIRequest, conversationNodes } from '../shared/ai-node';
import type { AIConfiguration } from '../shared/ai-settings';
import type { AIResult, FlowRecord, Json } from '../shared/types';

async function until<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  let stop!: () => void;
  try {
    signal.throwIfAborted();
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        stop = () => reject(signal.reason ?? new Error('AI 请求已撤销'));
        signal.addEventListener('abort', stop, { once: true });
      }),
    ]);
  } finally {
    if (stop) signal.removeEventListener('abort', stop);
  }
}

/** Model requests belong to Host. Workers receive results, never provider credentials. */
export class AINodes {
  private calls = new Map<string, Map<string, { abort: AbortController; started: boolean }>>();
  constructor(
    private deps: {
      configuration: (provider: 'deepseek' | 'openai-codex') => Promise<AIConfiguration>;
      key: (provider: string, revision: string) => Promise<string>;
      secret: (key: string) => void;
      receipt: (runId: string, instance: string, result: AIResult) => void;
      generate?: typeof generate;
    },
  ) {}
  async preflight(record: FlowRecord) {
    for (const node of aiNodes(record.flow.steps)) {
      assertAIRequest(node);
      new Ajv({ strict: false, allErrors: true }).compile(node.schema as any);
      const binding = aiBinding(record.bindings, node.binding);
      const config = await this.deps.configuration(binding.provider);
      if (!config.configured || !config.revision)
        throw new Error(`AI 资源「${node.binding}」需要先配置用户自己的 Key`);
    }
  }
  async preflightConversations(record: FlowRecord) {
    for (const node of conversationNodes(record.flow.steps)) {
      const binding = aiBinding(record.bindings, node.binding);
      const config = await this.deps.configuration(binding.provider);
      if (!config.configured || !config.revision)
        throw new Error('引导会话需要先配置用户自己的 AI Key');
    }
  }
  private entry(runId: string, invocationId: string) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(invocationId)) throw new Error('AI 调用身份无效');
    let calls = this.calls.get(runId);
    if (!calls) this.calls.set(runId, (calls = new Map()));
    let call = calls.get(invocationId);
    if (!call) {
      if (calls.size >= 10000) throw new Error('AI 调用数量超过运行上限');
      calls.set(invocationId, (call = { abort: new AbortController(), started: false }));
    }
    return call;
  }
  cancel(runId: string, invocationId: string) {
    this.entry(runId, invocationId).abort.abort(new Error('AI 请求已取消或超时'));
    return true;
  }
  release(runId: string) {
    for (const call of this.calls.get(runId)?.values() ?? []) call.abort.abort();
    this.calls.delete(runId);
  }
  async perform(
    record: FlowRecord,
    runId: string,
    args: {
      nodeId: string;
      nodeInstance: string;
      invocationId: string;
      input: Json;
    },
    runSignal: AbortSignal,
    check: () => void,
  ) {
    check();
    const node = aiNodes(record.flow.steps).find((n) => n.id === args.nodeId);
    if (
      !node ||
      typeof args.nodeInstance !== 'string' ||
      args.nodeInstance.length > 4000 ||
      !(args.nodeInstance === node.id || args.nodeInstance.endsWith('/' + node.id))
    )
      throw new Error('AI 节点不属于本次运行快照');
    const call = this.entry(runId, args.invocationId);
    if (call.started) throw new Error('AI 调用不可重复执行');
    call.started = true;
    const signal = AbortSignal.any([
      runSignal,
      call.abort.signal,
      AbortSignal.timeout(node.timeoutMs ?? 60000),
    ]);
    const current = () => {
      signal.throwIfAborted();
      check();
    };
    current();
    assertAIRequest(node, args.input);
    new Ajv({ strict: false, allErrors: true }).compile(node.schema as any);
    const binding = aiBinding(record.bindings, node.binding);
    const config = await until(this.deps.configuration(binding.provider), signal);
    current();
    if (!config.configured || !config.revision) throw new Error('用户 AI Key 不可用');
    const key = await until(this.deps.key(binding.provider, config.revision), signal);
    current();
    this.deps.secret(key);
    const result = await until(
      (this.deps.generate ?? generate)(
        {
          ...binding,
          instructions: node.instructions,
          input: args.input,
          schema: node.schema,
        },
        key,
        signal,
      ),
      signal,
    );
    current();
    this.deps.receipt(runId, args.nodeInstance, result);
    return result;
  }
}
