import type { PlanningTask } from '../shared/planning';
import type { TaskMcpPreview, TaskMcpTarget, TaskMcpState } from '../shared/task-mcp-targets';
import { assertMcpPlan } from '../shared/task-mcp-targets';
import type { Flow, FlowRecord } from '../shared/types';
import { OUTPUT_BINDING } from '../shared/task-output';
import { digest, uid, now } from '../shared/utils';
import type { Store } from './store';
import type { ToolConnections } from './tool-connections';

export class TaskMcpTargets {
  private candidates = new Map<string, TaskMcpPreview & { fingerprint: string }>();
  constructor(
    private store: Store,
    private connections: ToolConnections,
    private assertSelectable: (task: PlanningTask) => void,
  ) {}
  cancelTask(taskId: string) {
    for (const [token, candidate] of this.candidates)
      if (candidate.target.taskId === taskId) this.candidates.delete(token);
  }
  cancelAll() {
    this.candidates.clear();
  }
  cancel(taskId: string, token: string) {
    if (this.candidates.get(token)?.target.taskId === taskId) this.candidates.delete(token);
  }
  private prune() {
    for (const [token, candidate] of this.candidates)
      if (candidate.expiresAt <= Date.now()) this.candidates.delete(token);
  }
  preview(
    task: PlanningTask,
    connectionId: string,
    revision: number,
    names: string[],
  ): TaskMcpPreview {
    this.assertSelectable(task);
    this.prune();
    const record = this.connections.targetSource(connectionId, revision);
    const tools = names.map((name) => {
      const tool = record.tools.find((tool) => tool.name === name);
      if (!tool) throw new Error('所选工具已变化，请重新读取连接');
      return tool;
    });
    for (const [token, candidate] of this.candidates)
      if (candidate.target.taskId === task.id) this.candidates.delete(token);
    if (this.candidates.size >= 20) throw new Error('待核对工具对象过多，请稍后重试');
    const target: TaskMcpTarget = {
      version: 1,
      selectionId: uid(),
      taskId: task.id,
      connectionId,
      connectionRevision: record.revision,
      capabilityDigest: record.capabilityDigest,
      selectedAt: now(),
      displayName: record.config.displayName,
      source: record.config.source,
      transport: record.config.transport.type,
      protocolVersion: record.protocolVersion,
      testedAt: record.testedAt,
      tools: structuredClone(tools),
    };
    const candidate = {
      token: uid(),
      expiresAt: Date.now() + 300000,
      target,
      fingerprint: digest(task),
    };
    this.candidates.set(candidate.token, candidate);
    return {
      token: candidate.token,
      expiresAt: candidate.expiresAt,
      target: structuredClone(target),
    };
  }
  select(task: PlanningTask, token: string): TaskMcpTarget {
    this.assertSelectable(task);
    this.prune();
    const candidate = this.candidates.get(token);
    if (!candidate || candidate.target.taskId !== task.id || candidate.fingerprint !== digest(task))
      throw new Error('工具对象核对已过期或任务已变化，请重新核对');
    const record = this.connections.targetSource(
      candidate.target.connectionId,
      candidate.target.connectionRevision,
    );
    if (record.capabilityDigest !== candidate.target.capabilityDigest)
      throw new Error('连接能力已变化，请重新核对工具清单');
    this.candidates.delete(token);
    return structuredClone(candidate.target);
  }
  assertChange(task: PlanningTask) {
    this.assertSelectable(task);
  }
  states(targets: TaskMcpTarget[] = []): TaskMcpState[] {
    return targets.map((target) => {
      try {
        const record = this.connections.targetSource(
          target.connectionId,
          target.connectionRevision,
        );
        if (record.capabilityDigest !== target.capabilityDigest) throw new Error('连接能力已变化');
        return { selectionId: target.selectionId, current: true };
      } catch (error) {
        return {
          selectionId: target.selectionId,
          current: false,
          reason: (error as Error).message,
        };
      }
    });
  }
  verifyPlanning(task: PlanningTask, flow?: Flow) {
    if (task.toolTargets?.length && task.webTarget)
      throw new Error('当前不能混合只读网页和工具方案，请明确移除其中一种目标后继续');
    for (const target of task.toolTargets ?? []) {
      if (target.taskId !== task.id) throw new Error('工具目标不属于当前任务');
      const record = this.connections.targetSource(target.connectionId, target.connectionRevision);
      if (record.capabilityDigest !== target.capabilityDigest)
        throw new Error('工具能力已变化，请重新选择');
    }
    if (flow) assertMcpPlan(flow, task.toolTargets, task.outputTarget ? OUTPUT_BINDING : undefined);
  }
  reviewStates(record: FlowRecord): TaskMcpState[] {
    return (record.toolTargets ?? []).map((target) => {
      const task = this.store.get<PlanningTask>('ai-task', target.taskId);
      const selected = task?.toolTargets?.find((entry) => entry.selectionId === target.selectionId);
      if (
        !task ||
        task.flowId !== record.id ||
        task.toolsRequirePlan ||
        !selected ||
        digest(selected) !== digest(target)
      )
        return {
          selectionId: target.selectionId,
          current: false,
          reason: '原任务的工具选择已变化或需要重新规划，请重新生成并采纳完整方案。',
        };
      return this.states([target])[0];
    });
  }
  assertExecutable(flowId: string, record?: FlowRecord, reviewed = false) {
    const tasks = this.store.list<PlanningTask>('ai-task').filter((task) => task.flowId === flowId);
    if (tasks.some((task) => task.toolTargets?.length) || record?.toolTargets?.length) {
      if (!reviewed || !record?.toolTargets?.length)
        throw new Error('工具方案需从原任务核对并明确确认本次试运行，暂不支持直接运行或定时计划');
      const states = this.reviewStates(record);
      const invalid = states.find((state) => !state.current);
      if (invalid) throw new Error(invalid.reason || '工具选择已变化，请重新核对');
      assertMcpPlan(
        record.flow,
        record.toolTargets,
        record.outputTarget ? OUTPUT_BINDING : undefined,
      );
    }
    if (tasks.some((task) => task.toolsRequirePlan))
      throw new Error('工具选择已变化，请从原任务重新生成并采纳完整方案后运行');
  }
}
