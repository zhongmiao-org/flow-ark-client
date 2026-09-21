import type { Store } from './store';
import type { PlanningTask, TaskDetail } from '../shared/planning';
import type { Run } from '../shared/types';
import { learningMethods, type LearningProgress, type LearningStatus } from '../shared/learning';
import { now, uid } from '../shared/utils';

const kind = 'learning',
  id = 'first-task';
const terminal = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']);
export class Learning {
  constructor(
    private store: Store,
    private deps: {
      create: () => TaskDetail;
      detail: (id: string) => TaskDetail;
      assertAvailable: () => void;
      busy?: (taskId: string) => boolean;
    },
  ) {}
  private state(): LearningProgress {
    const stored = this.store.get<LearningProgress & { formatVersion: number }>(kind, id);
    if (stored && stored.formatVersion !== 1) throw new Error('学习记录版本不支持');
    if (!stored) return { revision: 0, status: 'new', achieved: {} };
    const { formatVersion: _, ...state } = stored;
    return state;
  }
  status(): LearningStatus {
    const state = this.state();
    const runs = state.taskId
      ? this.store.list<Run>('run').filter((r) => r.task?.id === state.taskId)
      : [];
    return {
      ...state,
      taskExists: !!state.taskId && !!this.store.get('ai-task', state.taskId),
      ...(runs.length ? { latestRunId: runs.at(-1)!.id } : {}),
    };
  }
  private put(state: LearningProgress) {
    if (state.revision >= Number.MAX_SAFE_INTEGER - 1) throw new Error('学习修订超出支持范围');
    this.store.put(kind, id, {
      ...state,
      formatVersion: 1,
      revision: state.revision + 1,
      updatedAt: now(),
    });
  }
  request(method: string, input: unknown) {
    if (!Object.hasOwn(learningMethods, method)) throw new Error('学习接口不存在');
    const args: any = learningMethods[method as keyof typeof learningMethods].parse(input);
    if (method === 'learning.status') return this.status();
    this.deps.assertAvailable();
    return this.store.tx(() => {
      let state = this.state();
      if (args.revision !== state.revision) throw new Error('学习记录已变化，请刷新后继续');
      if (method === 'learning.skip') {
        if (state.status !== 'completed') this.put({ ...state, status: 'skipped' });
        return this.status();
      }
      if (args.mode === 'restart' || !state.taskId) {
        if (state.taskId) {
          const task = this.store.get<PlanningTask>('ai-task', state.taskId);
          if (
            task?.status === 'generating' ||
            this.deps.busy?.(state.taskId) ||
            this.store
              .list<Run>('run')
              .some(
                (r) =>
                  (r.task?.id === state.taskId || (!!task && r.flowId === task.flowId)) &&
                  !terminal.has(r.state),
              )
          )
            throw new Error('上次教学仍在生成或运行，请先等待或结束后重新学习');
        }
        const detail = this.deps.create();
        state = {
          revision: state.revision,
          status: 'active',
          attemptId: uid(),
          taskId: detail.task.id,
          achieved: {},
        };
      } else if (!this.store.get('ai-task', state.taskId)) {
        throw new Error('原教学任务已不存在，请明确选择重新学习');
      }
      this.put({ ...state, status: state.achieved.result ? 'completed' : 'active' });
      return { learning: this.status(), detail: this.deps.detail(state.taskId!) };
    });
  }
  private note(taskId: string, key: keyof LearningProgress['achieved'], evidence: object) {
    const state = this.state();
    if (state.taskId !== taskId || state.achieved[key]) return;
    if (key === 'plan' && !state.achieved.target) return;
    if (key === 'trial' && !state.achieved.plan) return;
    if (key === 'result' && !state.achieved.trial) return;
    this.put({
      ...state,
      achieved: { ...state.achieved, [key]: { at: now(), ...evidence } },
      status: key === 'result' && state.status === 'active' ? 'completed' : state.status,
    });
  }
  target(task: PlanningTask) {
    if (task.webTarget) this.note(task.id, 'target', { selectionId: task.webTarget.selectionId });
  }
  plan(task: PlanningTask, flowHash: string) {
    if (task.webTarget) this.note(task.id, 'plan', { flowHash });
  }
  trial(run: Run) {
    if (run.task && run.review) this.note(run.task.id, 'trial', { runId: run.id });
  }
  result(attemptId: string | undefined, item: { runId: string; artifactId: string }, text: string) {
    if (!attemptId || !text.trim()) return;
    this.store.tx(() => {
      const state = this.state(),
        run = this.store.get<Run>('run', item.runId);
      if (state.attemptId !== attemptId || !run?.task || run.state !== 'SUCCEEDED') return;
      this.note(run.task.id, 'result', { runId: run.id, artifactId: item.artifactId });
    });
  }
}
