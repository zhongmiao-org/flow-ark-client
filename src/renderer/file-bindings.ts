import type { Step } from '../shared/types';
import { staticUploadFields } from '../shared/upload-source';
/** Local names are collected recursively; no filesystem access or path inference. */
export function fileBindingNames(
  steps: Step[],
  current: Record<string, string>,
  parameters: Record<string, unknown> = {},
): string[] {
  const names = new Set(['workspace', ...Object.keys(current)]);
  const visit = (steps: Step[]) => {
    for (const step of steps) {
      if (step.type === 'file' || step.type === 'excel') names.add(step.binding);
      if (step.type === 'browser' && step.operation === 'upload') {
        try {
          const binding = staticUploadFields(step.value, parameters)?.binding;
          if (binding?.known && typeof binding.value === 'string' && binding.value.trim())
            names.add(binding.value);
        } catch {
          /* Incomplete drafts remain editable; admission reports invalid values. */
        }
      }
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
