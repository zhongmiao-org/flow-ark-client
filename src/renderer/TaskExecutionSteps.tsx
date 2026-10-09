import { Button, Input, Segmented, Tag, Badge, Card, Empty } from 'antd';
import { runStepColors } from './theme';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { taskRunPresentation } from './task-run-presentation';
import './task-execution-steps.css';
import type { RunPresentationInput } from '../shared/run-presentation';
import RunStepDetails from './RunStepDetails';
import { flatten } from './flow-editing';
import { taskStepSummary } from './task-step-presentation';

type Model = ReturnType<typeof taskRunPresentation>;
type Filter = 'all' | 'completed' | 'unresolved' | 'unvisited';
export type TaskExecutionView = {
  query: string;
  filter: Filter;
  scroll: number;
  expanded?: string;
};
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
  detail,
}: {
  model: Model;
  compact?: boolean;
  detail: RunPresentationInput;
  view?: TaskExecutionView;
  change: (view: TaskExecutionView) => void;
}) {
  const id = useId();
  const { query = '', filter = 'all', scroll = 0, expanded } = view ?? {};
  const { snapshot } = detail;
  const update = (next: Omit<TaskExecutionView, 'expanded'>) => change({ ...next, expanded });
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
        <Button
          htmlType="button"
          disabled={!model.current || undefined}
          onClick={() => {
            if (!model.current) return;
            update({ query: '', filter: 'all', scroll: 0 });
            requested.current = model.current.instance;
            setFocusRequest((value) => value + 1);
          }}
        >
          {focusLabel}
        </Button>
        {(query || filter !== 'all') && (
          <Button
            htmlType="button"
            onClick={() => {
              update({ query: '', filter: 'all', scroll: 0 });
              setFiltersOpen(true);
              requestAnimationFrame(() => search.current?.focus());
            }}
          >
            清除步骤筛选
          </Button>
        )}
        <Button
          htmlType="button"
          className="task-execution-filter-toggle"
          aria-expanded={showFilters}
          aria-controls={`${id}-filters`}
          onClick={() => setFiltersOpen(!showFilters)}
        >
          {showFilters ? '收起查找与筛选' : '查找与筛选步骤'}
          {!!query || filter !== 'all' ? ' · 已有筛选条件' : ''}
        </Button>
      </div>
      <div id={`${id}-filters`} className="task-execution-filters" hidden={!showFilters}>
        <label htmlFor={`${id}-search`}>查找执行步骤</label>
        <Input
          ref={(instance) => {
            search.current = instance?.input ?? null;
          }}
          id={`${id}-search`}
          value={query}
          placeholder="步骤名称、编号或循环位置"
          onChange={(event) => update({ query: event.target.value, filter, scroll: 0 })}
        />
        <Segmented<Filter>
          className="task-execution-status-filter"
          aria-label="执行步骤状态"
          name={`${id}-status`}
          tabIndex={-1}
          value={filter}
          onChange={(value) => update({ query, filter: value, scroll: 0 })}
          options={(Object.keys(filters) as Filter[]).map((value) => ({
            value,
            label: `${filters[value]} · ${value === 'all' ? model.rows.length : model[value].length}`,
          }))}
        />
      </div>
      <p role="status" hidden={!showFilters && !query && filter === 'all'}>
        显示 {visible.length} / {model.rows.length}{' '}
        条。序号沿用完整清单；同一步骤的循环执行分别记录。
      </p>
    </>
  );
  return (
    <section aria-labelledby={`${id}-heading`}>
      <Card
        className={
          'task-run-card task-run-steps task-execution-steps' + (compact ? ' is-compact' : '')
        }
      >
        <h2 id={`${id}-heading`}>执行步骤</h2>
        {!compact && controls}
        <ol
          ref={list}
          aria-label="执行步骤清单"
          onScroll={(event) => update({ query, filter, scroll: event.currentTarget.scrollTop })}
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
                    <Button
                      htmlType="button"
                      className="task-execution-record-toggle"
                      aria-label={`步骤记录：${String(index + 1).padStart(2, '0')} · ${row.name}`}
                      aria-expanded={expanded === row.instance}
                      aria-controls={`${id}-record-${index}`}
                      onClick={() =>
                        change({
                          query,
                          filter,
                          scroll: list.current?.scrollTop ?? scroll,
                          expanded: expanded === row.instance ? undefined : row.instance,
                        })
                      }
                    >
                      <strong>{row.name}</strong>
                    </Button>
                    {compact && (
                      <Tag
                        className="run-state-tag"
                        variant="filled"
                        color={runStepColors[row.tone]}
                        icon={<Badge status={runStepColors[row.tone]} />}
                      >
                        {row.label}
                      </Tag>
                    )}
                  </div>
                  {summary && <p className="task-execution-summary">配置：{summary}</p>}
                  {!compact && (
                    <p>
                      <Tag
                        className="run-state-tag"
                        variant="filled"
                        color={runStepColors[row.tone]}
                        icon={<Badge status={runStepColors[row.tone]} />}
                      >
                        {row.label}
                      </Tag>
                    </p>
                  )}
                  {(!compact || row.instance !== row.nodeId) && (
                    <small>
                      {row.instance !== row.nodeId ? '循环/分支位置：' : '步骤编号：'}
                      {row.instance}
                    </small>
                  )}
                  <div id={`${id}-record-${index}`} hidden={expanded !== row.instance}>
                    {expanded === row.instance && (
                      <RunStepDetails
                        detail={detail}
                        compact
                        step={{
                          instance: row.instance,
                          nodeId: row.nodeId,
                          name: row.name,
                          type: row.type,
                          label: row.label,
                          kind: row.current
                            ? model.view.step.kind
                            : row.started
                              ? 'last'
                              : 'pending',
                        }}
                      />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        {compact && <div className="task-execution-tools">{controls}</div>}
        {!visible.length && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              model.rows.length
                ? '没有匹配的步骤。清除筛选可查看全部记录。'
                : '尚无已保存的执行步骤。'
            }
          />
        )}
        <p className="task-run-note">
          点击步骤名称查看该次记录与启动时配置。未选分支保持未执行；查看和筛选不会执行步骤或更改运行起点。
        </p>
      </Card>
    </section>
  );
}
