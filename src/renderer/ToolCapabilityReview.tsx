import { useMemo, useRef, useState } from 'react';
import type {
  ConnectionDiscovery,
  ConnectionConfig,
  ToolDefinition,
} from '../shared/tool-connections';
import './tool-capability-review.css';

type Snapshot = ConnectionDiscovery & { config: ConnectionConfig };
type Change = 'added' | 'changed' | 'removed' | 'unchanged';
const changeLabels: Record<Change, string> = {
  added: '新增',
  changed: '已变更',
  removed: '已移除',
  unchanged: '未变化',
};
// Presentation comparison only. Host revisions and candidate tokens remain authoritative.
const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const fields = [
  ['title', '显示名称'],
  ['description', '用途说明'],
  ['inputSchema', '输入参数'],
  ['outputSchema', '输出结构'],
  ['annotations', '读写与行为声明'],
] as const;
const hints = [
  ['readOnlyHint', '只读'],
  ['destructiveHint', '可能破坏数据'],
  ['idempotentHint', '重复调用结果不变'],
  ['openWorldHint', '与外部对象交互'],
] as const;
const valueText = (value: unknown) =>
  value === undefined
    ? '未提供'
    : typeof value === 'string'
      ? value || '空文本'
      : JSON.stringify(value, null, 2);

function Definition({ tool }: { tool: ToolDefinition }) {
  return (
    <>
      <p>{tool.description || '服务未提供说明，请向提供者核对用途。'}</p>
      <dl className="tool-capability-hints">
        {hints.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>
              {tool.annotations?.[key] === undefined
                ? '未声明'
                : tool.annotations[key]
                  ? '声明为是'
                  : '声明为否'}
            </dd>
          </div>
        ))}
      </dl>
      <details>
        <summary>查看完整参数与能力声明</summary>
        <pre>{JSON.stringify(tool, null, 2)}</pre>
      </details>
    </>
  );
}

export default function ToolCapabilityReview({
  current,
  baseline,
}: {
  current: Snapshot;
  baseline?: Snapshot;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | Change>('all');
  const [selected, setSelected] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const rows = useMemo(() => {
    const before = new Map(baseline?.tools.map((tool) => [tool.name, tool]));
    const after = new Map(current.tools.map((tool) => [tool.name, tool]));
    return [...new Set([...after.keys(), ...before.keys()])].map((name) => {
      const previous = before.get(name),
        next = after.get(name);
      const change: Change = !previous
        ? 'added'
        : !next
          ? 'removed'
          : same(previous, next)
            ? 'unchanged'
            : 'changed';
      return { name, previous, next, change, tool: next ?? previous! };
    });
  }, [current.tools, baseline?.tools]);
  const counts = Object.fromEntries(
    Object.keys(changeLabels).map((key) => [key, rows.filter((row) => row.change === key).length]),
  );
  const needle = query.trim().toLocaleLowerCase();
  const matches = rows.filter(
    (row) =>
      (filter === 'all' || row.change === filter) &&
      [
        row.name,
        row.previous?.title,
        row.previous?.description,
        row.next?.title,
        row.next?.description,
      ].some((text) => text?.toLocaleLowerCase().includes(needle)),
  );
  const chosen = matches.find((row) => row.name === selected) ?? matches[0];
  const identity = baseline
    ? [
        ['连接名称', baseline.config.displayName, current.config.displayName],
        ['来源说明', baseline.config.source, current.config.source],
        ['连接方式与地址', baseline.config.transport, current.config.transport],
        ['服务身份', baseline.server, current.server],
        ['请求协议', baseline.config.protocolVersion, current.config.protocolVersion],
        ['发现协议', baseline.protocolVersion, current.protocolVersion],
      ].filter(([, before, after]) => !same(before, after))
    : [];
  return (
    <section className="tool-capability-review" aria-label="工具能力核对">
      <div className="tool-capability-heading">
        <h2>{baseline ? '与已保存能力对照' : '工具清单'}</h2>
        <span>
          本次 {current.tools.length} 项{baseline ? ` · 原有 ${baseline.tools.length} 项` : ''}
        </span>
      </div>
      {baseline && (
        <>
          <p className="tool-disclaimer">
            对照本次检查开始前保存的定义。新增能力不会自动授权给任务，移除的工具不在本次清单中。
          </p>
          {!!identity.length && (
            <details className="tool-capability-identity" open>
              <summary>连接身份或来源变化 · {identity.length} 项</summary>
              {identity.map(([label, before, after]) => (
                <div className="tool-capability-field" key={String(label)}>
                  <h3>{String(label)}</h3>
                  <div className="tool-capability-comparison">
                    <div>
                      <h4>原来</h4>
                      <pre>{valueText(before)}</pre>
                    </div>
                    <div>
                      <h4>本次</h4>
                      <pre>{valueText(after)}</pre>
                    </div>
                  </div>
                </div>
              ))}
            </details>
          )}
          <div className="tool-capability-filters" role="group" aria-label="按能力变化筛选">
            {(['all', 'added', 'changed', 'removed', 'unchanged'] as const).map((key) => (
              <button
                key={key}
                aria-pressed={filter === key}
                onClick={() => {
                  setFilter(key);
                  setSelected('');
                }}
              >
                {key === 'all' ? `全部 ${rows.length}` : `${changeLabels[key]} ${counts[key]}`}
              </button>
            ))}
          </div>
          {!identity.length && !counts.added && !counts.changed && !counts.removed && (
            <p className="tool-disclaimer">
              连接身份与逐项工具定义未变化；仍需核对当前账号、工作区与使用范围。
            </p>
          )}
        </>
      )}
      {baseline && !current.tools.length && (
        <p className="tool-warning">
          本次未返回任何工具。下方仅用于核对原定义，保存连接也不会获得工具执行能力。
        </p>
      )}
      {!!rows.length && (
        <label className="tool-field">
          查找工具
          <input
            ref={search}
            type="search"
            value={query}
            placeholder="按工具名称或用途筛选"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      )}
      <p className="tool-capability-count" role="status">
        显示 {matches.length} / {rows.length} 项{baseline ? '（含已移除）' : ''}
      </p>
      {matches.length ? (
        <>
          <div className="tool-capability-list" role="group" aria-label="工具列表">
            {matches.map((row) => (
              <button
                key={row.name}
                aria-pressed={chosen?.name === row.name}
                onClick={() => setSelected(row.name)}
              >
                <span>
                  <strong>{row.tool.title || row.name}</strong>
                  <small>{row.name}</small>
                </span>
                {baseline && (
                  <span className={`tool-capability-change is-${row.change}`}>
                    {changeLabels[row.change]}
                  </span>
                )}
              </button>
            ))}
          </div>
          {chosen && (
            <article
              className="tool-definition tool-capability-detail"
              aria-label={`工具详情：${chosen.name}`}
              key={chosen.name}
            >
              <h3>{chosen.tool.title || chosen.name}</h3>
              <p className="tool-capability-name">{chosen.name}</p>
              {chosen.change === 'removed' && baseline && (
                <p className="tool-warning">本次发现已不包含该工具。以下为原保存定义。</p>
              )}
              <Definition tool={chosen.tool} />
              {chosen.change === 'changed' && chosen.previous && chosen.next && (
                <section aria-label="定义变化">
                  <h3>定义变化</h3>
                  {fields
                    .filter(([key]) => !same(chosen.previous?.[key], chosen.next?.[key]))
                    .map(([key, label]) => (
                      <details
                        className="tool-capability-field"
                        key={key}
                        open={key === 'annotations'}
                      >
                        <summary>{label}已变更</summary>
                        <div className="tool-capability-comparison">
                          <div>
                            <h4>原来</h4>
                            <pre>{valueText(chosen.previous?.[key])}</pre>
                          </div>
                          <div>
                            <h4>本次</h4>
                            <pre>{valueText(chosen.next?.[key])}</pre>
                          </div>
                        </div>
                      </details>
                    ))}
                </section>
              )}
            </article>
          )}
        </>
      ) : (
        <div className="tool-capability-empty">
          <p>
            {rows.length ? '没有符合当前筛选的工具。' : '该服务未返回工具，不能据此提供执行能力。'}
          </p>
          {!!rows.length && (
            <button
              onClick={() => {
                setQuery('');
                setFilter('all');
                setSelected('');
                search.current?.focus();
              }}
            >
              清除筛选
            </button>
          )}
        </div>
      )}
      <p className="tool-disclaimer">
        以上均为服务声明，不代表系统权限或本次任务授权。查看、搜索与对照不会调用工具。
      </p>
    </section>
  );
}
