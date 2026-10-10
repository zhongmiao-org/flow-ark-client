import { Button, Input } from 'antd';
import { useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import type { Flow, Step } from '../shared/types';
import { flatten } from './flow-editing';
import { flowOutline } from './flow-outline';
import { taskStepSummary, taskStepTitle, type TaskStepContext } from './task-step-presentation';

export type TaskStepListHandle = { reveal: (id: string) => void };

export default function TaskStepList({
  flow,
  selected,
  select,
  context = {},
  active = true,
  ref,
}: {
  flow: Flow;
  selected: string;
  select: (id: string) => void;
  context?: TaskStepContext;
  active?: boolean;
  ref?: Ref<TaskStepListHandle>;
}) {
  const { entries, byId } = useMemo(() => flowOutline(flow.steps), [flow.steps]);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const long = entries.length > 12;
  const terms = long ? query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean) : [];
  const matches = terms.length
    ? entries.filter(({ step, ordinal }) => {
        const text =
          `${ordinal} ${String(ordinal).padStart(2, '0')} ${step.name ?? ''} ${taskStepTitle(step)} ${taskStepSummary(step, flow, context)}`.toLocaleLowerCase();
        return terms.every((term) => text.includes(term));
      })
    : [];
  useImperativeHandle(
    ref,
    () => ({
      reveal(id) {
        setQuery('');
        setCollapsed((previous) => {
          const next = new Set(previous);
          byId.get(id)?.ancestors.forEach((key) => next.delete(key));
          return next;
        });
        setFocusId(id);
      },
    }),
    [byId],
  );
  useLayoutEffect(() => {
    if (!active || !focusId) return;
    const button = [
      ...(root.current?.querySelectorAll<HTMLButtonElement>('[data-step-id]') ?? []),
    ].find((item) => item.dataset.stepId === focusId);
    button?.scrollIntoView({ block: 'nearest' });
    button?.focus({ preventScroll: true });
    setFocusId('');
  }, [active, focusId]);
  function row(step: Step) {
    return (
      <Button
        className="ai-task-step"
        aria-pressed={selected === step.id}
        data-step-id={step.id}
        onClick={() => select(step.id)}
      >
        <b>{String(byId.get(step.id)?.ordinal).padStart(2, '0')}</b>
        <span>
          <strong>{taskStepTitle(step)}</strong>
          <small>{taskStepSummary(step, flow, context)}</small>
        </span>
      </Button>
    );
  }
  function branch(steps: Step[], key: string, label: string) {
    return (
      <div className="ai-task-step-branch">
        <Button
          className="ai-task-branch-toggle"
          aria-expanded={!collapsed.has(key)}
          onClick={() =>
            setCollapsed((previous) => {
              const next = new Set(previous);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
        >
          <span aria-hidden="true">{collapsed.has(key) ? '▸' : '▾'}</span>
          {label} · {flatten(steps).length} 步
        </Button>
        {!collapsed.has(key) && block(steps)}
      </div>
    );
  }
  function block(steps: Step[]) {
    return (
      <div className="ai-task-steps">
        {steps.map((step) => (
          <div key={step.id}>
            {row(step)}
            {step.type === 'condition' && (
              <div className="ai-task-branches">
                {branch(step.then, `${step.id}:then`, '条件成立')}
                {branch(step.else, `${step.id}:else`, '条件不成立')}
              </div>
            )}
            {step.type === 'loop' && (
              <div className="ai-task-branches">
                {branch(step.body, `${step.id}:body`, '循环体 · 串行执行')}
              </div>
            )}
          </div>
        ))}
        {!steps.length && <p>此分支没有步骤，继续后续流程。</p>}
      </div>
    );
  }
  return (
    <div ref={root} className="task-step-list" hidden={!active}>
      {long && (
        <div className="task-step-search">
          <label>
            查找步骤
            <Input
              ref={(instance) => {
                search.current = instance?.input ?? null;
              }}
              type="search"
              value={query}
              placeholder="输入步骤名称、编号或内容"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && query) {
                  event.stopPropagation();
                  setQuery('');
                }
              }}
            />
          </label>
          {query && (
            <Button
              onClick={() => {
                setQuery('');
                search.current?.focus();
              }}
            >
              清空查找
            </Button>
          )}
          <p role="status">
            {terms.length
              ? `找到 ${matches.length} / ${entries.length} 步`
              : `共 ${entries.length} 步，包含分支和循环内步骤。`}
          </p>
        </div>
      )}
      {terms.length ? (
        <div className="ai-task-steps">
          {matches.map(({ step, ancestors }) => (
            <div key={step.id}>
              {!!ancestors.length && (
                <p className="task-step-search-location">
                  {ancestors
                    .map((key) => {
                      const split = key.lastIndexOf(':');
                      const parent = byId.get(key.slice(0, split));
                      return `${parent ? taskStepTitle(parent.step) : ''} / ${{ then: '条件成立', else: '条件不成立', body: '循环体' }[key.slice(split + 1)]}`;
                    })
                    .join(' → ')}
                </p>
              )}
              {row(step)}
            </div>
          ))}
          {!matches.length && (
            <p>没有匹配的步骤。试试其他名称、编号或内容，或清空查找查看完整流程。</p>
          )}
        </div>
      ) : (
        block(flow.steps)
      )}
    </div>
  );
}
