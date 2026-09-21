import { Store } from './store';
import { capabilities, validateFlow, validateObject } from '../core/validate';
import { canonical, digest, now, redactedErrorText, uid } from '../shared/utils';
import {
  taskMethods,
  type PlanningInput,
  type PlanningProposal,
  type PlanningResult,
  type PlanningTask,
  type TaskDetail,
} from '../shared/planning';
import type { Bindings, Flow, FlowRecord } from '../shared/types';
import { planningDiff, planningResources } from './planning-diff';
import { generatePlan } from '../ai/planning';

type SavedTask = PlanningTask & {
  proposal?: PlanningProposal;
  undo?: { before: FlowRecord | null; afterHash: string };
};
type Job = { id: string; abort: AbortController };
type Dependencies = {
  key: (provider: string) => Promise<string>;
  save: (flow: Flow, bindings: Bindings) => FlowRecord;
  assertAvailable: () => void;
  generate?: typeof generatePlan;
};
const kind = 'ai-task';
const flowHash = (flow: FlowRecord | null) =>
  digest(flow ? { flow: flow.flow, bindings: flow.bindings } : null);

export class Planning {
  private jobs = new Map<string, Job>();
  constructor(
    private store: Store,
    private deps: Dependencies,
  ) {
    // Restart only changes the interrupted request's presentation, never resumes it.
    for (const task of store.list<SavedTask>(kind))
      if (task.status === 'generating') {
        store.put(kind, task.id, {
          ...task,
          status: 'cancelled',
          error: '上次生成已中断，草稿保留；未自动重试。',
          updatedAt: now(),
        });
      }
  }
  private task(id: string, revision?: number): SavedTask {
    const task = this.store.get<SavedTask>(kind, id);
    if (!task) throw new Error('任务已不存在，请返回任务列表');
    if (revision !== undefined && task.revision !== revision)
      throw new Error('任务草稿已变化，请重新读取后操作');
    return task;
  }
  private flow(task: PlanningTask) {
    return this.store.get<FlowRecord>('flow', task.flowId) ?? null;
  }
  private put(task: SavedTask) {
    this.store.put(kind, task.id, { ...task, updatedAt: now() });
  }
  detail(id: string): TaskDetail {
    const { proposal, undo, ...task } = this.task(id);
    const flow = this.flow(task);
    const result = proposal?.result;
    return {
      task,
      flow,
      proposal,
      conflict:
        !!proposal &&
        (proposal.baseRevision !== task.revision || proposal.baseFlowHash !== flowHash(flow)),
      changes:
        result?.kind === 'plan' && result.flow ? planningDiff(proposal!.baseFlow, result.flow) : [],
      resources: result?.kind === 'plan' && result.flow ? planningResources(result.flow) : [],
      canUndo: !!undo && undo.afterHash === flowHash(flow),
    };
  }
  private abort(id: string) {
    const job = this.jobs.get(id);
    this.jobs.delete(id);
    job?.abort.abort();
  }
  cancelAll() {
    const ids = [...this.jobs.keys()];
    // Abort every request before a possible persistence error.
    for (const id of ids) this.abort(id);
    const errors: unknown[] = [];
    for (const id of ids) {
      try {
        this.put({ ...this.task(id), status: 'cancelled', error: undefined });
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, '生成已取消，但本地状态未能完整保存');
  }
  async request(method: string, input: unknown): Promise<any> {
    if (!Object.prototype.hasOwnProperty.call(taskMethods, method))
      throw new Error('任务接口不存在');
    const args: any = taskMethods[method as keyof typeof taskMethods].parse(input);
    if (method === 'task.list')
      return this.store
        .list<SavedTask>(kind)
        .reverse()
        .map((task) => ({
          id: task.id,
          revision: task.revision,
          description: task.description.slice(0, 200),
          flowId: task.flowId,
          status: task.status,
          updatedAt: task.updatedAt,
        }));
    if (method === 'task.detail') return this.detail(args.id);
    if (method !== 'task.cancel') this.deps.assertAvailable();
    if (method === 'task.create') {
      const flow = args.flowId ? this.store.get<FlowRecord>('flow', args.flowId) : null;
      if (args.flowId && !flow) throw new Error('关联流程已不存在');
      const task: SavedTask = {
        id: uid(),
        flowId: args.flowId ?? uid(),
        revision: 1,
        description: '',
        context: [],
        answers: {},
        status: 'draft',
        updatedAt: now(),
      };
      this.put(task);
      return this.detail(task.id);
    }
    const task = this.task(args.id, args.revision);
    if (method === 'task.save') {
      this.abort(task.id);
      this.put({
        ...task,
        description: args.description,
        context: args.context,
        answers: args.answers,
        revision: task.revision + 1,
        status: 'draft',
        error: undefined,
        requestId: undefined,
        proposal: undefined,
      });
    } else if (method === 'task.generate') {
      if (this.jobs.has(task.id)) throw new Error('该任务正在生成，请先取消或等待结果');
      if (!task.description.trim()) throw new Error('请先描述你想完成的任务');
      const baseline = this.flow(task);
      const request: PlanningInput = {
        formatVersion: '1.0',
        flowId: task.flowId,
        description: task.description,
        context: task.context,
        answers: task.answers,
        baseFlow: baseline?.flow ?? null,
        capabilities: [...capabilities],
      };
      validateObject('AIPlanningRequest', request);
      if (Buffer.byteLength(JSON.stringify(request)) > 2 * 1024 * 1024)
        throw new Error('规划上下文与基线流程合计超过 2 MiB，请缩小本次修改范围');
      const job = { id: uid(), abort: new AbortController() };
      this.put({
        ...task,
        status: 'generating',
        requestId: job.id,
        provider: args.provider,
        model: args.model,
        error: undefined,
      });
      this.jobs.set(task.id, job);
      void this.perform(task, job, request, flowHash(baseline), args.provider, args.model);
    } else if (method === 'task.cancel') {
      this.abort(task.id);
      if (task.status === 'generating')
        this.put({ ...task, status: 'cancelled', error: undefined });
    } else if (method === 'task.reject') {
      if (this.jobs.has(task.id)) throw new Error('请先取消正在生成的方案');
      if (task.proposal?.id !== args.proposalId) throw new Error('提案已变化，请重新查看');
      this.put({ ...task, proposal: undefined, status: 'draft', error: undefined });
    } else if (method === 'task.adopt') {
      if (this.jobs.has(task.id)) throw new Error('请先取消正在生成的方案');
      const proposal = task.proposal;
      if (
        !proposal ||
        proposal.id !== args.proposalId ||
        proposal.result.kind !== 'plan' ||
        !proposal.result.flow
      )
        throw new Error('完整方案已变化，请重新生成');
      const before = this.flow(task);
      if (proposal.baseRevision !== task.revision || proposal.baseFlowHash !== flowHash(before))
        throw new Error('流程或资源绑定已修改，请基于当前版本重新生成；未覆盖手动编辑');
      this.validatePlan(proposal.result, task.flowId, proposal.baseFlow);
      this.store.tx(() => {
        const saved = this.deps.save(
          proposal.result.flow!,
          before?.bindings ?? { files: {}, credentials: [] },
        );
        if (canonical(saved.flow) !== canonical(proposal.result.flow))
          throw new Error('实例配置与提案参数不一致，请先核对配置');
        this.put({
          ...task,
          revision: task.revision + 1,
          proposal: undefined,
          status: 'draft',
          error: undefined,
          undo: { before, afterHash: flowHash(saved) },
        });
      });
    } else if (method === 'task.undo') {
      const undo = task.undo;
      if (!undo || undo.afterHash !== flowHash(this.flow(task)))
        throw new Error('当前流程已变化，不能用撤销覆盖后续编辑');
      this.abort(task.id);
      this.store.tx(() => {
        if (undo.before) this.deps.save(undo.before.flow, undo.before.bindings);
        else this.store.remove('flow', task.flowId);
        this.put({
          ...task,
          revision: task.revision + 1,
          undo: undefined,
          proposal: undefined,
          status: 'draft',
          error: undefined,
        });
      });
    }
    return this.detail(task.id);
  }
  private current(task: SavedTask, job: Job) {
    if (this.jobs.get(task.id) !== job || job.abort.signal.aborted) return false;
    const saved = this.task(task.id);
    return (
      saved.revision === task.revision &&
      saved.requestId === job.id &&
      saved.status === 'generating'
    );
  }
  private validatePlan(result: PlanningResult, flowId: string, before: Flow | null) {
    validateObject('AIPlanningResult', result);
    if (new Set(result.questions.map((q) => q.id)).size !== result.questions.length)
      throw new Error('AI 补问 ID 重复');
    if (result.kind !== 'plan') return;
    const flow = validateFlow(result.flow);
    if (!flow.steps.length) throw new Error('AI 返回了空流程，尚无可执行方案');
    if (flow.id !== flowId) throw new Error('AI 修改了流程身份，方案未采纳');
    if (canonical(flow.sourceTemplate ?? null) !== canonical(before?.sourceTemplate ?? null))
      throw new Error('AI 不能伪造或更改模板来源');
  }
  private async perform(
    task: SavedTask,
    job: Job,
    input: PlanningInput,
    baseline: string,
    provider: 'deepseek' | 'openai-codex',
    model: string,
  ) {
    let key = '';
    try {
      key = await this.deps.key(provider);
      if (!this.current(task, job)) return;
      this.deps.assertAvailable();
      if (typeof key !== 'string' || !key) throw new Error('请先配置所选 AI 服务');
      const result = await (this.deps.generate ?? generatePlan)(
        input,
        provider,
        model,
        key,
        job.abort.signal,
      );
      if (!this.current(task, job)) return;
      this.deps.assertAvailable();
      const serialized = JSON.stringify(result);
      if (Buffer.byteLength(serialized) > 1024 * 1024) throw new Error('AI 方案超过 1 MiB');
      if (serialized.includes(key)) throw new Error('AI 返回包含敏感凭据，结果已拒绝');
      this.validatePlan(result, task.flowId, input.baseFlow);
      const saved = this.task(task.id);
      this.put({
        ...saved,
        status: result.kind,
        error: undefined,
        proposal: {
          id: uid(),
          baseRevision: task.revision,
          baseFlowHash: baseline,
          baseFlow: input.baseFlow,
          result,
          createdAt: now(),
        },
      });
    } catch (error) {
      if (this.current(task, job)) {
        try {
          this.put({
            ...this.task(task.id),
            status: 'failed',
            error: redactedErrorText(error, [key]),
          });
        } catch {
          /* Store.fault remains visible; never replace a failed write with an in-memory success. */
        }
      }
    } finally {
      key = '';
      if (this.jobs.get(task.id) === job) this.jobs.delete(task.id);
    }
  }
}
