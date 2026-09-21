import { Store } from './store';
import { capabilities, validateFlow, validateObject } from '../core/validate';
import { canonical, now, redactedErrorText, uid } from '../shared/utils';
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
import type { PlanningRepair } from './planning-repair';
import type { RepairReference } from '../shared/task-repair';
import { scopedDescription } from '../shared/planning-scope';
import { checkScope, planningFlowHash as flowHash, validateScopedPlan } from './planning-scope';
import type { TaskWebTargets } from './task-web-target';
import { webContext, assertWebFlow, assertWebContext } from '../shared/task-web-target';

type SavedTask = PlanningTask & {
  proposal?: PlanningProposal;
  undo?: { before: FlowRecord | null; afterHash: string };
};
type Job = { id: string; abort: AbortController };
type Dependencies = {
  learning?: {
    target: (task: PlanningTask) => void;
    plan: (task: PlanningTask, flowHash: string) => void;
  };
  web?: TaskWebTargets;
  repair?: PlanningRepair;
  key: (provider: string) => Promise<string>;
  save: (flow: Flow, bindings: Bindings) => FlowRecord;
  assertAvailable: () => void;
  generate?: typeof generatePlan;
};
const kind = 'ai-task';

export class Planning {
  private jobs = new Map<string, Job>();
  private operationEpoch = new Map<string, number>();
  private cancellationEpoch = 0;
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
      flowHash: flowHash(flow),
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
    this.operationEpoch.set(id, (this.operationEpoch.get(id) ?? 0) + 1);
    const job = this.jobs.get(id);
    this.jobs.delete(id);
    job?.abort.abort();
  }
  cancelAll() {
    this.cancellationEpoch++;
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
  create(flowId?: string, description = ''): TaskDetail {
    this.deps.assertAvailable();
    const flow = flowId ? this.store.get<FlowRecord>('flow', flowId) : null;
    if (flowId && !flow) throw new Error('关联流程已不存在');
    if (flow?.webTarget) throw new Error('此流程已有网页来源，请从原任务继续');
    const task: SavedTask = {
      id: uid(),
      flowId: flowId ?? uid(),
      revision: 1,
      description,
      context: [],
      answers: {},
      status: 'draft',
      updatedAt: now(),
    };
    this.put(task);
    return this.detail(task.id);
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
    if (method === 'task.create') return this.create(args.flowId);
    const task = this.task(args.id, args.revision);
    const operationEpoch = this.operationEpoch.get(task.id) ?? 0;
    const cancellationEpoch = this.cancellationEpoch;
    const unchanged = () => {
      this.deps.assertAvailable();
      if (
        this.cancellationEpoch !== cancellationEpoch ||
        (this.operationEpoch.get(task.id) ?? 0) !== operationEpoch ||
        canonical(this.task(task.id, task.revision)) !== canonical(task)
      )
        throw new Error('任务已变化或操作已取消，请重新核对');
    };
    if (method.startsWith('task.web.')) {
      if (!this.deps.web) throw new Error('网页对象选择不可用');
      if (task.scope) throw new Error('请先退出单步修改，再更换整个任务的对象');
      if (method === 'task.web.preview') return this.deps.web.preview(task);
      const webTarget =
        method === 'task.web.select' ? await this.deps.web.select(task, args.token) : undefined;
      unchanged();
      this.abort(task.id);
      this.store.tx(() => {
        this.put({
          ...task,
          webTarget,
          revision: task.revision + 1,
          status: 'draft',
          error: undefined,
          requestId: undefined,
          proposal: undefined,
          undo: undefined,
          appliedRepair: undefined,
        });
        if (webTarget) this.deps.learning?.target({ ...task, webTarget });
      });
      return this.detail(task.id);
    }
    if (method === 'task.repair.preview') {
      if (!this.deps.repair) throw new Error('网页目标修复不可用');
      if (this.jobs.has(task.id)) throw new Error('请先取消正在生成的方案');
      return this.deps.repair.preview(args);
    }
    if (method === 'task.save') {
      if (task.webTarget) assertWebContext(args.context, task.webTarget);
      if (args.scope) checkScope(args.scope, this.flow(task));
      this.abort(task.id);
      this.put({
        ...task,
        description: args.description,
        scope: args.scope,
        appliedRepair: undefined,
        context: args.context,
        answers: args.answers,
        revision: task.revision + 1,
        status: 'draft',
        error: undefined,
        requestId: undefined,
        proposal: undefined,
      });
    } else if (method === 'task.generate' || method === 'task.repair.generate') {
      if (this.jobs.has(task.id)) throw new Error('该任务正在生成，请先取消或等待结果');
      if (!(task.scope?.instruction ?? task.description).trim())
        throw new Error(task.scope ? '请描述所选步骤需要怎样修改' : '请先描述你想完成的任务');
      const baseline = this.flow(task);
      if (task.webTarget) assertWebContext(task.context, task.webTarget);
      if (task.scope) {
        if (method !== 'task.generate') throw new Error('请先退出单步修改，再进行网页目标修复');
        checkScope(task.scope, baseline);
      }
      let request: PlanningInput = {
        formatVersion: '1.0',
        flowId: task.flowId,
        description: task.scope ? scopedDescription(task.scope) : task.description,
        context: task.webTarget
          ? ([...task.context, webContext(task.webTarget)] as PlanningInput['context'])
          : task.context,
        answers: task.answers,
        baseFlow: baseline?.flow ?? null,
        capabilities: task.webTarget
          ? capabilities.filter((c) =>
              [
                'value',
                'assert',
                'browser',
                'browser-frames-v1',
                'browser-forms-v1',
                'file',
                'file-create-v1',
                'file-create-numbered-v1',
                'human',
                'condition',
                'loop',
              ].includes(c),
            )
          : [...capabilities],
      };
      let repair: RepairReference | undefined;
      if (task.webTarget) {
        if (!this.deps.web) throw new Error('网页对象校验不可用');
        if (method === 'task.repair.generate')
          throw new Error('请从网页目标页重新核对当前只读对象，再修改方案');
        await this.deps.web.verify(task.webTarget);
        unchanged();
        if (flowHash(this.flow(task)) !== flowHash(baseline))
          throw new Error('流程已变化，请重新生成');
      }
      if (method === 'task.repair.generate') {
        if (!this.deps.repair) throw new Error('网页目标修复不可用');
        repair = {
          runId: args.runId,
          nodeId: args.nodeId,
          pickRequestId: args.pickRequestId,
          token: args.token,
        };
        request = (await this.deps.repair.verify(task, repair)).input;
        if (
          this.cancellationEpoch !== cancellationEpoch ||
          (this.operationEpoch.get(task.id) ?? 0) !== operationEpoch ||
          canonical(this.task(task.id, task.revision)) !== canonical(task)
        )
          throw new Error('修复操作已取消或任务已变化，请重新检查');
        if (this.jobs.has(task.id)) throw new Error('该任务正在生成，请先取消或等待结果');
        if (flowHash(this.flow(task)) !== flowHash(baseline))
          throw new Error('流程已变化，请重新检查');
      }
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
        proposal: undefined,
      });
      this.jobs.set(task.id, job);
      void this.perform(task, job, request, flowHash(baseline), args.provider, args.model, repair);
    } else if (method === 'task.cancel') {
      this.abort(task.id);
      if (task.status === 'generating')
        this.put({ ...task, status: 'cancelled', error: undefined });
    } else if (method === 'task.reject') {
      if (this.jobs.has(task.id)) throw new Error('请先取消正在生成的方案');
      if (task.proposal?.id !== args.proposalId) throw new Error('提案已变化，请重新查看');
      this.abort(task.id);
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
      if (before?.webTarget && before.webTarget.taskId !== task.id)
        throw new Error('此流程由其他网页任务绑定，请从原任务继续');
      if (proposal.baseRevision !== task.revision || proposal.baseFlowHash !== flowHash(before))
        throw new Error('流程或资源绑定已修改，请基于当前版本重新生成；未覆盖手动编辑');
      this.validatePlan(proposal.result, task.flowId, proposal.baseFlow);
      if (task.webTarget) {
        if (!this.deps.web) throw new Error('网页对象校验不可用');
        assertWebFlow(proposal.result.flow, task.webTarget);
        await this.deps.web.verify(task.webTarget);
        unchanged();
        if (flowHash(this.flow(task)) !== flowHash(before)) throw new Error('核对期间流程已变化');
      }
      if (proposal.scope) {
        checkScope(proposal.scope, before);
        validateScopedPlan(proposal.result, proposal.baseFlow!, proposal.scope);
      }
      let appliedRepair: PlanningTask['appliedRepair'];
      if (proposal.repair) {
        if (!this.deps.repair) throw new Error('网页目标修复不可用');
        const verified = await this.deps.repair.verify(task, proposal.repair);
        const current = this.task(task.id, task.revision);
        if (
          this.cancellationEpoch !== cancellationEpoch ||
          (this.operationEpoch.get(task.id) ?? 0) !== operationEpoch ||
          this.jobs.has(task.id) ||
          canonical(current.proposal) !== canonical(proposal) ||
          flowHash(this.flow(task)) !== flowHash(before)
        )
          throw new Error('提案或流程已变化，请重新核对；未覆盖当前草稿');
        this.deps.repair.validate(
          proposal.result,
          proposal.baseFlow!,
          proposal.repair.nodeId,
          verified.selection.target,
        );
        appliedRepair = {
          proposalId: proposal.id,
          runId: proposal.repair.runId,
          nodeId: proposal.repair.nodeId,
          selection: verified.selection,
          flowHash: '',
        };
      }
      this.store.tx(() => {
        const saved = this.deps.save(
          proposal.result.flow!,
          task.webTarget
            ? { ...(before?.bindings ?? { files: {}, credentials: [] }), browserId: 'embedded' }
            : (before?.bindings ?? { files: {}, credentials: [] }),
        );
        saved.webTarget = task.webTarget;
        this.store.put('flow', saved.id, saved);
        this.deps.learning?.plan(task, flowHash(saved));
        if (canonical(saved.flow) !== canonical(proposal.result.flow))
          throw new Error('实例配置与提案参数不一致，请先核对配置');
        this.put({
          ...task,
          revision: task.revision + 1,
          scope: undefined,
          proposal: undefined,
          status: 'draft',
          error: undefined,
          undo: { before, afterHash: flowHash(saved) },
          appliedRepair: appliedRepair
            ? { ...appliedRepair, flowHash: flowHash(saved) }
            : undefined,
        });
      });
    } else if (method === 'task.undo') {
      const undo = task.undo;
      if (!undo || undo.afterHash !== flowHash(this.flow(task)))
        throw new Error('当前流程已变化，不能用撤销覆盖后续编辑');
      this.abort(task.id);
      this.store.tx(() => {
        if (undo.before) {
          const restored = this.deps.save(undo.before.flow, undo.before.bindings);
          this.store.put('flow', restored.id, { ...restored, webTarget: undo.before.webTarget });
        } else this.store.remove('flow', task.flowId);
        this.put({
          ...task,
          revision: task.revision + 1,
          undo: undefined,
          scope: undefined,
          appliedRepair: undefined,
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
    repair?: RepairReference,
  ) {
    let key = '';
    try {
      key = await this.deps.key(provider);
      if (!this.current(task, job)) return;
      this.deps.assertAvailable();
      if (typeof key !== 'string' || !key) throw new Error('请先配置所选 AI 服务');
      if (task.scope) checkScope(task.scope, this.flow(task));
      if (task.webTarget) await this.deps.web!.verify(task.webTarget);
      if (task.webTarget && flowHash(this.flow(task)) !== baseline)
        throw new Error('凭据等待期间流程或绑定已变化，请重新生成');
      if (repair) await this.deps.repair!.verify(task, repair);
      if (!this.current(task, job)) return;
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
      if (task.webTarget) {
        if (result.kind === 'plan') assertWebFlow(result.flow!, task.webTarget);
        await this.deps.web!.verify(task.webTarget);
        if (!this.current(task, job)) return;
        if (flowHash(this.flow(task)) !== baseline) throw new Error('网页规划期间流程或绑定已变化');
      }
      if (task.scope) {
        checkScope(task.scope, this.flow(task));
        validateScopedPlan(result, input.baseFlow!, task.scope);
      }
      if (repair) {
        const verified = await this.deps.repair!.verify(task, repair);
        if (!this.current(task, job)) return;
        this.deps.repair!.validate(
          result,
          input.baseFlow!,
          repair.nodeId,
          verified.selection.target,
        );
      }
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
          ...(repair ? { repair } : {}),
          ...(task.scope ? { scope: task.scope } : {}),
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
