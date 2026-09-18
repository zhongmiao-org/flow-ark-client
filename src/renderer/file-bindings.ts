import type { Step } from '../shared/types';
/** Local names are collected recursively; no filesystem access or path inference. */
export function fileBindingNames(steps: Step[], current: Record<string, string>): string[] {
  const names = new Set(['workspace', ...Object.keys(current)]);
  const visit = (steps: Step[]) => {
    for (const step of steps) {
      if (step.type === 'file' || step.type === 'excel') names.add(step.binding);
      if (
        step.type === 'browser' &&
        step.operation === 'upload' &&
        step.value &&
        typeof step.value === 'object' &&
        'binding' in step.value &&
        typeof step.value.binding === 'string'
      )
        names.add(step.value.binding);
      if (step.type === 'condition') {
        visit(step.then);
        visit(step.else);
      }
      if (step.type === 'loop') visit(step.body);
    }
  };
  visit(steps);
  return [...names];
}
