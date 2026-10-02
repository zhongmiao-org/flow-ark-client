import { useEffect, useId, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  historyTimeRange,
  runSource,
  runSourceLabels,
  runDisplayLabels as runStateLabels,
  type RunListPage,
  type RunListQuery,
} from '../shared/run-history';
import { formatRunDuration } from '../shared/run-presentation';
import type { FlowRecord } from '../shared/types';

const api = (method: string, args: any) => window.flowark.request(method, args);
export default function RunHistory({
  visible,
  open,
  filterOpen,
  setFilterOpen,
  setPage,
  flows,
  scope,
}: {
  visible: boolean;
  open: (detail: any) => void;
  filterOpen: boolean;
  setFilterOpen: (open: boolean) => void;
  setPage: (page: number) => void;
  flows: FlowRecord[];
  scope?: { id: string; name: string };
}) {
  const [query, setQuery] = useState<RunListQuery>(() => ({
    limit: 6,
    ...historyTimeRange(scope ? null : 7),
  }));
  const [range, setRange] = useState(scope ? 'all' : '7');
  const [draft, setDraft] = useState({
    query: '',
    state: '',
    source: '',
    flowId: '',
    range: '7',
    limit: 6,
  });
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<RunListPage | null>(null);
  const [error, setError] = useState('');
  const [openError, setOpenError] = useState<{ id: string; message: string } | null>(null);
  const errorPanel = useRef<HTMLParagraphElement>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const generation = useRef(0),
    shown = useRef(visible);
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const filterReturn = useRef<{
    trigger: 'flow' | 'source';
    scroll: number;
    applied: boolean;
  } | null>(null);
  const restore = useRef<{ id: string; scroll: number } | null>(null);
  const pageArrival = useRef(false);
  const pageSummaryId = useId();
  shown.current = visible;
  const cursor = cursors[cursors.length - 1];
  useEffect(() => setPage(cursors.length), [cursors.length, setPage]);
  const resetView = () => {
    setData(null);
    setLoading(true);
    setError('');
    setOpenError(null);
  };
  const latest = () => {
    pageArrival.current = true;
    resetView();
    setCursors([undefined]);
    setRevision((r) => r + 1);
  };
  const filter = (next: RunListQuery) => {
    resetView();
    setQuery(next);
    setCursors([undefined]);
  };
  const editFilters = (trigger: 'flow' | 'source') => {
    filterReturn.current = {
      trigger,
      scroll: root.current?.closest('main')?.scrollTop ?? 0,
      applied: false,
    };
    setDraft({
      query: query.query ?? '',
      state: query.state ?? '',
      source: query.source ?? '',
      flowId: scope?.id ?? query.flowId ?? '',
      range,
      limit: query.limit ?? 6,
    });
    setFilterOpen(true);
  };
  useEffect(() => {
    if (!visible) return;
    if (filterOpen) {
      root.current?.closest('main')?.scrollTo({ top: 0 });
      search.current?.focus({ preventScroll: true });
      return;
    }
    const saved = filterReturn.current;
    if (!saved) return;
    const target = !saved.applied
      ? (root.current?.querySelector<HTMLElement>(`[data-history-filter="${saved.trigger}"]`) ??
        heading.current)
      : heading.current;
    target?.focus({ preventScroll: true });
    root.current?.closest('main')?.scrollTo({ top: saved.applied ? 0 : saved.scroll });
    filterReturn.current = null;
  }, [visible, filterOpen]);
  useEffect(() => {
    const id = ++generation.current;
    if (!visible) return;
    let live = true,
      pending = false;
    setError('');
    setLoading(true);
    setOpening(null);
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await api('run.list', {
          ...query,
          ...(cursor ? { cursor } : {}),
          ...(scope ? { flowId: scope.id } : {}),
        });
        if (live) {
          setData(result);
          setError('');
        }
      } catch (e: any) {
        if (live) setError(e.message);
      } finally {
        pending = false;
        if (live) setLoading(false);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 2000);
    return () => {
      live = false;
      if (generation.current === id) generation.current++;
      clearInterval(timer);
    };
  }, [query, cursor, revision, visible, scope?.id]);
  useEffect(() => {
    if (!visible || filterOpen || loading || !data || !restore.current) return;
    const saved = restore.current;
    const frame = requestAnimationFrame(() => {
      const button = [
        ...(root.current?.querySelectorAll<HTMLButtonElement>('[data-run-id]') ?? []),
      ].find((e) => e.dataset.runId === saved.id);
      button?.focus({ preventScroll: true });
      root.current?.closest('main')?.scrollTo({ top: saved.scroll });
      restore.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, filterOpen, loading, data]);
  useEffect(() => {
    if (visible && !filterOpen && (error || openError)) errorPanel.current?.focus();
  }, [visible, filterOpen, error, openError]);
  useEffect(() => {
    if (!pageArrival.current || !visible || filterOpen || loading || error || !data) return;
    pageArrival.current = false;
    heading.current?.focus({ preventScroll: true });
    root.current?.closest('main')?.scrollTo({ top: 0 });
  }, [visible, filterOpen, loading, error, data]);
  const inspect = async (id: string) => {
    const current = generation.current;
    setOpening(id);
    setOpenError(null);
    try {
      const detail = await api('run.detail', { id });
      if (shown.current && current === generation.current) {
        if (!detail?.run) throw new Error('这条运行记录已不存在，请返回列表。');
        restore.current = { id, scroll: root.current?.closest('main')?.scrollTop ?? 0 };
        open(detail);
      }
    } catch (e: any) {
      if (shown.current && current === generation.current) setOpenError({ id, message: e.message });
    } finally {
      if (current === generation.current) setOpening(null);
    }
  };
  const stateSelect = (value: string, onChange: (state: string) => void) => (
    <select aria-label="运行状态筛选" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">全部状态</option>
      {Object.entries(runStateLabels).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
  const rangeSelect = (value: string, onChange: (days: string) => void) => (
    <select aria-label="运行时间范围" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="all">全部时间</option>
      <option value="1">今天</option>
      <option value="7">最近 7 天</option>
      <option value="30">最近 30 天</option>
    </select>
  );
  return (
    <div
      ref={root}
      className={`run-history${filterOpen ? ' is-filtering' : ''}`}
      style={visible ? undefined : { display: 'none' }}
    >
      <div className="runs-heading">
        <h1 ref={heading} tabIndex={-1} aria-describedby={filterOpen ? undefined : pageSummaryId}>
          {filterOpen ? '筛选运行记录' : '运行记录'}
        </h1>
        <p>
          {filterOpen
            ? '筛选与翻页保留当前位置；返回详情后保留条件。'
            : '每一次执行，都有清楚的过程与结果。'}
        </p>
      </div>
      {filterOpen ? (
        <form
          className="history-filter-panel"
          aria-label="筛选运行记录"
          onSubmit={(e) => {
            e.preventDefault();
            if (filterReturn.current) filterReturn.current.applied = true;
            setRange(draft.range);
            filter({
              limit: draft.limit,
              query: draft.query.trim() || undefined,
              state: (draft.state || undefined) as RunListQuery['state'],
              source: (draft.source || undefined) as RunListQuery['source'],
              flowId: draft.flowId || undefined,
              ...historyTimeRange(draft.range === 'all' ? null : Number(draft.range)),
            });
            setFilterOpen(false);
          }}
        >
          <div className="history-primary-filters">
            <label>
              搜索流程或运行编号
              <input
                ref={search}
                aria-label="搜索运行记录"
                maxLength={200}
                placeholder="流程名称、运行或流程 ID"
                value={draft.query}
                onChange={(e) => setDraft({ ...draft, query: e.target.value })}
              />
            </label>
            <label>状态{stateSelect(draft.state, (state) => setDraft({ ...draft, state }))}</label>
            <label>
              触发来源
              <select
                aria-label="运行来源筛选"
                value={draft.source}
                onChange={(e) => setDraft({ ...draft, source: e.target.value })}
              >
                <option value="">全部来源</option>
                {Object.entries(runSourceLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              时间范围{rangeSelect(draft.range, (range) => setDraft({ ...draft, range }))}
            </label>
          </div>
          <div className="history-filter-actions">
            <button className="primary" type="submit">
              应用筛选
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft({
                  query: '',
                  state: '',
                  source: '',
                  flowId: scope?.id ?? '',
                  range: 'all',
                  limit: 6,
                });
              }}
            >
              清空条件
            </button>
            <button type="button" onClick={() => setFilterOpen(false)}>
              取消
            </button>
          </div>
          <details
            className="history-extra-filters"
            open={!!draft.flowId || draft.limit !== 6 || undefined}
          >
            <summary>更多条件 · 流程与每页条数</summary>
            <div>
              {' '}
              <label>
                流程
                <select
                  aria-label="运行流程筛选"
                  disabled={!!scope}
                  value={draft.flowId}
                  onChange={(e) => setDraft({ ...draft, flowId: e.target.value })}
                >
                  <option value="">所有流程</option>
                  {flows.map((flow) => (
                    <option key={flow.id} value={flow.id}>
                      {flow.flow.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                每页
                <select
                  aria-label="每页运行条数"
                  value={draft.limit}
                  onChange={(e) => setDraft({ ...draft, limit: Number(e.target.value) })}
                >
                  {[6, 25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n} 条
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
        </form>
      ) : (
        <>
          <div className="history-filters">
            {stateSelect(query.state ?? '', (state) =>
              filter({ ...query, state: (state || undefined) as RunListQuery['state'] }),
            )}
            {rangeSelect(range, (days) => {
              setRange(days);
              filter({ ...query, ...historyTimeRange(days === 'all' ? null : Number(days)) });
            })}
            <button data-history-filter="flow" onClick={() => editFilters('flow')}>
              {scope
                ? '筛选当前流程'
                : query.query || query.flowId || query.source
                  ? '已设置筛选'
                  : '所有流程'}
            </button>
            <span aria-live="polite">
              {data
                ? `共 ${data.matchedCount} 条记录`
                : loading
                  ? '正在读取运行记录…'
                  : '运行记录暂不可用'}
            </span>
          </div>
          {(error || openError) && (
            <p ref={errorPanel} tabIndex={-1} className="field-error history-error" role="alert">
              <span>{error || openError?.message}</span>
              {error ? (
                <button onClick={() => setRevision((value) => value + 1)}>重试读取</button>
              ) : (
                <button
                  disabled={!!opening}
                  onClick={() => openError && void inspect(openError.id)}
                >
                  重试打开详情
                </button>
              )}
            </p>
          )}
          {query.source && (
            <p className="history-applied-source">触发来源：{runSourceLabels[query.source]}</p>
          )}
          <div className="table-wrap" aria-busy={loading}>
            <table aria-label="运行记录">
              <colgroup>
                <col className="history-flow-col" />
                <col className="history-state-col" />
                <col className="history-source-col" />
                <col className="history-time-col" />
                <col className="history-duration-col" />
                <col className="history-open-col" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">流程 / 运行编号</th>
                  <th scope="col">状态</th>
                  <th scope="col">触发方式</th>
                  <th scope="col">开始时间</th>
                  <th scope="col">耗时</th>
                  <th scope="col">
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data?.runs.map((r) => {
                  const elapsed = data.elapsed[r.id];
                  return (
                    <tr key={r.id} aria-label={`${r.name} · ${r.id}`}>
                      <td>
                        <b>{r.name}</b>
                        <small className="history-run-id" title={r.id}>
                          {r.id}
                        </small>
                        {scope && (
                          <small className="history-version" title={r.versionId}>
                            运行版本 {r.versionId.slice(0, 12)}
                          </small>
                        )}
                      </td>
                      <td>
                        <span className={'badge state-' + r.state}>{runStateLabels[r.state]}</span>
                      </td>
                      <td>{runSourceLabels[runSource(r)] ?? r.source}</td>
                      <td>
                        <RunStartTime value={elapsed?.startedAt} queued={r.state === 'QUEUED'} />
                      </td>
                      <td>
                        {elapsed?.milliseconds == null ? (
                          '待核对'
                        ) : (
                          <>
                            <span title={formatRunDuration(elapsed.milliseconds)}>
                              {compactDuration(elapsed.milliseconds)}
                            </span>
                            {elapsed.kind === 'recorded' && <small>已记录</small>}
                          </>
                        )}
                      </td>
                      <td>
                        <button
                          className="history-open"
                          aria-label={`查看 ${r.name} · ${r.id}`}
                          title={`查看 ${r.name} · ${r.id}`}
                          data-run-id={r.id}
                          disabled={!!opening}
                          onClick={() => void inspect(r.id)}
                        >
                          {opening === r.id ? '…' : <ChevronRight size={18} />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!data && (
              <p className="history-empty" role="status">
                {loading ? '正在读取运行记录…' : '运行记录暂不可用，请重试读取。'}
              </p>
            )}
            {data && !data.runs.length && (
              <p className="history-empty">
                {cursors.length > 1
                  ? '当前页已没有记录，请返回上一页或查看最新。'
                  : data.totalCount
                    ? '没有符合筛选条件的运行记录。'
                    : '还没有运行记录。运行一个流程后，可在这里查看。'}
              </p>
            )}
          </div>
          <div className="history-pagination">
            <span id={pageSummaryId} aria-live="polite">
              {data
                ? `显示 ${data.runs.length ? (cursors.length - 1) * (query.limit ?? 6) + 1 : 0}–${data.runs.length ? (cursors.length - 1) * (query.limit ?? 6) + data.runs.length : 0} 条，共 ${data.matchedCount} 条`
                : loading
                  ? '读取中…'
                  : '读取失败'}{' '}
              · <span>第 {cursors.length} 页</span>
            </span>
            <div className="history-page-actions">
              <button
                disabled={loading || cursors.length < 2}
                onClick={() => {
                  pageArrival.current = true;
                  resetView();
                  setCursors((c) => c.slice(0, -1));
                }}
              >
                上一页
              </button>
              <button
                disabled={loading || !!error || !data?.nextCursor}
                onClick={() => {
                  if (data?.nextCursor) {
                    pageArrival.current = true;
                    resetView();
                    setCursors((c) => [...c, data.nextCursor!]);
                  }
                }}
              >
                下一页
              </button>
              <button data-history-filter="source" onClick={() => editFilters('source')}>
                触发来源筛选
              </button>
              <button className="history-refresh" onClick={latest}>
                查看最新
              </button>
            </div>
            {!!data?.newerCount && <small>新增 {data.newerCount} 条记录，可查看最新</small>}
          </div>
        </>
      )}
    </div>
  );
}

function compactDuration(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return formatRunDuration(milliseconds);
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const pad = (value: number) => String(value).padStart(2, '0');
  return minutes < 60
    ? `${pad(minutes)}:${pad(seconds % 60)}`
    : `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:${pad(seconds % 60)}`;
}

function RunStartTime({ value, queued }: { value?: string | null; queued: boolean }) {
  if (!value) return queued ? '尚未开始' : '待核对';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '待核对';
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const day =
    date.toDateString() === now.toDateString()
      ? '今天'
      : date.toDateString() === yesterday.toDateString()
        ? '昨天'
        : date.toLocaleDateString('zh-CN', {
            ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
            month: '2-digit',
            day: '2-digit',
          });
  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString('zh-CN')}>
      {day}{' '}
      {date.toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}
    </time>
  );
}
