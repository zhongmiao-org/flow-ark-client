import type { Step } from '../shared/types';
import { flatten } from './flow-editing';
import { kinds } from './node-kinds';
export const stepTitle = (step: Step) =>
  typeof step.name === 'string' && step.name && !['file', 'excel'].includes(step.type)
    ? step.name
    : kinds[step.type].label;
export type OutlineEntry = { step: Step; ordinal: number; group: string; ancestors: string[] };
export type OutlineGroup = { id: string; steps: Step[]; start: number; end: number; title: string };

/** Group contiguous root steps, keeping each real condition/loop intact. No new execution nodes. */
export function flowOutline(steps: Step[], groupSize = 8) {
  if (!Number.isInteger(groupSize) || groupSize < 1) throw new Error('大纲分组大小必须为正整数');
  const groups: OutlineGroup[] = [],
    entries: OutlineEntry[] = [];
  let pending: Step[] = [];
  function collect(nodes: Step[], group: string, ancestors: string[]) {
    for (const step of nodes) {
      entries.push({ step, ordinal: entries.length + 1, group, ancestors });
      if (step.type === 'condition') {
        collect(step.then, group, [...ancestors, step.id + ':then']);
        collect(step.else, group, [...ancestors, step.id + ':else']);
      }
      if (step.type === 'loop') collect(step.body, group, [...ancestors, step.id + ':body']);
    }
  }
  function flush() {
    if (!pending.length) return;
    const id = pending[0].id,
      start = entries.length + 1;
    collect(pending, id, []);
    groups.push({
      id,
      steps: pending,
      start,
      end: entries.length,
      title:
        pending.length === 1
          ? stepTitle(pending[0])
          : `${stepTitle(pending[0])} → ${stepTitle(pending.at(-1)!)}`,
    });
    pending = [];
  }
  for (const step of steps) {
    if (step.type === 'condition' || step.type === 'loop') {
      flush();
      pending.push(step);
      flush();
    } else {
      pending.push(step);
      if (pending.length >= groupSize) flush();
    }
  }
  flush();
  return { groups, entries, byId: new Map(entries.map((entry) => [entry.step.id, entry])) };
}
export function outlineMatches(entries: OutlineEntry[], query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return terms.length
    ? entries.filter(({ step, ordinal }) => {
        const text =
          `${ordinal} ${step.id} ${stepTitle(step)} ${kinds[step.type].label}`.toLocaleLowerCase();
        return terms.every((term) => text.includes(term));
      })
    : [];
}
export function revealOutline(entry: OutlineEntry, collapsed: Set<string>) {
  const next = new Set(collapsed);
  entry.ancestors.forEach((key) => next.delete(key));
  return { group: entry.group, collapsed: next };
}
export function branchCount(steps: Step[]) {
  return flatten(steps).length;
}
