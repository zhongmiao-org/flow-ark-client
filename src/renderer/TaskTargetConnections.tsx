import { useEffect, useState } from 'react';
import type { ToolConnection } from '../shared/tool-connections';

const statusLabel: Record<ToolConnection['status'], string> = {
  verified: '连接已核对',
  unverified: '需要重新核对',
  disconnected: '已断开',
  failed: '需要重新连接',
};

export default function TaskTargetConnections({
  active,
  manage,
}: {
  active: boolean;
  manage: () => void;
}) {
  const [records, setRecords] = useState<ToolConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!active) return;
    let live = true;
    setLoading(true);
    setError('');
    void window.flowark.request('tool.connection.list', {}).then(
      (next: ToolConnection[]) => {
        if (!live) return;
        setRecords(next);
        setLoading(false);
      },
      (reason: unknown) => {
        if (!live) return;
        setError(
          (reason instanceof Error ? reason.message : '暂时无法读取连接，请重试').replace(
            /^Error invoking remote method 'flowark:request': (?:Error: )?/,
            '',
          ),
        );
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [active, refresh]);
  const visible = records.filter((record) =>
    `${record.config.displayName} ${record.config.source}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const selected = visible.find((record) => record.id === selectedId);
  return (
    <div className="task-target-connections" aria-busy={loading}>
      <div className="task-target-section-heading">
        <h2>已连接工具</h2>
        <button disabled={loading} onClick={() => setRefresh((value) => value + 1)}>
          {loading ? '读取中…' : '刷新连接'}
        </button>
      </div>
      <p className="ai-task-note">查看已有连接与可用能力，任务描述和已选资料会为你保留。</p>
      {error ? (
        <div className="task-web-object" role="alert">
          <h3>连接列表未能加载</h3>
          <p>{error}</p>
          <button onClick={() => setRefresh((value) => value + 1)}>重新加载</button>
        </div>
      ) : loading && !records.length ? (
        <p className="ai-task-note" role="status">
          正在读取你的连接…
        </p>
      ) : !records.length ? (
        <div className="task-target-empty">
          <h3>还没有连接工具</h3>
          <p>连接后可以在这里查看工具提供的能力和当前状态。</p>
          <button className="primary" onClick={manage}>
            连接其他应用
          </button>
        </div>
      ) : (
        <>
          <label className="task-target-search">
            查找连接
            <input
              type="search"
              value={query}
              placeholder="搜索名称或来源"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="task-target-connection-list" aria-label="已有连接">
            {visible.map((record) => (
              <button
                key={record.id}
                className="task-target-connection"
                aria-pressed={selectedId === record.id}
                onClick={() => setSelectedId(record.id)}
              >
                <strong>{record.config.displayName}</strong>
                <span>{record.config.source}</span>
                <span className={`task-target-status is-${record.status}`}>
                  {statusLabel[record.status]} · {record.tools.length} 项能力
                </span>
              </button>
            ))}
            {!visible.length && (
              <div className="task-target-empty">
                <h3>没有找到匹配的连接</h3>
                <p>试试其他名称，或清除搜索查看全部连接。</p>
                <button onClick={() => setQuery('')}>清除搜索</button>
              </div>
            )}
          </div>
          {selected && (
            <section className="task-web-object task-target-capabilities" aria-label="连接能力">
              <h3>{selected.config.displayName}</h3>
              <p>
                {statusLabel[selected.status]} · 上次核对{' '}
                {new Date(selected.testedAt).toLocaleString('zh-CN')}
              </p>
              {selected.tools.length ? (
                <ul>
                  {selected.tools.map((tool) => (
                    <li key={tool.name}>
                      <strong>{tool.title || tool.name}</strong>
                      <p>{tool.description || '此工具尚未提供用途说明'}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>这个连接暂未提供可用工具。</p>
              )}
              <p className="ai-task-note">
                可以查看和管理此连接；当前版本尚不能将它绑定到本次任务。
              </p>
              <button onClick={manage}>
                {selected.status === 'verified' ? '管理连接与能力' : '前往重新连接'}
              </button>
            </section>
          )}
        </>
      )}
      {!!records.length && <button onClick={manage}>连接其他应用</button>}
    </div>
  );
}
