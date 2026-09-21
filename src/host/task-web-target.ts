import type { Store } from './store';
import type { PlanningTask } from '../shared/planning';
import type { FlowRecord } from '../shared/types';
import type { EmbeddedReview } from '../shared/run-review';
import { digest, uid, now } from '../shared/utils';
import {
  assertWebFlow,
  assertWebContext,
  pageIdentity,
  sameWebPage,
  type TaskWebTarget,
  type TaskWebPreview,
  type WebPageIdentity,
} from '../shared/task-web-target';

export class TaskWebTargets {
  private readonly session = uid();
  constructor(
    private store: Store,
    private deps: { page: () => Promise<EmbeddedReview>; assertSelectable: () => void },
  ) {}
  private unchanged(task: PlanningTask) {
    this.deps.assertSelectable();
    if (digest(this.store.get('ai-task', task.id)) !== digest(task))
      throw new Error('任务已变化，请重新检查网页目标');
  }
  async preview(task: PlanningTask): Promise<TaskWebPreview> {
    this.unchanged(task);
    try {
      const page = pageIdentity(await this.deps.page());
      this.unchanged(task);
      return { ready: true, page, token: digest({ task, page, session: this.session }) };
    } catch (error) {
      this.unchanged(task);
      return { ready: false, reason: (error as Error).message };
    }
  }
  async select(task: PlanningTask, token: string): Promise<TaskWebTarget> {
    if (task.context.length >= 20) throw new Error('已选网页需要一项上下文，请先移除至少一项资料');
    const preview = await this.preview(task);
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
    assertWebFlow(record.flow, target);
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
