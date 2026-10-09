import type { Store } from './store';
import type { PlanningTask } from '../shared/planning';
import type { FlowRecord } from '../shared/types';
import type { EmbeddedReview } from '../shared/run-review';
import type { RepairSelection } from '../shared/task-repair';
import { digest, uid, now } from '../shared/utils';
import {
  assertWebFlow,
  assertWebContext,
  pageIdentity,
  sameWebPage,
  type TaskWebTarget,
  type TaskWebPreview,
  type WebPageIdentity,
  type TaskWebElementCapture,
  type TaskWebElement,
} from '../shared/task-web-target';

export function repairedWebTarget(
  previous: TaskWebTarget,
  selection: RepairSelection,
): TaskWebTarget {
  return {
    ...previous,
    selectionId: selection.requestId,
    selectedAt: now(),
    page: {
      resourceId: selection.resourceId,
      documentRevision: selection.documentRevision,
      url: selection.url,
      title: selection.title,
    },
    ...(previous.element
      ? { element: { requestId: selection.requestId, target: selection.target } }
      : {}),
  };
}

export class TaskWebTargets {
  private readonly session = uid();
  constructor(
    private store: Store,
    private deps: {
      page: () => Promise<EmbeddedReview>;
      captureElement?: (requestId: string) => Promise<TaskWebElementCapture>;
      verifyElement?: (page: WebPageIdentity, element: TaskWebElement) => Promise<unknown>;
      assertSelectable: () => void;
    },
  ) {}
  private unchanged(task: PlanningTask) {
    this.deps.assertSelectable();
    if (digest(this.store.get('ai-task', task.id)) !== digest(task))
      throw new Error('任务已变化，请重新检查网页目标');
  }
  async preview(task: PlanningTask, pickRequestId?: string): Promise<TaskWebPreview> {
    this.unchanged(task);
    try {
      const page = pageIdentity(await this.deps.page());
      let element: TaskWebElement | undefined;
      if (pickRequestId) {
        if (!this.deps.captureElement) throw new Error('网页元素选择不可用');
        const captured = await this.deps.captureElement(pickRequestId);
        if (captured.element.requestId !== pickRequestId || !sameWebPage(captured.page, page))
          throw new Error('元素来源与当前网页不一致，请重新选取');
        element = captured.element;
      }
      this.unchanged(task);
      return {
        ready: true,
        page,
        ...(element ? { element } : {}),
        token: digest({ task, page, element, session: this.session }),
      };
    } catch (error) {
      this.unchanged(task);
      return { ready: false, reason: (error as Error).message };
    }
  }
  async select(task: PlanningTask, token: string, pickRequestId?: string): Promise<TaskWebTarget> {
    if (task.context.length >= 20) throw new Error('已选网页需要一项上下文，请先移除至少一项资料');
    const preview = await this.preview(task, pickRequestId);
    if (!preview.ready || !preview.page || preview.token !== token)
      throw new Error(preview.reason || '网页或任务已变化，请重新检查后选择');
    if (
      this.store
        .list<PlanningTask>('ai-task')
        .some((t) => t.id !== task.id && t.flowId === task.flowId && t.webTarget)
    )
      throw new Error('此流程已有其他任务选择的网页，请先在原任务移除来源');
    const target: TaskWebTarget = {
      selectionId: uid(),
      taskId: task.id,
      browserId: 'embedded',
      access: 'read',
      page: preview.page,
      selectedAt: now(),
      ...(preview.element ? { element: preview.element } : {}),
    };
    assertWebContext(task.context, target);
    return target;
  }
  private current(target: TaskWebTarget) {
    const task = this.store.get<PlanningTask>('ai-task', target.taskId);
    if (!task || digest(task.webTarget ?? null) !== digest(target))
      throw new Error('网页选择已撤销或更换，请回到任务重新确认');
    return task;
  }
  async verify(target: TaskWebTarget, expected = target.page) {
    this.current(target);
    const actual = pageIdentity(await this.deps.page());
    this.current(target);
    if (!sameWebPage(expected, actual))
      throw new Error('已选网页已刷新、切换或重新打开，请重新选择目标');
    if (target.element) {
      if (!this.deps.verifyElement) throw new Error('网页元素复验不可用，请重新选择目标');
      await this.deps.verifyElement(expected, target.element);
      this.current(target);
    }
  }
  async record(record: FlowRecord, expected?: WebPageIdentity) {
    const target = record.webTarget;
    const current = this.store.get<FlowRecord>('flow', record.id);
    if (!target) {
      if (
        current?.webTarget ||
        this.store.list<PlanningTask>('ai-task').some((t) => t.flowId === record.id && t.webTarget)
      )
        throw new Error('尚未采纳当前网页对象的方案，请返回任务确认');
      return;
    }
    const task = this.current(target);
    if (task.flowId !== record.id || digest(current?.webTarget ?? null) !== digest(target))
      throw new Error('流程的网页选择已变化，旧版本不能继承新目标');
    if (record.bindings.browserId !== 'embedded' || current?.bindings.browserId !== 'embedded')
      throw new Error('所选网页必须使用原内置浏览器绑定');
    assertWebFlow(record.flow, target, record.outputTarget);
    await this.verify(target, expected);
    const after = this.store.get<FlowRecord>('flow', record.id);
    if (
      digest(after?.webTarget ?? null) !== digest(target) ||
      after?.bindings.browserId !== 'embedded' ||
      this.current(target).flowId !== record.id
    )
      throw new Error('核对期间网页选择或浏览器绑定已变化');
  }
}
