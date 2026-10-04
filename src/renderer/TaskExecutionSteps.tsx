import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { taskRunPresentation } from './task-run-presentation';
import './task-execution-steps.css';
import type { Flow } from '../shared/types';
import { flatten } from './flow-editing';
import { taskStepSummary } from './task-step-presentation';

type Model = ReturnType<typeof taskRunPresentation>;
type Filter = 'all' | 'completed' | 'unresolved' | 'unvisited';
export type TaskExecutionView = { query: string; filter: Filter; scroll: number };
const filters: Record<Filter, string> = {
  all: '全部',
  completed: '已完成',
  unresolved: '已开始未完成',
  unvisited: '尚未执行',
};

export default function TaskExecutionSteps({
  model,
  view,
  change,
  compact = false,
  snapshot,
}: {
  model: Model;
  compact?: boolean;
  snapshot?: Flow;
  view?: TaskExecutionView;
  change: (view: TaskExecutionView) => void;
}) {
  const id = useId();
  const { query = '', filter = 'all', scroll = 0 } = view ?? {};
  const [focusRequest, setFocusRequest] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState<boolean>();
  const showFilters = filtersOpen ?? (model.rows.length > 8 || !!query || filter !== 'all');
  const list = useRef<HTMLOListElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const elements = useRef(new Map<string, HTMLLIElement>());
  const requested = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = scroll;
  }, [query, filter]);
  useLayoutEffect(() => {
    const instance = requested.current;
    if (!instance) return;
    requested.current = undefined;
    const element = elements.current.get(instance);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: 'nearest' });
  }, [focusRequest]);
  const nodes = new Map(flatten(snapshot?.steps ?? []).map((node) => [node.id, node]));
  const needle = query.trim().toLocaleLowerCase();
  const visible = model.rows
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row, index }) =>
        (filter === 'all' ||
          (filter === 'completed'
            ? row.ended
            : filter === 'unresolved'
              ? row.started && !row.ended
              : !row.started && !row.ended)) &&
        [
          row.name,
          row.nodeId,
          row.instance,
          String(index + 1),
          String(index + 1).padStart(2, '0'),
          nodes.get(row.nodeId)?.name,
        ].some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(needle)),
    );
  const focusLabel =
    model.terminal || model.uncertain || model.view.closing
      ? '定位最后记录步骤'
      : model.view.step.kind === 'paused'
        ? '定位下一步'
        : '定位当前步骤';
  const controls = (
    <>
      <p>
        {model.completed.length} 次已完成 · {model.unresolved.length} 次已开始未确认完成 ·{' '}
        {model.unvisited.length} 个尚未执行
      </p>
      <div className="task-execution-actions">
        <button
          type="button"
          disabled={!model.current}
          onClick={() => {
            if (!model.current) return;
            change({ query: '', filter: 'all', scroll: 0 });
            requested.current = model.current.instance;
            setFocusRequest((value) => value + 1);
          }}
        >
          {focusLabel}
        </button>
        {(query || filter !== 'all') && (
          <button
            type="button"
            onClick={() => {
              change({ query: '', filter: 'all', scroll: 0 });
              setFiltersOpen(true);
              requestAnimationFrame(() => search.current?.focus());
            }}
          >
            清除步骤筛选
          </button>
        )}
        <button
          type="button"
          className="task-execution-filter-toggle"
          aria-expanded={showFilters}
          aria-controls={`${id}-filters`}
          onClick={() => setFiltersOpen(!showFilters)}
        >
          {showFilters ? '收起查找与筛选' : '查找与筛选步骤'}
          {!!query || filter !== 'all' ? ' · 已有筛选条件' : ''}
        </button>
      </div>
      <div id={`${id}-filters`} className="task-execution-filters" hidden={!showFilters}>
        <label htmlFor={`${id}-search`}>查找执行步骤</label>
        <input
          ref={search}
          id={`${id}-search`}
          value={query}
          placeholder="步骤名称、编号或循环位置"
          onChange={(event) => change({ query: event.target.value, filter, scroll: 0 })}
        />
        <div className="task-execution-actions" aria-label="执行步骤状态">
          {(Object.keys(filters) as Filter[]).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={value === filter}
              onClick={() => change({ query, filter: value, scroll: 0 })}
            >
              {filters[value]} · {value === 'all' ? model.rows.length : model[value].length}
            </button>
          ))}
        </div>
      </div>
      <p role="status" hidden={!showFilters && !query && filter === 'all'}>
        显示 {visible.length} / {model.rows.length}{' '}
        条。序号沿用完整清单；同一步骤的循环执行分别记录。
      </p>
    </>
  );
  return (
    <section
      className={
        'ai-task-card task-run-steps task-execution-steps' + (compact ? ' is-compact' : '')
      }
      aria-labelledby={`${id}-heading`}
    >
      <h2 id={`${id}-heading`}>执行步骤</h2>
      {!compact && controls}
      <ol
        ref={list}
        aria-label="执行步骤清单"
        onScroll={(event) => change({ query, filter, scroll: event.currentTarget.scrollTop })}
      >
        {visible.map(({ row, index }) => {
          const node = nodes.get(row.nodeId);
          const summary =
            compact && node && snapshot
              ? taskStepSummary(node, snapshot, { snapshot: true })
              : undefined;
          return (
            <li
              key={row.instance}
              tabIndex={-1}
              ref={(element) => {
                if (element) elements.current.set(row.instance, element);
                else elements.current.delete(row.instance);
              }}
              aria-current={row.current ? 'step' : undefined}
            >
              <span className="task-run-index">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <div className="task-execution-row-heading">
                  <strong>{row.name}</strong>
                  {compact && (
                    <span className={'run-status run-tone-' + row.tone}>{row.label}</span>
                  )}
                </div>
                {summary && <p className="task-execution-summary">配置：{summary}</p>}
                {!compact && (
                  <p>
                    <span className={'run-status run-tone-' + row.tone}>{row.label}</span>
                  </p>
                )}
                {(!compact || row.instance !== row.nodeId) && (
                  <small>
                    {row.instance !== row.nodeId ? '循环/分支位置：' : '步骤编号：'}
                    {row.instance}
                  </small>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {compact && <div className="task-execution-tools">{controls}</div>}
      {!visible.length && (
        <p className="task-execution-empty">
          {model.rows.length
            ? '没有匹配的步骤。清除筛选可查看全部记录。'
            : '尚无已保存的执行步骤。'}
        </p>
      )}
      <p className="task-run-note">
        条件中未选择的分支保持未执行；定位和筛选不会执行步骤，也不会更改运行起点。
      </p>
    </section>
  );
}
