import TechnicalDetails from './TechnicalDetails';
import { activateCollapseWithSpace } from './collapseKeyboard';
import { Card, Empty, Divider, Select, Button, Collapse, Descriptions } from 'antd';
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
          <Button
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={(event) => {
              toggleOrigin.current = event.currentTarget as HTMLButtonElement;
              setExpanded(!expanded);
            }}
          >
            {expanded ? `收起${label}` : `展开完整${label}`}
          </Button>
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
      <Divider />
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
            <b>{name ?? '步骤位置待核对'}</b>
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
      <Collapse
        size="small"
        activeKey={rawOpen ? ['raw'] : []}
        onChange={(keys) => setRawOpen(keys.includes('raw'))}
        destroyOnHidden
        items={[
          {
            key: 'raw',
            onKeyDown: activateCollapseWithSpace,
            label: '原始记录（高级诊断）',
            children: rawOpen ? (
              <LogText
                text={JSON.stringify(
                  { type: event.type, nodeInstance: event.nodeInstance, data: event.data },
                  null,
                  2,
                )}
                label="原始记录"
              />
            ) : null,
          },
        ]}
      />
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
            <Card className="run-log-context-card">
              <h3>来源与快照</h3>
              <Descriptions
                colon={false}
                size="small"
                layout="vertical"
                column={1}
                items={[
                  { key: 'run', label: '运行', children: run.name },
                  {
                    key: 'source',
                    label: '来源',
                    children: runSourceLabels[runSource(run)] ?? run.source,
                  },
                  { key: 'version', label: '执行方案', children: '按启动时保存的方案执行' },
                ]}
              />
              <TechnicalDetails
                items={[
                  { label: '运行 ID', value: run.id },
                  { label: '固定版本摘要', value: run.versionId },
                  { label: '来源运行 ID', value: run.rerun?.runId },
                ]}
              />
              {run.rerun && (
                <p>来源运行 · {run.rerun.mode === 'snapshot' ? '原快照' : '当前已保存版本'}</p>
              )}
            </Card>
          </section>
          <section aria-label="日志步骤实例">
            <Card className="run-log-context-card">
              <h3>步骤实例</h3>
              <label htmlFor={instanceId}>位置</label>
              <Select<string>
                id={instanceId}
                value={instance}
                title={
                  instance === '*'
                    ? '全部步骤与运行级记录'
                    : instance === ''
                      ? '仅运行级记录'
                      : (instanceTitle(instance) ?? '步骤位置待核对')
                }
                onChange={(value) => changeInstance(value)}
                options={[
                  { value: '*', label: '全部步骤与运行级记录' },
                  { value: '', label: '仅运行级记录' },
                  ...(instance && instance !== '*' && !instances.includes(instance)
                    ? [
                        {
                          value: instance,
                          label: <>原选择 · {instanceTitle(instance) ?? '步骤位置待核对'}</>,
                        },
                      ]
                    : []),
                  ...instances.map((value) => ({
                    value: value,
                    label:
                      instanceTitle(value) ?? `位置待核对 · 第 ${instances.indexOf(value) + 1} 处`,
                  })),
                ]}
              />
              {instance && instance !== '*' && (
                <p className="run-log-selected-instance">
                  {instanceTitle(instance) ?? '无法从固定快照确认此位置'}
                  <TechnicalDetails items={[{ label: '步骤实例路径', value: instance }]} />
                </p>
              )}
              <Descriptions
                colon={false}
                size="small"
                layout="vertical"
                column={1}
                items={[
                  { key: 'instances', label: '已记录实例', children: `${instances.length} 个` },
                  { key: 'matching', label: '当前范围', children: `${matching.length} 条记录` },
                ]}
              />
            </Card>
          </section>
          <section aria-label="脱敏日志阅读位置">
            <Card className="run-log-context-card">
              <h3>脱敏日志</h3>
              <Descriptions
                colon={false}
                size="small"
                layout="vertical"
                column={1}
                items={[
                  { key: 'saved', label: '已保存记录', children: `${records.length} 条` },
                  {
                    key: 'range',
                    label: '显示范围',
                    children: shown.length
                      ? `#${shown[0].sequence} — #${shown.at(-1)!.sequence}`
                      : '暂无记录',
                  },
                ]}
              />
              <Button disabled={!matching.length || undefined} onClick={showLatest}>
                查看最新记录
              </Button>
              <p>只显示已保存内容，不重新执行步骤。</p>
            </Card>
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
      <Card className="run-log-records">
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
                <Button onClick={() => updateReading({ ...reading, limit: limit + 100 })}>
                  显示{latest !== null ? '较早' : '后续'}{' '}
                  {Math.min(100, available.length - shown.length)} 条记录
                </Button>
              </div>
            )}
          </>
        ) : (
          <Empty
            className="run-log-empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <>
                <h4>{records.length ? '此范围尚无已保存记录' : '尚无已保存的运行事件'}</h4>
                <p>收到记录后会显示在这里；没有日志不代表执行成功。</p>
              </>
            }
          />
        )}
      </Card>
    </section>
  );
}
