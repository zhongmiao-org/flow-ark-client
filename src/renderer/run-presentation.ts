import { presentRun as presentSavedRun } from '../shared/run-presentation';
import type { RunPresentationInput } from '../shared/run-presentation';
import { runInstancePresenter } from './run-instance-presentation';
export * from '../shared/run-presentation';

/** Resolve display names from this run's fixed snapshot, never from a mutable draft. */
export function presentRun(input: RunPresentationInput, now: number) {
  const view = presentSavedRun(input, now);
  if (!view.step.instance) return view;
  const name = runInstancePresenter(input.snapshot)(view.step.instance) ?? '步骤位置待核对';
  const prefix = {
    current: '当前步骤',
    paused: '下一步',
    waiting: '等待人工',
    last: '最后记录步骤',
    pending: '运行位置',
    unknown: '运行位置',
  }[view.step.kind];
  return { ...view, step: { ...view.step, name, label: `${prefix}：${name}` } };
}
