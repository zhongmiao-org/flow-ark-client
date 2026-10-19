import type { Flow, Step } from '../shared/types';
import { flatten } from './flow-editing';
import { taskStepTitle } from './task-step-title';

export function flowStepLabel(snapshot: Flow | undefined, nodeId: string): string {
  const steps = flatten(snapshot?.steps ?? []);
  const index = steps.findIndex((step) => step.id === nodeId);
  return index < 0
    ? '步骤名称待核对'
    : `${String(index + 1).padStart(2, '0')} ${taskStepTitle(steps[index])}`;
}

/** Describe only instance paths that can be followed through the fixed snapshot. */
export function runInstancePresenter(snapshot?: Flow) {
  const ordinals = new Map(
    flatten(snapshot?.steps ?? []).map((step, index) => [step.id, index + 1]),
  );
  return (instance: string): string | null => {
    if (!snapshot || !instance) return null;
    const parts = instance.split('/').map((part) => /^([a-zA-Z0-9_-]+)(?:\[(\d+)\])?$/.exec(part));
    let candidates: Step[] = snapshot.steps;
    const labels: string[] = [];
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (!part) return null;
      const step = candidates.find((node) => node.id === part[1]);
      if (!step) return null;
      const title = `${String(ordinals.get(step.id)).padStart(2, '0')} ${taskStepTitle(step)}`;
      if (index === parts.length - 1) {
        if (part[2] !== undefined) return null;
        labels.push(title);
      } else if (step.type === 'loop' && part[2] !== undefined) {
        const iteration = Number(part[2]);
        if (!Number.isSafeInteger(iteration) || iteration >= Number.MAX_SAFE_INTEGER) return null;
        labels.push(`${title} · 第 ${iteration + 1} 项`);
        candidates = step.body;
      } else if (step.type === 'condition' && part[2] === undefined) {
        const nextId = parts[index + 1]?.[1];
        const inThen = step.then.some((node) => node.id === nextId);
        const inElse = step.else.some((node) => node.id === nextId);
        if (inThen === inElse) return null;
        labels.push(`${title} · ${inThen ? '成立分支' : '否则分支'}`);
        candidates = inThen ? step.then : step.else;
      } else return null;
    }
    return labels.join(' / ');
  };
}
