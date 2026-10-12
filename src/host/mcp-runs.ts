import { resolveParameterSources } from '../shared/parameter-sources';
import { DiscoveryError } from '../adapters/mcp-discovery';
import type { Store } from './store';
import type { ToolConnections } from './tool-connections';
import type { TaskMcpTargets } from './task-mcp-targets';
import type { FlowRecord, Run, Step } from '../shared/types';
import type { McpReceipt } from '../shared/mcp-run';
import { walk } from '../core/validate';
import { reviewMcpArguments } from './mcp-argument-review';
import { now } from '../shared/utils';
import { resolveValue } from '../core/engine';

function matchesArguments(saved: any, resolved: any, parameters: unknown): boolean {
  if (saved && typeof saved === 'object') {
    if (
      !Array.isArray(saved) &&
      Object.keys(saved).length === 1 &&
      typeof saved.$ref === 'string'
    ) {
      if (saved.$ref === 'params' || saved.$ref.startsWith('params.'))
        return (
          JSON.stringify(resolveValue(saved, { params: parameters })) === JSON.stringify(resolved)
        );
      // Earlier step and loop values only exist inside this Run's trusted worker.
      return true;
    }
    if (
      !resolved ||
      typeof resolved !== 'object' ||
      Array.isArray(saved) !== Array.isArray(resolved)
    )
      return false;
    const keys = Object.keys(saved);
    return (
      keys.length === Object.keys(resolved).length &&
      keys.every(
        (key) =>
          Object.hasOwn(resolved, key) && matchesArguments(saved[key], resolved[key], parameters),
      )
    );
  }
  return saved === resolved;
}

function instanceMatches(steps: Step[], nodeId: string, instance: string, prefix = ''): boolean {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return steps.some((node) => {
    const path = prefix + escape(node.id);
    if (node.id === nodeId && new RegExp('^' + path + '$').test(instance)) return true;
    if (node.type === 'condition')
      return instanceMatches([...node.then, ...node.else], nodeId, instance, path + '/');
    if (node.type === 'loop')
      return instanceMatches(node.body, nodeId, instance, path + '\\[(?:0|[1-9][0-9]{0,2})\\]/');
    return false;
  });
}
export class McpRuns {
  private jobs = new Map<
    string,
    { runId: string; abort: AbortController; promise: Promise<any> }
  >();
  private cancelled = new Map<string, Set<string>>();
  constructor(
    private store: Store,
    private connections: ToolConnections,
    private targets: TaskMcpTargets,
    private redact: (value: any) => any,
  ) {}

  verify(record: FlowRecord, run?: Run) {
    this.targets.assertExecutable(record.id, record, true);
    const nodes = walk(record.flow.steps).filter((node) => node.type === 'mcp');
    if (!nodes.length) return;
    if (
      run &&
      (!run.review?.toolsReviewed ||
        !run.task ||
        record.toolTargets?.some((target) => target.taskId !== run.task!.id))
    )
      throw new Error('请从原任务核对工具范围并明确确认本次试运行');
    for (const node of nodes) {
      const target = record.toolTargets?.find((item) => item.selectionId === node.target);
      const tool = target?.tools.find((item) => item.name === node.tool);
      if (!target || !tool) throw new Error('工具不在此方案保存的选择中');
      const check = reviewMcpArguments(tool.inputSchema, node.arguments);
      if (!['valid', 'deferred'].includes(check.status)) throw new Error(check.summary);
      if (tool.outputSchema) {
        const check = reviewMcpArguments(tool.outputSchema, {}, true);
        if (!['valid', 'invalid'].includes(check.status))
          throw new Error('工具输出定义暂不支持，不能跳过输出核对');
      }
    }
  }
  perform(run: Run, record: FlowRecord, args: any, signal: AbortSignal, check: () => void) {
    const instance = args?.nodeInstance;
    if (
      typeof instance !== 'string' ||
      instance.length > 4000 ||
      typeof args.nodeId !== 'string' ||
      !instanceMatches(record.flow.steps, args.nodeId, instance)
    )
      throw new Error('工具步骤实例不属于本次固定方案');
    const key = run.id + ':' + instance;
    if (
      this.jobs.has(key) ||
      this.store.get('mcp-effect', key) ||
      this.cancelled.get(run.id)?.has(instance)
    )
      throw new Error('此工具步骤已经尝试或取消，不能再次发送');
    const abort = new AbortController();
    const combined = AbortSignal.any([signal, abort.signal]);
    const job = { runId: run.id, abort, promise: undefined! as Promise<any> };
    this.jobs.set(key, job);
    job.promise = Promise.resolve()
      .then(async () => {
        const current = () => {
          combined.throwIfAborted();
          check();
          this.verify(record, run);
        };
        current();
        const node = walk(record.flow.steps).find((node) => node.id === args.nodeId);
        if (node?.type !== 'mcp') throw new Error('此步骤不是工具调用');
        const target = record.toolTargets!.find((target) => target.selectionId === node.target)!;
        const definition = target.tools.find((tool) => tool.name === node.tool)!;
        if (!matchesArguments(node.arguments, args.arguments, resolveParameterSources(record.flow)))
          throw new Error('工具参数与本次固定方案的常量或流程参数不一致');
        const input = reviewMcpArguments(definition.inputSchema, args.arguments, true);
        if (input.status !== 'valid') throw new Error('实际工具参数未通过输入定义核对');
        const receipt: McpReceipt = {
          runId: run.id,
          nodeId: node.id,
          nodeInstance: instance,
          selectionId: target.selectionId,
          connectionName: target.displayName,
          tool: node.tool,
          attemptedAt: now(),
          status: 'unknown',
          message: '调用尝试已记录，结果尚未确认；不会自动重试。',
        };
        this.store.tx(() => {
          if (this.store.get('mcp-effect', key)) throw new Error('重复工具调用尝试');
          this.store.put('mcp-effect', key, receipt);
          this.store.event(run.id, 'mcp-attempt', instance, { tool: node.tool });
        });
        let sent = false;
        let result: McpReceipt;
        try {
          const reply = await this.connections.call(target, {
            tool: node.tool,
            arguments: args.arguments,
            signal: combined,
            timeoutMs: node.timeoutMs ?? 60000,
            beforeSend: () => {
              current();
              sent = true;
            },
          });
          combined.throwIfAborted();
          if (
            !reply.isError &&
            definition.outputSchema &&
            reviewMcpArguments(definition.outputSchema, reply.structuredContent, true).status !==
              'valid'
          )
            throw new Error('工具输出未通过核对');
          result = {
            ...receipt,
            completedAt: now(),
            result: reply,
            status: reply.isError ? 'tool-error' : 'received',
            message: reply.isError
              ? '服务返回工具错误，请核对原服务中的实际结果。'
              : '已收到服务回复；外部业务是否完成仍需按任务结果核对。',
          };
        } catch (error) {
          result = {
            ...receipt,
            completedAt: now(),
            status: sent ? 'unknown' : 'not-sent',
            message: sent
              ? '可能已在外部执行，尚未取得可确认的回复。请人工核对，未自动重试。'
              : '本次未发出工具调用。' +
                (error instanceof DiscoveryError
                  ? error.message
                  : '请核对连接、能力和参数后再决定是否重新运行。'),
          };
        }
        this.store.tx(() => {
          this.store.put('mcp-effect', key, this.redact(result));
          this.store.event(run.id, 'mcp-result', instance, {
            status: result.status,
            message: result.message,
          });
          if (result.status === 'unknown')
            this.store.attention(
              'unknown-result',
              '工具结果待核对',
              { runId: run.id, nodeId: node.id, nodeInstance: instance },
              'mcp:' + key,
            );
        });
        if (result.status !== 'received') throw new Error(result.message);
        return result.result!;
      })
      .finally(() => this.jobs.delete(key));
    return job.promise;
  }
  async cancel(runId: string, instance: string) {
    if (typeof instance !== 'string' || instance.length > 4000) throw new Error('无效工具实例');
    const instances = this.cancelled.get(runId) ?? new Set<string>();
    if (instances.size >= 10000) throw new Error('工具取消记录超过限制');
    instances.add(instance);
    this.cancelled.set(runId, instances);
    const job = this.jobs.get(runId + ':' + instance);
    job?.abort.abort();
    await job?.promise.catch(() => {});
  }
  async release(runId: string) {
    const jobs = [...this.jobs.values()].filter((job) => job.runId === runId);
    for (const job of jobs) job.abort.abort();
    await Promise.all(jobs.map((job) => job.promise.catch(() => {})));
    this.cancelled.delete(runId);
    return this.connections.clean()
      ? { confirmed: true }
      : { confirmed: false, error: '工具会话关闭未确认，请核对外部结果' };
  }
  receipts(runId: string) {
    return this.store.list<McpReceipt>('mcp-effect').filter((receipt) => receipt.runId === runId);
  }
}
