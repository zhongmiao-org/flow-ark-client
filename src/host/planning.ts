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
import { planningAdoption, planningDiff, planningResources } from './planning-diff';
import { generatePlan } from '../ai/planning';
import type { PlanningRepair } from './planning-repair';
import type { RepairReference } from '../shared/task-repair';
import { scopedDescription } from '../shared/planning-scope';
import { checkScope, planningFlowHash as flowHash, validateScopedPlan } from './planning-scope';
import { repairedWebTarget, type TaskWebTargets } from './task-web-target';
import { assertWebFlow, assertWebContext } from '../shared/task-web-target';

import type { TaskOutputs } from './task-output';
import { assertOutputFlow, OUTPUT_BINDING } from '../shared/task-output';
import { taskPlanningContext } from '../shared/planning-context';
import type { TaskMcpTargets } from './task-mcp-targets';
import { assertMcpPlan } from '../shared/task-mcp-targets';
import type { TaskAttachments } from './task-attachments';
import type { DesktopPlanResponse } from '../shared/desktop-planning';

type SavedTask = PlanningTask & {
  proposal?: PlanningProposal;
  rejected?: { revision: number; flowHash: string; requestId?: string };
  undo?: {
    before: FlowRecord | null;
    afterHash: string;
    toolsRequirePlan?: boolean;
    repairWebTarget?: PlanningTask['webTarget'];
  };
};
type Job = { id: string; abort: AbortController; provider: string };
type Dependencies = {
  tools?: TaskMcpTargets;
  attachments?: TaskAttachments;
  learning?: {
    target: (task: PlanningTask) => void;
    plan: (task: PlanningTask, flowHash: string) => void;
  };
  web?: TaskWebTargets;
  output?: TaskOutputs;
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
  usesProvider(provider: string) {
    return [...this.jobs.values()].some((job) => job.provider === provider);
  }
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
  private attachmentInput(task: PlanningTask) {
    if (task.attachments?.length && !this.deps.attachments) throw new Error('附件服务不可用');
    return this.deps.attachments?.snapshot(task) ?? { context: [], images: [] };
  }
  private verifyTools(task: PlanningTask, flow?: Flow) {
    if (task.toolTargets?.length && !this.deps.tools) throw new Error('任务工具校验不可用');
    this.deps.tools?.verifyPlanning(task, flow);
    if (flow) assertMcpPlan(flow, task.toolTargets, task.outputTarget ? OUTPUT_BINDING : undefined);
  }
  detail(id: string): TaskDetail {
    const { proposal, undo, rejected, ...task } = this.task(id);
    const flow = this.flow(task);
    const result = proposal?.result;
    const currentHash = flowHash(flow);
    const canUndo = !!undo && undo.afterHash === currentHash;
    return {
      proposalRejected:
        rejected &&
        rejected.revision === task.revision &&
        rejected.requestId === task.requestId &&
        rejected.flowHash === currentHash &&
        !proposal &&
        task.status === 'draft'
          ? true
          : undefined,
      adoption:
        canUndo && flow ? planningAdoption(undo!.before?.flow ?? null, flow.flow) : undefined,
      toolTargetStates: this.deps.tools?.states(task.toolTargets),
      flowHash: currentHash,
      task,
      flow,
      proposal,
      conflict:
        !!proposal &&
        (proposal.baseRevision !== task.revision || proposal.baseFlowHash !== currentHash),
      changes:
        result?.kind === 'plan' && result.flow ? planningDiff(proposal!.baseFlow, result.flow) : [],
      resources: result?.kind === 'plan' && result.flow ? planningResources(result.flow) : [],
      canUndo,
    };
  }
  adoptDesktop(candidate: DesktopPlanResponse, original: string): TaskDetail {
    this.deps.assertAvailable();
    const task = this.task(candidate.id, candidate.revision);
    if (
      this.jobs.has(task.id) ||
      task.status === 'generating' ||
      task.proposal ||
      this.flow(task) ||
      task.webTarget ||
      task.outputTarget ||
      task.toolTargets?.length ||
      candidate.expiresAt <= Date.now() ||
      candidate.result.kind !== 'proposal' ||
      candidate.result.replacement === original ||
      task.revision >= Number.MAX_SAFE_INTEGER - 1
    )
      throw new Error('任务已有方案或其他对象，或候选已失效；未覆盖当前任务');
    const flow = validateFlow({
      formatVersion: '1.0',
      id: task.flowId,
      name: task.description.trim().slice(0, 100) || '整理选中段落',
      description: task.description,
      parameters: {},
      requiredCapabilities: ['desktop-selection-v1'],
      steps: [
        {
          id: 'replace-selection',
          type: 'desktop',
          version: 1,
          name: '替换选中段落并回读',
          target: 'selected-text',
          operation: 'replace-selection',
          text: candidate.result.replacement,
          timeoutMs: 15000,
        },
      ],
    });
    this.store.tx(() => {
      const saved = this.deps.save(flow, { files: {}, credentials: [] });
      saved.desktopTarget = {
        version: 1,
        taskId: task.id,
        requestId: candidate.requestId,
        observationId: candidate.observationId,
        windowId: candidate.windowId,
        previewId: candidate.previewId,
        expiresAt: candidate.expiresAt,
        sourceHash: digest(original),
        replacementHash: digest(candidate.result.replacement),
      };
      this.store.put('flow', saved.id, saved);
      this.put({
        ...task,
        revision: task.revision + 1,
        status: 'draft',
        error: undefined,
        provider: candidate.provider,
        model: candidate.model,
        scope: undefined,
        proposal: undefined,
        appliedRepair: undefined,
        undo: { before: null, afterHash: flowHash(saved) },
      });
    });
    return this.detail(task.id);
  }
  private abort(id: string) {
    this.deps.tools?.cancelTask(id);
    this.operationEpoch.set(id, (this.operationEpoch.get(id) ?? 0) + 1);
    const job = this.jobs.get(id);
    this.jobs.delete(id);
    job?.abort.abort();
  }
  cancelAll() {
    this.deps.tools?.cancelAll();
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
    if (flowId) this.deps.tools?.assertExecutable(flowId);
    if (flow?.webTarget || flow?.outputTarget)
      throw new Error('此流程已有任务来源，请从原任务继续');
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
    if (method === 'task.tools.cancel') {
      this.deps.tools?.cancel(args.id, args.token);
      return true;
    }
    if (method !== 'task.cancel') this.deps.assertAvailable();
    if (method === 'task.create') return this.create(args.flowId);
    const task = this.task(args.id, args.revision);
    const operationEpoch = this.operationEpoch.get(task.id) ?? 0;
    const cancellationEpoch = this.cancellationEpoch;
    const attachmentDeadline = Date.now() + 60000;
    const unchanged = () => {
      this.deps.assertAvailable();
      if (method.startsWith('task.attachment.') && Date.now() > attachmentDeadline)
        throw new Error('附件选择已超时，请重新选择');
      if (
        this.cancellationEpoch !== cancellationEpoch ||
        (this.operationEpoch.get(task.id) ?? 0) !== operationEpoch ||
        canonical(this.task(task.id, task.revision)) !== canonical(task)
      )
        throw new Error('任务已变化或操作已取消，请重新核对');
    };
    if (method.startsWith('task.tools.')) {
      const tools = this.deps.tools;
      if (!tools) throw new Error('任务工具选择不可用');
      if (task.scope) throw new Error('请先退出单步修改，再更换整个任务的工具');
      tools.assertChange(task);
      if (method === 'task.tools.preview') {
        if (
          (task.toolTargets?.length ?? 0) >= 5 &&
          !task.toolTargets?.some((t) => t.connectionId === args.connectionId)
        )
          throw new Error('每个任务最多选择五个连接');
        const candidate = tools.preview(
          task,
          args.connectionId,
          args.connectionRevision,
          args.toolNames,
        );
        try {
          taskPlanningContext(
            task.context,
            task.webTarget,
            task.outputTarget,
            this.attachmentInput(task).context,
            [
              ...(task.toolTargets ?? []).filter((t) => t.connectionId !== args.connectionId),
              candidate.target,
            ],
          );
          return candidate;
        } catch (error) {
          tools.cancel(task.id, candidate.token);
          throw error;
        }
      }
      const selected = method === 'task.tools.select' ? tools.select(task, args.token) : undefined;
      if (!selected && !task.toolTargets?.some((t) => t.selectionId === args.selectionId))
        throw new Error('所选工具对象不属于当前任务');
      const toolTargets = selected
        ? [
            ...(task.toolTargets ?? []).filter((t) => t.connectionId !== selected.connectionId),
            selected,
          ]
        : (task.toolTargets ?? []).filter((t) => t.selectionId !== args.selectionId);
      if (toolTargets.length > 5) throw new Error('每个任务最多选择五个连接');
      taskPlanningContext(
        task.context,
        task.webTarget,
        task.outputTarget,
        this.attachmentInput(task).context,
        toolTargets,
      );
      unchanged();
      this.abort(task.id);
      this.put({
        ...task,
        toolTargets,
        toolsRequirePlan: task.toolsRequirePlan || !!this.flow(task),
        revision: task.revision + 1,
        status: 'draft',
        error: undefined,
        requestId: undefined,
        proposal: undefined,
        undo: undefined,
        appliedRepair: undefined,
      });
      return this.detail(task.id);
    }
    if (method.startsWith('task.attachment.')) {
      const service = this.deps.attachments;
      if (!service) throw new Error('附件服务不可用');
      if (method === 'task.attachment.preview') return service.preview(task, args.attachmentId);
      let attachments = task.attachments ?? [];
      const selected =
        method === 'task.attachment.choose' ? await service.choose(task, args.kind) : null;
      unchanged();
      if (method === 'task.attachment.choose') {
        if (!selected) return this.detail(task.id);
        taskPlanningContext(
          task.context,
          task.webTarget,
          task.outputTarget,
          service.snapshot(task, selected).context,
          task.toolTargets,
        );
        attachments = [...attachments, service.metadata(selected)];
      } else {
        if (!attachments.some((a) => a.id === args.attachmentId && a.taskId === task.id))
          throw new Error('附件不属于当前任务');
        attachments = attachments.filter((a) => a.id !== args.attachmentId);
      }
      this.abort(task.id);
      this.store.tx(() => {
        if (selected) service.save(selected);
        else service.remove(args.attachmentId);
        this.put({
          ...task,
          attachments,
          revision: task.revision + 1,
          status: 'draft',
          error: undefined,
          requestId: undefined,
          proposal: undefined,
          undo: undefined,
          appliedRepair: undefined,
        });
      });
      return this.detail(task.id);
    }
    if (method.startsWith('task.output.')) {
      if (!this.deps.output) throw new Error('输出选择不可用');
      if (task.scope) throw new Error('请先退出单步修改，再更换整个任务的输出');
      this.deps.output.assertSelectable(task);
      let outputTarget = task.outputTarget;
      if (method === 'task.output.choose') {
        const selected = await this.deps.output.choose(task, {
          name: args.name,
          onConflict: args.onConflict,
        });
        unchanged();
        if (!selected) return this.detail(task.id);
        outputTarget = selected;
      } else if (method === 'task.output.configure') {
        if (!outputTarget) throw new Error('请先选择输出目录');
        outputTarget = {
          ...outputTarget,
          selectionId: uid(),
          name: args.name,
          onConflict: args.onConflict,
          selectedAt: now(),
        };
      } else outputTarget = undefined;
      taskPlanningContext(
        task.context,
        task.webTarget,
        outputTarget,
        this.attachmentInput(task).context,
        task.toolTargets,
      );
      if (outputTarget) await this.deps.output.verify(outputTarget);
      unchanged();
      this.deps.output.assertSelectable(task);
      this.abort(task.id);
      this.put({
        ...task,
        outputTarget,
        revision: task.revision + 1,
        status: 'draft',
        error: undefined,
        requestId: undefined,
        proposal: undefined,
        undo: undefined,
        appliedRepair: undefined,
      });
      return this.detail(task.id);
    }
    if (method.startsWith('task.web.')) {
      if (!this.deps.web) throw new Error('网页对象选择不可用');
      if (task.scope) throw new Error('请先退出单步修改，再更换整个任务的对象');
      if (method === 'task.web.preview') return this.deps.web.preview(task, args.pickRequestId);
      const webTarget =
        method === 'task.web.select'
          ? await this.deps.web.select(task, args.token, args.pickRequestId)
          : undefined;
      unchanged();
      taskPlanningContext(
        task.context,
        webTarget,
        task.outputTarget,
        this.attachmentInput(task).context,
        task.toolTargets,
      );
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
      taskPlanningContext(
        args.context,
        task.webTarget,
        task.outputTarget,
        this.attachmentInput(task).context,
        task.toolTargets,
      );
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
      this.verifyTools(task);
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
        context: taskPlanningContext(
          task.context,
          task.webTarget,
          task.outputTarget,
          this.attachmentInput(task).context,
          task.toolTargets,
        ) as PlanningInput['context'],
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
          : task.toolTargets?.length
            ? capabilities.filter((c) =>
                [
                  'mcp-tool-v1',
                  'value',
                  'assert',
                  'human',
                  'condition',
                  'loop',
                  ...(task.outputTarget
                    ? ['file', 'file-create-v1', 'file-create-numbered-v1']
                    : []),
                ].includes(c),
              )
            : capabilities.filter((c) => !['mcp-tool-v1', 'desktop-selection-v1'].includes(c)),
      };
      if (task.outputTarget) {
        if (!this.deps.output) throw new Error('输出校验不可用');
        await this.deps.output.verify(task.outputTarget);
        unchanged();
        if (flowHash(this.flow(task)) !== flowHash(baseline))
          throw new Error('流程已变化，请重新生成');
      }
      let repair: RepairReference | undefined;
      if (task.webTarget && method !== 'task.repair.generate') {
        if (!this.deps.web) throw new Error('网页对象校验不可用');
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
        request.context = taskPlanningContext(
          request.context,
          undefined,
          task.outputTarget,
        ) as PlanningInput['context'];
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
      const job = { id: uid(), abort: new AbortController(), provider: args.provider };
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
      this.put({
        ...task,
        rejected: {
          revision: task.revision,
          requestId: task.requestId,
          flowHash: flowHash(this.flow(task)),
        },
        proposal: undefined,
        status: 'draft',
        error: undefined,
      });
    } else if (method === 'task.adopt') {
      this.verifyTools(task);
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
      if (
        (before?.webTarget && before.webTarget.taskId !== task.id) ||
        (before?.outputTarget && before.outputTarget.taskId !== task.id) ||
        before?.toolTargets?.some((target) => target.taskId !== task.id)
      )
        throw new Error('此流程由其他任务绑定，请从原任务继续');
      if (proposal.baseRevision !== task.revision || proposal.baseFlowHash !== flowHash(before))
        throw new Error('流程或资源绑定已修改，请基于当前版本重新生成；未覆盖手动编辑');
      this.validatePlan(proposal.result, task.flowId, proposal.baseFlow);
      this.verifyTools(task, proposal.result.flow);
      let webTarget = task.webTarget;
      if (task.webTarget && !proposal.repair) {
        if (!this.deps.web) throw new Error('网页对象校验不可用');
        assertWebFlow(proposal.result.flow, task.webTarget, task.outputTarget);
        await this.deps.web.verify(task.webTarget);
        unchanged();
        if (flowHash(this.flow(task)) !== flowHash(before)) throw new Error('核对期间流程已变化');
      }
      if (task.outputTarget) {
        if (!this.deps.output) throw new Error('输出校验不可用');
        assertOutputFlow(proposal.result.flow, task.outputTarget);
        await this.deps.output.verify(task.outputTarget);
        unchanged();
        if (flowHash(this.flow(task)) !== flowHash(before)) throw new Error('核对期间流程已变化');
      }
      if (proposal.scope) {
        if (task.toolsRequirePlan) throw new Error('工具选择已变化，请重新生成完整方案');
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
        if (task.webTarget) {
          webTarget = repairedWebTarget(task.webTarget, verified.selection);
          assertWebFlow(proposal.result.flow, webTarget, task.outputTarget);
        }
        appliedRepair = {
          proposalId: proposal.id,
          runId: proposal.repair.runId,
          nodeId: proposal.repair.nodeId,
          selection: verified.selection,
          flowHash: '',
        };
      }
      this.verifyTools(task, proposal.result.flow);
      this.store.tx(() => {
        const bindings = task.outputTarget
          ? this.deps.output!.bindings(task.outputTarget, before)
          : before?.outputTarget
            ? {
                ...before.bindings,
                files: Object.fromEntries(
                  Object.entries(before.bindings.files).filter(([key]) => key !== OUTPUT_BINDING),
                ),
              }
            : (before?.bindings ?? { files: {}, credentials: [] });
        const saved = this.deps.save(
          proposal.result.flow!,
          task.webTarget ? { ...bindings, browserId: 'embedded' } : bindings,
        );
        saved.toolTargets = task.toolTargets?.length
          ? structuredClone(task.toolTargets)
          : undefined;
        saved.webTarget = webTarget;
        saved.outputTarget = task.outputTarget;
        this.store.put('flow', saved.id, saved);
        this.deps.learning?.plan({ ...task, webTarget }, flowHash(saved));
        if (canonical(saved.flow) !== canonical(proposal.result.flow))
          throw new Error('实例配置与提案参数不一致，请先核对配置');
        this.put({
          ...task,
          revision: task.revision + 1,
          webTarget,
          scope: undefined,
          proposal: undefined,
          status: 'draft',
          error: undefined,
          toolsRequirePlan: false,
          undo: {
            before,
            afterHash: flowHash(saved),
            toolsRequirePlan: task.toolsRequirePlan,
            ...(appliedRepair && task.webTarget ? { repairWebTarget: task.webTarget } : {}),
          },
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
          this.store.put('flow', restored.id, {
            ...restored,
            webTarget: undo.before.webTarget,
            outputTarget: undo.before.outputTarget,
            toolTargets: undefined,
          });
        } else this.store.remove('flow', task.flowId);
        this.put({
          ...task,
          revision: task.revision + 1,
          ...(undo.repairWebTarget ? { webTarget: undo.repairWebTarget } : {}),
          undo: undefined,
          toolsRequirePlan: undo.toolsRequirePlan || !!undo.before?.toolTargets?.length,
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
      this.verifyTools(task);
      if (typeof key !== 'string' || !key) throw new Error('请先配置所选 AI 服务');
      if (task.scope) checkScope(task.scope, this.flow(task));
      if (task.webTarget && !repair) await this.deps.web!.verify(task.webTarget);
      if (task.outputTarget) await this.deps.output!.verify(task.outputTarget);
      if ((task.webTarget || task.outputTarget) && flowHash(this.flow(task)) !== baseline)
        throw new Error('凭据等待期间流程或绑定已变化，请重新生成');
      if (repair) await this.deps.repair!.verify(task, repair);
      if (!this.current(task, job)) return;
      this.verifyTools(task);
      const result = await (this.deps.generate ?? generatePlan)(
        input,
        provider,
        model,
        key,
        job.abort.signal,
        undefined,
        repair ? [] : this.attachmentInput(task).images,
      );
      if (!this.current(task, job)) return;
      this.deps.assertAvailable();
      const serialized = JSON.stringify(result);
      this.attachmentInput(task);
      if (Buffer.byteLength(serialized) > 1024 * 1024) throw new Error('AI 方案超过 1 MiB');
      if (serialized.includes(key)) throw new Error('AI 返回包含敏感凭据，结果已拒绝');
      this.validatePlan(result, task.flowId, input.baseFlow);
      if (task.webTarget && !repair) {
        if (result.kind === 'plan') assertWebFlow(result.flow!, task.webTarget, task.outputTarget);
        await this.deps.web!.verify(task.webTarget);
        if (!this.current(task, job)) return;
        if (flowHash(this.flow(task)) !== baseline) throw new Error('网页规划期间流程或绑定已变化');
      }
      if (task.outputTarget) {
        if (result.kind === 'plan') assertOutputFlow(result.flow!, task.outputTarget);
        await this.deps.output!.verify(task.outputTarget);
        if (!this.current(task, job)) return;
        if (flowHash(this.flow(task)) !== baseline) throw new Error('输出规划期间流程或绑定已变化');
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
      this.verifyTools(task, result.kind === 'plan' ? result.flow! : undefined);
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
