import type { Flow } from '../shared/types';
import { buildDiagram } from './flow-diagram';
import { flowOutline } from './flow-outline';
import { taskStepTitle, taskStepSummary, type TaskStepContext } from './task-step-presentation';

/** The same executable steps, projected with the task-board dimensions and labels. */
export function buildTaskDiagram(flow: Flow, selected: string, context: TaskStepContext) {
  const diagram = buildDiagram(flow.steps, selected, 'task');
  const outline = flowOutline(flow.steps);
  return {
    ...diagram,
    nodes: diagram.nodes.map((node) => {
      const step = node.data.step;
      if (!step) return node;
      const title = taskStepTitle(step);
      return {
        ...node,
        ariaLabel: `${outline.byId.get(step.id)!.ordinal} · ${title}`,
        data: {
          ...node.data,
          task: {
            ordinal: outline.byId.get(step.id)!.ordinal,
            title,
            summary: taskStepSummary(step, flow, context),
          },
        },
      };
    }),
  };
}
