import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { runStateLabels, type RunListPage, type RunListQuery } from '../shared/run-history';

const api = (method: string, args: any) => window.flowark.request(method, args);
export default function RunHistory({
  visible,
  open,
}: {
  visible: boolean;
  open: (detail: any) => void;
}) {
  const [query, setQuery] = useState<RunListQuery>({ limit: 50 });
  const [search, setSearch] = useState('');
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<RunListPage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const generation = useRef(0),
    shown = useRef(visible);
  shown.current = visible;
  const cursor = cursors[cursors.length - 1];
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
  useEffect(() => {
    const id = ++generation.current;
    if (!visible) return;
    let live = true,
      pending = false;
    setData(null);
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
  const inspect = async (id: string) => {
    const current = generation.current;
    setOpening(id);
    setError('');
    try {
      const detail = await api('run.detail', { id });
      if (shown.current && current === generation.current) open(detail);
    } catch (e: any) {
      if (shown.current && current === generation.current) setError(e.message);
    } finally {
      if (current === generation.current) setOpening(null);
    }
  };
  return (
    <div className="run-history" style={visible ? undefined : { display: 'none' }}>
      <form
        className="history-filters"
        onSubmit={(e) => {
          e.preventDefault();
          filter({ ...query, query: search.trim() });
        }}
      >
        <label className="history-search">
          搜索记录
          <input
            aria-label="搜索运行记录"
            maxLength={200}
            placeholder="流程名称、运行或流程 ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button type="submit">查询</button>
        <label>
          状态
          <select
            aria-label="运行状态筛选"
            value={query.state ?? ''}
            onChange={(e) =>
              filter({ ...query, state: (e.target.value || undefined) as RunListQuery['state'] })
            }
          >
            <option value="">全部状态</option>
            {Object.entries(runStateLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          来源
          <select
            aria-label="运行来源筛选"
            value={query.source ?? ''}
            onChange={(e) =>
              filter({ ...query, source: (e.target.value || undefined) as RunListQuery['source'] })
            }
          >
            <option value="">全部来源</option>
            <option value="manual">手动</option>
            <option value="schedule">本机计划</option>
          </select>
        </label>
        <label>
          每页
          <select
            aria-label="每页运行条数"
            value={query.limit}
            onChange={(e) => filter({ ...query, limit: Number(e.target.value) })}
          >
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n} 条
              </option>
            ))}
          </select>
        </label>
      </form>
      <div className="history-pagination">
        <span aria-live="polite">
          {data
            ? `全部 ${data.totalCount} 次运行 · 本页 ${data.runs.length} 条`
            : loading
              ? '正在读取运行记录…'
              : '运行记录暂不可用'}
        </span>
        <button onClick={latest}>查看最新</button>
        {!!data?.newerCount && <small>新增 {data.newerCount} 条记录，可查看最新</small>}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="table-wrap" aria-busy={loading}>
        <table>
          <thead>
            <tr>
              <th>流程</th>
              <th>状态</th>
              <th>触发方式</th>
              <th>开始时间</th>
              <th>版本快照</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.runs.map((r) => (
              <tr key={r.id}>
                <td>
                  <b>{r.name}</b>
                  <small title={r.id}>{r.id.slice(0, 8)}</small>
                </td>
                <td>
                  <span className={'badge state-' + r.state}>{runStateLabels[r.state]}</span>
                </td>
                <td>{r.rerun ? '手动 · 重新运行' : r.source === 'manual' ? '手动' : '本机计划'}</td>
                <td>{new Date(r.createdAt).toLocaleString('zh-CN')}</td>
                <td>
                  <code>{r.versionId.slice(0, 10)}</code>
                </td>
                <td>
                  <button disabled={!!opening} onClick={() => void inspect(r.id)}>
                    {opening === r.id ? '读取中…' : '查看'} <ChevronRight size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.runs.length && (
          <p className="history-empty">
            {data.totalCount
              ? '没有符合筛选条件的运行记录。'
              : '还没有运行记录。试着运行「第一个流程」。'}
          </p>
        )}
      </div>
      <div className="history-pagination">
        <button
          disabled={loading || cursors.length < 2}
          onClick={() => {
            resetView();
            setCursors((c) => c.slice(0, -1));
          }}
        >
          上一页
        </button>
        <span>第 {cursors.length} 页</span>
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
      </div>
    </div>
  );
}
