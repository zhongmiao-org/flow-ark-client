import { access, realpath, stat, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Store } from './store';
import type { PlanningTask } from '../shared/planning';
import type { FlowRecord, Bindings } from '../shared/types';
import { digest, now, uid } from '../shared/utils';
import { assertOutputFlow, OUTPUT_BINDING, type TaskOutputTarget } from '../shared/task-output';

export class TaskOutputs {
  constructor(
    private store: Store,
    private deps: {
      choose: () => Promise<string | null>;
      assertSelectable: (task: PlanningTask) => void;
    },
  ) {}
  assertSelectable(task: PlanningTask) {
    this.deps.assertSelectable(task);
  }
  async choose(task: PlanningTask, options: Pick<TaskOutputTarget, 'name' | 'onConflict'>) {
    this.assertSelectable(task);
    const selected = await this.deps.choose();
    if (selected === null) return null;
    this.assertSelectable(task);
    if (typeof selected !== 'string' || !isAbsolute(selected) || selected.length > 4096)
      throw new Error('目录选择器没有返回有效的本机目录');
    const directory = await realpath(selected);
    const info = await stat(directory, { bigint: true });
    if (!info.isDirectory()) throw new Error('输出位置必须是本机目录');
    await access(directory, constants.W_OK);
    return {
      selectionId: uid(),
      taskId: task.id,
      directory,
      dev: String(info.dev),
      ino: String(info.ino),
      ...options,
      selectedAt: now(),
    } satisfies TaskOutputTarget;
  }
  async verify(target: TaskOutputTarget) {
    try {
      if ((await realpath(target.directory)) !== target.directory)
        throw new Error('目录来源已变化');
      const info = await stat(target.directory, { bigint: true });
      if (!info.isDirectory() || String(info.dev) !== target.dev || String(info.ino) !== target.ino)
        throw new Error('目录身份已变化');
      await access(target.directory, constants.W_OK);
      if (target.onConflict === 'overwrite') {
        const file = await lstat(join(target.directory, target.name)).catch((e) => {
          if (e.code !== 'ENOENT') throw e;
          return null;
        });
        if (file && !file.isFile()) throw new Error('覆盖目标必须是普通文件，不能为符号链接或目录');
      }
    } catch {
      throw new Error('所选输出目录或文件不可用，请在理解页重新选择并核对');
    }
  }
  bindings(target: TaskOutputTarget, previous: FlowRecord | null): Bindings {
    const bindings = previous?.bindings ?? { files: {}, credentials: [] };
    const bound = bindings.files[OUTPUT_BINDING];
    // A prior host-owned selection can be explicitly replaced. Unrelated manual
    // resources using this name must not be silently overwritten.
    if (
      bound &&
      bound !== target.directory &&
      (previous?.outputTarget?.taskId !== target.taskId ||
        previous.outputTarget.directory !== bound)
    )
      throw new Error('现有 task_output 手动绑定与所选目录冲突，请先移除冲突绑定再重新生成');
    return { ...bindings, files: { ...bindings.files, [OUTPUT_BINDING]: target.directory } };
  }
  async record(record: FlowRecord) {
    const current = this.store.get<FlowRecord>('flow', record.id);
    const target = record.outputTarget;
    if (!target) {
      if (
        current?.outputTarget ||
        this.store
          .list<PlanningTask>('ai-task')
          .some((t) => t.flowId === record.id && t.outputTarget)
      )
        throw new Error('尚未采纳当前输出选择，请返回任务确认');
      return;
    }
    const check = () => {
      const task = this.store.get<PlanningTask>('ai-task', target.taskId);
      const latest = this.store.get<FlowRecord>('flow', record.id);
      if (
        !task ||
        task.flowId !== record.id ||
        digest(task.outputTarget ?? null) !== digest(target) ||
        digest(latest?.outputTarget ?? null) !== digest(target) ||
        record.bindings.files[OUTPUT_BINDING] !== target.directory ||
        latest?.bindings.files[OUTPUT_BINDING] !== target.directory
      )
        throw new Error('输出选择或绑定已撤销、更换，请重新生成并采纳方案');
      assertOutputFlow(record.flow, target);
    };
    check();
    await this.verify(target);
    check();
  }
}
