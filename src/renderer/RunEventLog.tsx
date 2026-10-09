import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from 'react';
import type { Event, Flow, Run } from '../shared/types';
import { runInstancePresenter } from './run-instance-presentation';
import { runEventMessage, runEventTitle } from './run-event-presentation';
import { runSource, runSourceLabels } from '../shared/run-history';
import './run-event-log.css';

export type RunLogPosition = { instance: string; limit: number; latest: number | null };

function LogText({ text, label }: { text: string; label: string }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const content = useRef<HTMLPreElement>(null);
  const toggleOrigin = useRef<HTMLButtonElement | null>(null);
  const long = text.length > 1600;
  useLayoutEffect(() => {
    const origin = toggleOrigin.current;
    toggleOrigin.current = null;
    if (!origin || !content.current) return;
    content.current.scrollTo(0, 0);
    if (document.activeElement === origin) {
      content.current.focus({ preventScroll: true });
      content.current.scrollIntoView({ block: 'nearest' });
    }
  }, [expanded]);
  return (
    <div className="run-log-text">
      <pre id={contentId} ref={content} tabIndex={0} aria-label={label}>
        {long && !expanded ? text.slice(0, 1600) + '…' : text}
      </pre>
      {long && (
        <>
          <p>
            共 {text.length.toLocaleString('zh-CN')} 字符
            {expanded ? '，已展开已保存内容。' : '，当前显示前 1600 字符。'}
          </p>
          <button
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={(event) => {
              toggleOrigin.current = event.currentTarget;
              setExpanded(!expanded);
            }}
          >
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
  run,
  position,
  summary,
}: {
  runId: string;
  events: Event[];
  snapshot?: Flow;
  run?: Run;
  position?: RefObject<RunLogPosition>;
  summary?: ReactNode;
}) {
  const [reading, setReading] = useState<RunLogPosition>(
    () => position?.current ?? { instance: '*', limit: 100, latest: null },
  );
  const { instance, limit, latest } = reading;
  const updateReading = (next: RunLogPosition) => {
    if (position) position.current = next;
    setReading(next);
  };
  const instanceId = useId();
  const readingHeading = useRef<HTMLHeadingElement>(null);
  const records = useMemo(
    () => events.filter((event) => event.runId === runId).sort((a, b) => a.sequence - b.sequence),
    [events, runId],
  );
  const instanceTitle = useMemo(() => runInstancePresenter(snapshot), [snapshot]);
  const instances = [...new Set(records.map((event) => event.nodeInstance).filter(Boolean))];
  const matching =
    instance === '*' ? records : records.filter((event) => event.nodeInstance === instance);
  const available =
    latest === null ? matching : matching.filter((event) => event.sequence <= latest);
  const shown = latest === null ? available.slice(0, limit) : available.slice(-limit);
  const newCount = matching.length - available.length;
  const changeInstance = (value: string) => {
    updateReading({ instance: value, limit: 100, latest: null });
  };
  const showLatest = () => {
    updateReading({ instance, limit: 100, latest: matching.at(-1)?.sequence ?? null });
    readingHeading.current?.focus();
  };
  return (
    <section className="run-event-log" aria-label="运行事件记录">
      {run && (
        <div className="run-log-context">
          <section aria-label="日志来源与快照">
            <h3>来源与快照</h3>
            <dl>
              <div>
                <dt>Run</dt>
                <dd>{run.id}</dd>
              </div>
              <div>
                <dt>来源</dt>
                <dd>{runSourceLabels[runSource(run)] ?? run.source}</dd>
              </div>
              <div>
                <dt>启动时固定版本</dt>
                <dd>{run.versionId}</dd>
              </div>
            </dl>
            {run.rerun && (
              <p>
                原运行：{run.rerun.runId} ·{' '}
                {run.rerun.mode === 'snapshot' ? '原快照' : '当前已保存版本'}
              </p>
            )}
          </section>
          <section aria-label="日志步骤实例">
            <h3>步骤实例</h3>
            <label htmlFor={instanceId}>位置</label>
            <select
              id={instanceId}
              value={instance}
              title={
                instance === '*'
                  ? '全部步骤与运行级记录'
                  : instance === ''
                    ? '仅运行级记录'
                    : (instanceTitle(instance) ?? instance)
              }
              onChange={(event) => changeInstance(event.target.value)}
            >
              <option value="*">全部步骤与运行级记录</option>
              <option value="">仅运行级记录</option>
              {instance && instance !== '*' && !instances.includes(instance) && (
                <option value={instance}>原选择 · {instanceTitle(instance) ?? instance}</option>
              )}
              {instances.map((value) => (
                <option key={value} value={value}>
                  {instanceTitle(value) ?? value}
                </option>
              ))}
            </select>
            {instance && instance !== '*' && (
              <p className="run-log-selected-instance">
                {instanceTitle(instance) ?? '无法从固定快照确认此位置'}
                <code>{instance}</code>
              </p>
            )}
            <dl>
              <div>
                <dt>已记录实例</dt>
                <dd>{instances.length} 个</dd>
              </div>
              <div>
                <dt>当前范围</dt>
                <dd>{matching.length} 条记录</dd>
              </div>
            </dl>
          </section>
          <section aria-label="脱敏日志阅读位置">
            <h3>脱敏日志</h3>
            <dl>
              <div>
                <dt>已保存记录</dt>
                <dd>{records.length} 条</dd>
              </div>
              <div>
                <dt>显示范围</dt>
                <dd>
                  {shown.length ? `#${shown[0].sequence} — #${shown.at(-1)!.sequence}` : '暂无记录'}
                </dd>
              </div>
            </dl>
            <button disabled={!matching.length} onClick={showLatest}>
              查看最新记录
            </button>
            <p>只显示已保存内容，不重新执行步骤。</p>
          </section>
          {summary}
        </div>
      )}
      <div className="run-log-heading">
        <h3 ref={readingHeading} tabIndex={-1}>
          运行日志
        </h3>
        <span role="status">
          {matching.length} 条已保存记录{latest !== null ? ' · 最近记录' : ''}
          {newCount > 0 && ` · 另有 ${newCount} 条新记录`}
        </span>
      </div>
      <p className="note">
        按记录顺序展示本次运行的事件、节点实例与脱敏内容。历史日志不代表当前执行状态。
      </p>
      {matching.length ? (
        <>
          <ol>
            {shown.map((event) => (
              <EventItem
                key={event.sequence}
                event={event}
                name={instanceTitle(event.nodeInstance) ?? undefined}
              />
            ))}
          </ol>
          {shown.length < available.length && (
            <div className="run-log-more">
              <p>
                已显示 {shown.length} / {available.length} 条
              </p>
              <button onClick={() => updateReading({ ...reading, limit: limit + 100 })}>
                显示{latest !== null ? '较早' : '后续'}{' '}
                {Math.min(100, available.length - shown.length)} 条记录
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="run-log-empty">
          <h4>{records.length ? '此范围尚无已保存记录' : '尚无已保存的运行事件'}</h4>
          <p>收到记录后会显示在这里；没有日志不代表执行成功。</p>
        </div>
      )}
    </section>
  );
}
