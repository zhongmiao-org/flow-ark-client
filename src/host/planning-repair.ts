import type { Store } from './store';
import type { PlanningInput, PlanningTask, PlanningResult } from '../shared/planning';
import type { BrowserBinding, Flow, FlowRecord, Run } from '../shared/types';
import {
  repairSelectionSchema,
  type RepairInput,
  type RepairPreview,
  type RepairReference,
  type RepairSelection,
} from '../shared/task-repair';
import { capabilities, validateFlow, validateObject, walk } from '../core/validate';
import { canonical, digest, uid } from '../shared/utils';

export class PlanningRepair {
  private readonly session = uid();
  constructor(
    private store: Store,
    private deps: {
      assertAvailable: () => void;
      epoch?: () => number;
      capture: (requestId: string) => Promise<RepairSelection>;
    },
  ) {}

  private source(args: RepairInput) {
    this.deps.assertAvailable();
    const task = this.store.get<PlanningTask>('ai-task', args.id);
    if (!task || task.revision !== args.revision) throw new Error('任务草稿已变化，请重新检查修复');
    const run = this.store.get<Run>('run', args.runId);
    if (
      !run ||
      run.flowId !== task.flowId ||
      !['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(run.state)
    )
      throw new Error('修复来源必须是此任务已停止的失败、取消或中断运行');
    const snapshot = this.store.get<FlowRecord>('snapshot', run.id);
    const flow = this.store.get<FlowRecord>('flow', task.flowId);
    if (
      !snapshot ||
      !flow ||
      snapshot.id !== task.flowId ||
      snapshot.flow.id !== task.flowId ||
      flow.id !== task.flowId ||
      flow.flow.id !== task.flowId
    )
      throw new Error('原运行快照或当前流程已不存在');
    validateFlow(snapshot.flow);
    validateFlow(flow.flow);
    const browser =
      flow.bindings.browserId && this.store.get<BrowserBinding>('browser', flow.bindings.browserId);
    if (!browser || browser.product !== 'embedded')
      throw new Error('目标修复需要当前流程绑定内置浏览器');
    const events = this.store.events(run.id);
    const last = [...events].reverse().find((e) => e.type === 'node-start');
    if (
      !last ||
      last.nodeInstance.split('/').at(-1) !== args.nodeId ||
      events.some(
        (e) =>
          e.sequence > last.sequence &&
          e.nodeInstance === last.nodeInstance &&
          e.type === 'node-end' &&
          e.data?.completed === true,
      )
    )
      throw new Error('该步骤不是原运行最后开始且未确认完成的步骤');
    const old = walk(snapshot.flow.steps).find((n) => n.id === args.nodeId);
    const node = walk(flow.flow.steps).find((n) => n.id === args.nodeId);
    if (
      !node ||
      node.type !== 'browser' ||
      ![2, 3].includes(node.version) ||
      typeof node.selector !== 'string' ||
      !node.selector.trim() ||
      node.operation === 'navigate'
    )
      throw new Error('该步骤不支持静态网页目标修复，请回到任务修改方案');
    if (canonical(old) !== canonical(node))
      throw new Error('此步骤已被手动修改，请基于当前方案处理，未覆盖修改');
    return {
      task,
      run,
      flow,
      node,
      signature: digest({
        session: this.session,
        epoch: this.deps.epoch?.() ?? 0,
        task: {
          id: task.id,
          revision: task.revision,
          description: task.description,
          context: task.context,
          answers: task.answers,
        },
        run,
        snapshot,
        flow,
        events,
        browser,
      }),
    };
  }

  async preview(args: RepairInput): Promise<RepairPreview> {
    const before = this.source(args);
    const selection = repairSelectionSchema.parse(await this.deps.capture(args.pickRequestId));
    if (selection.requestId !== args.pickRequestId)
      throw new Error('网页选取身份不一致，请重新选取');
    if (this.source(args).signature !== before.signature)
      throw new Error('修复依据已变化，请重新检查');
    const source = {
      id: before.run.id,
      state: before.run.state,
      nodeId: args.nodeId,
      nodeName: before.node.name || args.nodeId,
      operation: before.node.operation,
      selector: before.node.selector as string,
      framePath: 'framePath' in before.node ? (before.node.framePath ?? []) : [],
    };
    if (
      source.selector === selection.target.selector &&
      canonical(source.framePath) === canonical(selection.target.framePath)
    )
      throw new Error('重新选择的目标没有变化，请核对失败原因');
    const input: PlanningInput = {
      formatVersion: '1.0' as const,
      flowId: before.task.flowId,
      description:
        before.task.description +
        '\n\n本次仅修复指定网页步骤的 selector/framePath。返回完整流程；其他字段、步骤、能力、参数和权限保持不变。',
      context: [
        {
          id: 'selected-target-repair',
          kind: 'web' as const,
          label: '已核对的网页目标修复',
          text: JSON.stringify({ source, target: selection.target }),
        },
      ],
      answers: {},
      baseFlow: before.flow.flow,
      capabilities: [...capabilities],
    };
    validateObject('AIPlanningRequest', input);
    if (Buffer.byteLength(JSON.stringify(input)) > 2 * 1024 * 1024)
      throw new Error('修复上下文超过 2 MiB');
    return { token: digest({ signature: before.signature, selection }), input, source, selection };
  }

  async verify(task: Pick<PlanningTask, 'id' | 'revision'>, ref: RepairReference) {
    const preview = await this.preview({ ...task, ...ref });
    if (preview.token !== ref.token)
      throw new Error('目标、网页或修复依据已变化，请重新选取并检查');
    return preview;
  }

  validate(
    result: PlanningResult,
    before: Flow,
    nodeId: string,
    target: RepairSelection['target'],
  ) {
    if (result.kind !== 'plan') return;
    const expected = structuredClone(before);
    const node = walk(expected.steps).find((n) => n.id === nodeId);
    if (!node || node.type !== 'browser' || !('framePath' in node))
      throw new Error('修复步骤已失效');
    node.selector = target.selector;
    node.framePath = target.framePath as typeof node.framePath;
    if (canonical(result.flow) !== canonical(expected))
      throw new Error('AI 修改超出已确认的目标范围，提案已拒绝；原方案保持不变');
  }
}
