import { useMemo } from 'react';
import type { Flow, Step } from '../shared/types';
import { flatten } from './flow-editing';
import { taskStepSummary, taskStepTitle, type TaskStepContext } from './task-step-presentation';

export default function TaskStepList({
  flow,
  selected,
  select,
  context = {},
}: {
  flow: Flow;
  selected: string;
  select: (id: string) => void;
  context?: TaskStepContext;
}) {
  const ordinals = useMemo(
    () => new Map(flatten(flow.steps).map((step, index) => [step.id, index + 1])),
    [flow],
  );
  function block(steps: Step[], branch?: string) {
    return (
      <div className="ai-task-steps">
        {branch && <h3>{branch}</h3>}
        {steps.map((step) => (
          <div key={step.id}>
            <button
              className="ai-task-step"
              aria-pressed={selected === step.id}
              data-step-id={step.id}
              onClick={() => select(step.id)}
            >
              <b>{String(ordinals.get(step.id)).padStart(2, '0')}</b>
              <span>
                <strong>{taskStepTitle(step)}</strong>
                <small>{taskStepSummary(step, flow, context)}</small>
              </span>
            </button>
            {step.type === 'condition' && (
              <div className="ai-task-branches">
                {block(step.then, '条件成立')}
                {block(step.else, '条件不成立')}
              </div>
            )}
            {step.type === 'loop' && (
              <div className="ai-task-branches">{block(step.body, '循环体 · 串行执行')}</div>
            )}
          </div>
        ))}
        {!steps.length && <p>此分支没有步骤，继续后续流程。</p>}
      </div>
    );
  }
  return block(flow.steps);
}
