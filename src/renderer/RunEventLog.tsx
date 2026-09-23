import { useMemo, useState } from 'react';
import type { Event, Flow } from '../shared/types';
import { flatten } from './flow-editing';
import { kinds } from './node-kinds';
import { runEventMessage, runEventTitle } from './run-event-presentation';
import './run-event-log.css';

function LogText({ text, label }: { text: string; label: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 1600;
  return (
    <div className="run-log-text">
      <pre>{long && !expanded ? text.slice(0, 1600) + '…' : text}</pre>
      {long && (
        <>
          <p>
            共 {text.length.toLocaleString('zh-CN')} 字符
            {expanded ? '，已展开已保存内容。' : '，当前显示前 1600 字符。'}
          </p>
          <button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? `收起${label}` : `展开完整${label}`}
          </button>
        </>
      )}
    </div>
  );
}

function EventItem({ event, name }: { event: Event; name?: string }) {
  const [rawOpen, setRawOpen] = useState(false);
  const title = runEventTitle(event);
  const output = event.data?.outputPreview;
  return (
    <li className="run-log-entry">
      <header>
        <time dateTime={event.time}>
          {Number.isFinite(Date.parse(event.time))
            ? new Date(event.time).toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })
            : '时间未记录'}
        </time>
        <strong>{title}</strong>
        <span>#{event.sequence}</span>
      </header>
      <p className="run-log-source">
        {event.nodeInstance ? (
          <>
            {name && <b>{name} · </b>}
            <code>{event.nodeInstance}</code>
          </>
        ) : (
          '运行级记录'
        )}
      </p>
      <LogText text={runEventMessage(event)} label="日志内容" />
      {typeof output === 'string' && (
        <section className="run-log-output" aria-label="已保存步骤输出">
          <h4>步骤输出预览</h4>
          <p>这是已保存的脱敏预览；宿主截断的内容无法在此恢复。</p>
          <LogText text={output} label="输出预览" />
        </section>
      )}
      <details onToggle={(event) => setRawOpen(event.currentTarget.open)}>
        <summary>原始记录 · {event.type}</summary>
        {rawOpen && (
          <LogText text={JSON.stringify(event.data, null, 2) ?? '未记录数据'} label="原始记录" />
        )}
      </details>
    </li>
  );
}

export default function RunEventLog({
  runId,
  events,
  snapshot,
}: {
  runId: string;
  events: Event[];
  snapshot?: Flow;
}) {
  const [limit, setLimit] = useState(100);
  const records = useMemo(
    () => events.filter((event) => event.runId === runId).sort((a, b) => a.sequence - b.sequence),
    [events, runId],
  );
  const names = useMemo(
    () =>
      new Map(
        flatten(snapshot?.steps ?? []).map((node) => [
          node.id,
          typeof node.name === 'string' && node.name
            ? node.name
            : kinds[node.type]?.label || node.id,
        ]),
      ),
    [snapshot],
  );
  const shown = records.slice(0, limit);
  return (
    <section className="run-event-log" aria-label="运行事件记录">
      <div className="run-log-heading">
        <h3>运行日志</h3>
        <span role="status">{records.length} 条已保存记录</span>
      </div>
      <p className="note">
        按记录顺序展示本次运行的事件、节点实例与脱敏内容。历史日志不代表当前执行状态。
      </p>
      {records.length ? (
        <>
          <ol>
            {shown.map((event) => (
              <EventItem
                key={event.sequence}
                event={event}
                name={names.get(event.nodeInstance.split('/').at(-1) ?? '')}
              />
            ))}
          </ol>
          {shown.length < records.length && (
            <div className="run-log-more">
              <p>
                已显示 {shown.length} / {records.length} 条
              </p>
              <button onClick={() => setLimit((value) => value + 100)}>
                显示后续 {Math.min(100, records.length - shown.length)} 条记录
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="run-log-empty">
          <h4>尚无已保存的运行事件</h4>
          <p>收到记录后会显示在这里；没有日志不代表执行成功。</p>
        </div>
      )}
    </section>
  );
}
