import TechnicalDetails from './TechnicalDetails';
import { recordTime } from './readable-labels';
import { Alert, Badge, Button, Card, Empty, Tag, type AlertRef } from 'antd';
import { useEffect, useId, useRef, useState } from 'react';
import type { Bootstrap } from '../shared/types';
import { runStateLabels } from '../shared/run-history';
import { keepFocusedElementVisible } from './keepFocusedElementVisible';
import './storage-fault.css';

export default function StorageFaultNotice({
  data,
  refresh,
  openRun,
  openHistory,
  context,
}: {
  context: string;
  data: Bootstrap;
  refresh: () => Promise<void>;
  openRun: (detail: any) => void;
  openHistory: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const locked = useRef(false);
  const live = useRef(false);
  const actions = useRef({ openRun });
  actions.current = { openRun };
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const outcome = useRef<AlertRef>(null);
  const faultVisibility = useRef<(() => void) | undefined>(undefined);
  const currentContext = useRef({ value: context, revision: 0 });
  if (currentContext.current.value !== context)
    currentContext.current = { value: context, revision: currentContext.current.revision + 1 };
  useEffect(() => {
    setExpanded(false);
    setError('');
    setNotice('');
  }, [context]);
  useEffect(() => {
    const target = heading.current;
    if (!expanded || !target) {
      faultVisibility.current?.();
      faultVisibility.current = undefined;
      return;
    }
    target.focus({ preventScroll: true });
    return keepFocusedElementVisible(target);
  }, [expanded]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      faultVisibility.current?.();
    };
  }, []);
  useEffect(() => {
    if (!busy && expanded && (error || notice)) {
      const target = outcome.current?.nativeElement;
      if (target) {
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
        return keepFocusedElementVisible(target);
      }
    }
  }, [busy, expanded, error, notice]);
  const execution = data.execution;
  const owner = execution?.active;
  const records = [
    ...new Map(
      [data.runOverview.active, ...data.runs]
        .filter(
          (run) =>
            run &&
            (run.id === owner?.runId ||
              ['QUEUED', 'RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING'].includes(run.state)),
        )
        .map((run) => [run!.id, run!]),
    ).values(),
  ];
  const ordered = records.sort(
    (a, b) => Number(b.id === owner?.runId) - Number(a.id === owner?.runId),
  );
  const operate = async (key: string, work: () => Promise<void | string>) => {
    if (locked.current) return;
    const origin = currentContext.current.revision;
    locked.current = true;
    setBusy(key);
    setError('');
    setNotice('');
    try {
      const message = await work();
      if (live.current && origin === currentContext.current.revision && message) setNotice(message);
    } catch (reason) {
      if (live.current && origin === currentContext.current.revision)
        setError(reason instanceof Error ? reason.message : '未取得最新记录，请稍后重试');
    } finally {
      locked.current = false;
      if (live.current) setBusy('');
    }
  };
  const viewRun = (runId: string) =>
    void operate(runId, async () => {
      const origin = currentContext.current.revision;
      const detail = await window.flowark.request('run.detail', { id: runId });
      if (!live.current || origin !== currentContext.current.revision) return;
      if (detail?.run?.id !== runId)
        throw new Error('未取得对应运行记录，请保留当前信息并重新核对');
      actions.current.openRun(detail);
    });
  const time =
    execution && Number.isFinite(Date.parse(execution.observedAt))
      ? new Date(execution.observedAt).toLocaleString('zh-CN')
      : '观察时间未提供';
  return (
    <section aria-labelledby={`${id}-title`}>
      <Card className="storage-fault-notice">
        <div className="storage-fault-summary">
          <div role="alert">
            <Tag color="error" icon={<Badge status="error" />}>
              停止接收新任务
            </Tag>
            <h2 id={`${id}-title`}>运行记录未能完整保存</h2>
            <p>以下为最后成功保存的记录；当前执行和外部结果需要核对。重新打开不会自动重放操作。</p>
          </div>
          <div className="storage-fault-actions">
            <Button onClick={() => setExpanded(true)}>核对活动运行</Button>
            <Button
              ref={toggle}
              aria-expanded={expanded}
              aria-controls={`${id}-details`}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? '收起故障说明' : '查看故障说明'}
            </Button>
          </div>
        </div>
        {expanded && (
          <div id={`${id}-details`} className="storage-fault-details">
            <div className="storage-fault-columns">
              <section aria-labelledby={`${id}-observation`}>
                <Card className="storage-fault-detail-card">
                  <h3 ref={heading} tabIndex={-1} id={`${id}-observation`}>
                    当前活动与最后保存状态
                  </h3>
                  <p>
                    {!execution
                      ? '尚未取得当前活动状态，无法判断是否仍在执行。'
                      : owner
                        ? `应用仍在处理运行${owner.phase === 'closing' ? '，正在收尾' : ''}`
                        : '本次观察未发现活动运行；这不能证明历史未知资源已退出或外部操作未发生。'}
                  </p>
                  <p className="storage-fault-muted">{time} · 当前活动与已保存状态分别记录</p>
                  {owner && !records.some((run) => run.id === owner.runId) && (
                    <div className="storage-fault-run">
                      <strong>活动运行的保存记录暂不可用</strong>
                      <TechnicalDetails items={[{ label: '活动运行 ID', value: owner.runId }]} />
                      <Button disabled={!!busy || undefined} onClick={() => viewRun(owner.runId)}>
                        读取该运行记录
                      </Button>
                    </div>
                  )}
                  {ordered.length ? (
                    <ul className="storage-fault-runs">
                      {ordered.slice(0, 6).map((run) => (
                        <li key={run.id}>
                          <div>
                            <strong>{run.name}</strong>
                            <span>{recordTime(run.createdAt)}</span>
                            <span>
                              最后保存：{runStateLabels[run.state] ?? run.state}
                              {run.id === owner?.runId ? ' · 仍在处理' : ' · 当前执行未确认'}
                            </span>
                          </div>
                          <Button disabled={!!busy || undefined} onClick={() => viewRun(run.id)}>
                            {busy === run.id ? '读取中…' : '查看此运行'}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="当前返回的记录中没有待核对运行。请通过完整运行记录检查历史结果。"
                    />
                  )}
                  {ordered.length > 6 && <p>当前显示前 6 项，其余请在完整运行记录中核对。</p>}
                  <p className="storage-fault-muted">
                    最后保存的排队数量：{data.runOverview.queued}。此处的近期记录最多 200
                    条，不代表完整历史。
                  </p>
                  <Button disabled={!!busy || undefined} onClick={openHistory}>
                    查看完整运行记录
                  </Button>
                </Card>
              </section>
              <section aria-labelledby={`${id}-reason`}>
                <Card className="storage-fault-detail-card">
                  <h3 id={`${id}-reason`}>故障说明</h3>
                  <pre
                    tabIndex={0}
                    aria-label="返回的故障说明"
                    onFocus={(event) => {
                      faultVisibility.current?.();
                      faultVisibility.current = keepFocusedElementVisible(event.currentTarget);
                    }}
                    onBlur={() => {
                      faultVisibility.current?.();
                      faultVisibility.current = undefined;
                    }}
                  >
                    {data.fault}
                  </pre>
                  <h3>接下来如何核对</h3>
                  <ol>
                    <li>查看运行的最后保存步骤、输出和待办，再到原网页或应用核对实际结果。</li>
                    <li>结果未知时先人工确认，避免重复提交、写入或发送。</li>
                    <li>
                      处理本机存储问题后，完整退出并重开
                      FlowArk，再检查历史。刷新记录不会修复存储或恢复执行。
                    </li>
                  </ol>
                  <Button
                    disabled={!!busy || undefined}
                    onClick={() =>
                      void operate('refresh', async () => {
                        await refresh();
                        return '已重新读取记录；这不代表存储已恢复或外部结果已确认。';
                      })
                    }
                  >
                    {busy === 'refresh' ? '正在重新读取…' : '只读刷新记录'}
                  </Button>
                  <p className="storage-fault-muted">不会清理数据、重跑任务或更改原有授权。</p>
                </Card>
              </section>
            </div>
            {error && (
              <Alert type="error" showIcon role="alert" ref={outcome} description={error} />
            )}
            {notice && (
              <Alert type="info" showIcon role="status" ref={outcome} description={notice} />
            )}
            <Button
              onClick={() => {
                setExpanded(false);
                toggle.current?.focus();
              }}
            >
              收起，继续查看当前页面
            </Button>
          </div>
        )}
      </Card>
    </section>
  );
}
