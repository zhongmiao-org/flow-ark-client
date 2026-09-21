import { useEffect, useRef, useState } from 'react';
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
}: {
  visible: boolean;
  open: (detail: any) => void;
  filterOpen: boolean;
  setFilterOpen: (open: boolean) => void;
  setPage: (page: number) => void;
  flows: FlowRecord[];
}) {
  const [query, setQuery] = useState<RunListQuery>(() => ({ limit: 6, ...historyTimeRange(7) }));
  const [range, setRange] = useState('7');
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
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const generation = useRef(0),
    shown = useRef(visible);
  const root = useRef<HTMLDivElement>(null);
  const restore = useRef<{ id: string; scroll: number } | null>(null);
  shown.current = visible;
  const cursor = cursors[cursors.length - 1];
  useEffect(() => setPage(cursors.length), [cursors.length, setPage]);
  const resetView = () => {
    setData(null);
    setLoading(true);
    setError('');
  };
  const latest = () => {
    resetView();
    setCursors([undefined]);
    setRevision((r) => r + 1);
  };
  const filter = (next: RunListQuery) => {
    resetView();
    setQuery(next);
    setCursors([undefined]);
  };
  const editFilters = () => {
    setDraft({
      query: query.query ?? '',
      state: query.state ?? '',
      source: query.source ?? '',
      flowId: query.flowId ?? '',
      range,
      limit: query.limit ?? 6,
    });
    setFilterOpen(true);
  };
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
        const result = await api('run.list', { ...query, ...(cursor ? { cursor } : {}) });
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
  }, [query, cursor, revision, visible]);
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
  const inspect = async (id: string) => {
    const current = generation.current;
    setOpening(id);
    setError('');
    try {
      const detail = await api('run.detail', { id });
      if (shown.current && current === generation.current) {
        if (!detail?.run) throw new Error('这条运行记录已不存在，请返回列表。');
        restore.current = { id, scroll: root.current?.closest('main')?.scrollTop ?? 0 };
        open(detail);
      }
    } catch (e: any) {
      if (shown.current && current === generation.current) setError(e.message);
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
    <div ref={root} className="run-history" style={visible ? undefined : { display: 'none' }}>
      <div className="runs-heading">
        <h1>{filterOpen ? '筛选运行记录' : '运行记录'}</h1>
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
          <label>
            搜索流程或运行编号
            <input
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
          <label>
            流程
            <select
              aria-label="运行流程筛选"
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
          <div className="history-filter-actions">
            <button className="primary" type="submit">
              应用筛选
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft({ query: '', state: '', source: '', flowId: '', range: 'all', limit: 6 });
              }}
            >
              清空条件
            </button>
            <button type="button" onClick={() => setFilterOpen(false)}>
              取消
            </button>
          </div>
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
            <button onClick={editFilters}>
              {query.query || query.flowId ? '已筛选流程' : '所有流程'}
            </button>
            <span aria-live="polite">
              {data
                ? `共 ${data.matchedCount} 条记录`
                : loading
                  ? '正在读取运行记录…'
                  : '运行记录暂不可用'}
            </span>
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
              <button onClick={latest}>查看最新</button>
            </p>
          )}
          <div className="table-wrap" aria-busy={loading}>
            <table>
              <colgroup>
                <col className="history-flow-col" />
                <col />
                <col />
                <col className="history-time-col" />
                <col />
                <col className="history-open-col" />
              </colgroup>
              <thead>
                <tr>
                  <th>流程 / 运行编号</th>
                  <th>状态</th>
                  <th>触发方式</th>
                  <th>开始时间</th>
                  <th>耗时</th>
                  <th>
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data?.runs.map((r) => {
                  const elapsed = data.elapsed[r.id];
                  return (
                    <tr key={r.id}>
                      <td>
                        <b>{r.name}</b>
                        <small title={r.id}>{r.id.slice(0, 8)}</small>
                      </td>
                      <td>
                        <span className={'badge state-' + r.state}>{runStateLabels[r.state]}</span>
                      </td>
                      <td>{runSourceLabels[runSource(r)] ?? r.source}</td>
                      <td>
                        {elapsed?.startedAt
                          ? new Date(elapsed.startedAt).toLocaleString('zh-CN', {
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })
                          : r.state === 'QUEUED'
                            ? '尚未开始'
                            : '待核对'}
                      </td>
                      <td>
                        {elapsed?.milliseconds == null ? (
                          '待核对'
                        ) : (
                          <>
                            <span>{formatRunDuration(elapsed.milliseconds)}</span>
                            {elapsed.kind === 'recorded' && <small>已记录</small>}
                          </>
                        )}
                      </td>
                      <td>
                        <button
                          className="history-open"
                          aria-label="查看"
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
            {data && !data.runs.length && (
              <p className="history-empty">
                {data.totalCount
                  ? '没有符合筛选条件的运行记录。'
                  : '还没有运行记录。运行一个流程后，可在这里查看。'}
              </p>
            )}
          </div>
          <div className="history-pagination">
            <span aria-live="polite">
              {data
                ? `显示 ${data.runs.length ? (cursors.length - 1) * (query.limit ?? 6) + 1 : 0}–${data.runs.length ? (cursors.length - 1) * (query.limit ?? 6) + data.runs.length : 0} 条，共 ${data.matchedCount} 条`
                : '读取中…'}{' '}
              · <span>第 {cursors.length} 页</span>
            </span>
            <div className="history-page-actions">
              <button
                disabled={loading || cursors.length < 2}
                onClick={() => {
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
                    resetView();
                    setCursors((c) => [...c, data.nextCursor!]);
                  }
                }}
              >
                下一页
              </button>
              <button onClick={editFilters}>触发来源筛选</button>
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
