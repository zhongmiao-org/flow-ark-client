import McpRunReceipts from './McpRunReceipts';
import DebugRunWorkspace from './DebugRunWorkspace';
import { useEffect, useRef, useState } from 'react';
import type { Event, Run } from '../shared/types';
import { formatRunDuration, presentRun } from '../shared/run-presentation';
import {
  runSource,
  runSourceLabels,
  runDisplayLabels as runStateLabels,
} from '../shared/run-history';
import { RunObservation } from './RunObservation';
import RunRerunPanel from './RunRerunPanel';
import RunOutputWorkspace from './RunOutputWorkspace';
import { runTimeline } from './run-timeline';
import { kinds } from './node-kinds';
import RunEventLog from './RunEventLog';
import DesktopRunReceipt from './DesktopRunReceipt';

export type RunTab = 'current' | 'output' | 'logs' | 'rerun';
const tabs: [RunTab, string][] = [
  ['current', '当前步骤'],
  ['output', '输出与产物'],
  ['logs', '运行日志'],
];
const time = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
export default function RunDetail({
  detail: d,
  fault,
  control,
  reveal,
  reload,
  open,
  tab,
  setTab,
  showBrowser,
  cancelRerun,
  rerunBusy,
}: {
  detail: any;
  fault?: string;
  control: (id: string, action: string) => Promise<boolean>;
  reveal: (id: string) => Promise<unknown>;
  reload: () => Promise<void>;
  open: (detail: any) => void;
  tab: RunTab;
  setTab: (tab: RunTab) => void;
  showBrowser: () => void;
  cancelRerun: () => void;
  rerunBusy: (busy: boolean) => void;
}) {
  const [controlError, setControlError] = useState('');
  const [controlBusy, setControlBusy] = useState(false);
  const [command, setCommand] = useState<{
    action: string;
    state: string;
    sequence: number;
    accepted: boolean;
  } | null>(null);
  const sending = useRef(false);
  const controlFeedback = useRef<HTMLDivElement>(null);
  const [rerunOpened, setRerunOpened] = useState(tab === 'rerun');
  const previousTab = useRef(tab);
  const rerunHeading = useRef<HTMLHeadingElement>(null);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (tab === 'rerun') {
      setRerunOpened(true);
      rerunHeading.current?.focus({ preventScroll: true });
    } else if (tab === 'logs' || tab === 'output') {
      pageHeading.current?.focus({ preventScroll: true });
    } else if (
      previousTab.current === 'rerun' ||
      previousTab.current === 'logs' ||
      previousTab.current === 'output'
    ) {
      if (d.run.debug) pageHeading.current?.focus({ preventScroll: true });
      else document.getElementById('run-tab-' + tab)?.focus({ preventScroll: true });
    }
    previousTab.current = tab;
  }, [tab]);
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const r: Run = d.run;
  const observed = { ...d, fault: d.fault ?? fault };
  const view = presentRun({ ...observed, output: undefined }, Date.now());
  const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(r.state);
  const controllable = view.activity === 'active' && !view.closing;
  const lastSaved =
    !terminal && (Boolean(observed.fault) || (r.state !== 'QUEUED' && view.activity !== 'active'));
  const timeline = runTimeline(observed);
  const results = d.events.filter((event: Event) => typeof event.data?.outputPreview === 'string');
  const pause = [...d.events].reverse().find((event: Event) => event.type === 'debug-pause');
  useEffect(() => {
    if (!command?.accepted) return;
    const progressed = d.events.some(
      (event: Event) =>
        event.sequence > command.sequence &&
        (event.type === 'debug-pause' || event.type === 'node-start'),
    );
    if (
      terminal ||
      view.closing ||
      (command.state !== 'QUEUED' && view.activity !== 'active') ||
      r.state !== command.state ||
      (command.action !== 'pause' && progressed)
    )
      setCommand(null);
  }, [command, d.events, r.state, terminal, view.closing, view.activity]);
  useEffect(() => {
    if (controlError) controlFeedback.current?.focus();
  }, [controlError]);
  const sendControl = async (action: string) => {
    if (sending.current || (command && action !== 'cancel')) return;
    sending.current = true;
    setControlBusy(true);
    setControlError('');
    const request = {
      action,
      state: r.state,
      sequence: d.events.reduce(
        (latest: number, event: Event) => Math.max(latest, event.sequence),
        0,
      ),
      accepted: false,
    };
    setCommand(request);
    let accepted = false;
    try {
      accepted = await control(r.id, action);
      setCommand(accepted ? { ...request, accepted: true } : null);
      await reload();
      if (!accepted) setControlError('本次控制未执行，运行可能已经结束，请核对最新状态。');
    } catch (error) {
      if (!accepted) setCommand(null);
      setControlError(
        (accepted ? '控制请求已接收，但状态读取失败：' : '控制请求未确认，请先刷新状态：') +
          (error instanceof Error ? error.message : '暂时无法读取运行状态'),
      );
    } finally {
      sending.current = false;
      setControlBusy(false);
    }
  };
  const controlPending = controlBusy || !!command;
  const controlNote =
    command &&
    (command.accepted
      ? {
          pause: '暂停请求已接收，将在步骤边界暂停；当前步骤可能仍在执行。',
          resume: '继续请求已接收，等待执行状态更新。',
          step: '单步请求已接收，等待新的步骤记录；不会重复发送。',
          cancel: '取消请求已接收，等待停止与资源回收；尚未确认结束。',
        }[command.action]
      : '正在发送控制请求…');
  const runControls = (
    <div className="run-controls">
      {controllable && !observed.fault && r.state === 'RUNNING' && (
        <button disabled={controlPending} onClick={() => void sendControl('pause')}>
          {command?.action === 'pause' ? '暂停请求中' : '请求暂停'}
        </button>
      )}
      {controllable && !observed.fault && r.state === 'PAUSED' && (
        <button
          className={r.debug ? 'primary' : undefined}
          disabled={controlPending}
          onClick={() => void sendControl('step')}
        >
          执行下一步
        </button>
      )}
      {controllable && !observed.fault && ['PAUSED', 'WAITING_INPUT'].includes(r.state) && (
        <button disabled={controlPending} onClick={() => void sendControl('resume')}>
          继续运行
        </button>
      )}
      {!terminal && (controllable || (r.state === 'QUEUED' && !observed.fault)) && (
        <button
          className="danger"
          disabled={controlBusy || (!!command && command.action === 'cancel')}
          onClick={() => void sendControl('cancel')}
        >
          取消运行
        </button>
      )}
    </div>
  );
  const controlFeedbackContent = (controlError || controlPending) && (
    <div
      ref={controlFeedback}
      tabIndex={-1}
      className="run-control-feedback"
      role={controlError ? 'alert' : undefined}
    >
      {controlError && <p>{controlError}</p>}
      <button
        disabled={controlBusy}
        onClick={() =>
          void reload().then(
            () => setControlError(''),
            (error) => setControlError(error instanceof Error ? error.message : '状态读取失败'),
          )
        }
      >
        刷新状态
      </button>
    </div>
  );
  return (
    <div
      className={
        'run-detail' + (tab === 'logs' ? ' is-logs' : tab === 'output' ? ' is-output-page' : '')
      }
    >
      <div className="run-detail-content" hidden={tab === 'rerun'}>
        {r.debug && tab === 'current' ? (
          <DebugRunWorkspace
            key={r.id}
            detail={observed}
            view={view}
            timeline={timeline}
            results={results}
            controls={runControls}
            feedback={controlFeedbackContent}
            controlNote={controlNote}
            lastSaved={lastSaved}
            heading={pageHeading}
            showBrowser={showBrowser}
            logs={() => setTab('logs')}
            output={() => setTab('output')}
            rerun={() => setTab('rerun')}
            receipts={
              <>
                <McpRunReceipts
                  runId={r.id}
                  receipts={d.mcpReceipts}
                  snapshot={d.snapshot}
                  running={!terminal && view.activity === 'active'}
                />
                <DesktopRunReceipt
                  runId={r.id}
                  receipts={d.desktopReceipts}
                  snapshot={d.snapshot}
                />
              </>
            }
          />
        ) : (
          <>
            <div className="runs-heading run-detail-heading">
              <div>
                <h1 ref={pageHeading} tabIndex={-1}>
                  {tab === 'logs' ? '日志与步骤输出' : tab === 'output' ? '运行结果与产物' : r.name}
                </h1>
                <p>
                  {tab !== 'current' && `${r.name} · `}
                  <span title={r.id}>{r.id}</span> · {runSourceLabels[runSource(r)] ?? r.source} ·{' '}
                  {time(r.createdAt)}
                </p>
              </div>
              <button className="primary" onClick={showBrowser}>
                查看网页
              </button>
            </div>
            <section
              className="run-runtime-summary"
              aria-label="运行状态"
              hidden={tab !== 'current'}
            >
              <div className="run-runtime-line">
                <span
                  role="status"
                  className={'badge state-' + (lastSaved ? 'INTERRUPTED' : r.state)}
                >
                  {command?.action === 'pause' && command.accepted && !lastSaved
                    ? '暂停请求中'
                    : `${lastSaved ? '最后保存：' : ''}${runStateLabels[r.state]}`}
                </span>
                <strong>
                  {r.state === 'QUEUED'
                    ? '正在等待执行'
                    : view.closing
                      ? '正在收尾'
                      : command?.action === 'pause' && command.accepted
                        ? '将在步骤边界暂停'
                        : view.step.label}
                </strong>
                {runControls}
              </div>
              <p>
                {view.elapsed.kind === 'recorded' ? '已记录时长' : terminal ? '总耗时' : '已运行'}{' '}
                {view.elapsed.milliseconds === null
                  ? '待核对'
                  : formatRunDuration(view.elapsed.milliseconds)}{' '}
                · 使用启动时的固定版本 <code title={r.versionId}>{r.versionId.slice(0, 12)}</code>
              </p>
              {controlNote && <p role="status">{controlNote}</p>}
              {view.statusNote && <p role="status">{view.statusNote}</p>}
              {controlFeedbackContent}
              {r.error && (
                <p className="field-error" role="alert">
                  {r.error}
                </p>
              )}
            </section>
            <McpRunReceipts
              runId={r.id}
              receipts={d.mcpReceipts}
              snapshot={d.snapshot}
              running={!terminal && view.activity === 'active'}
            />
            <DesktopRunReceipt runId={r.id} receipts={d.desktopReceipts} snapshot={d.snapshot} />
            <div className={'run-observation-layout' + (tab !== 'current' ? ' is-output' : '')}>
              <aside className="run-timeline" aria-label="执行步骤" hidden={tab !== 'current'}>
                <h2>执行步骤</h2>
                {timeline.length ? (
                  <ol>
                    {timeline.map((step, index) => (
                      <li key={step.instance} aria-current={step.current ? 'step' : undefined}>
                        <div>
                          <span className="timeline-index">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <span>
                            {step.name === step.nodeId && step.type
                              ? (kinds[step.type]?.label ?? step.name)
                              : step.name}
                          </span>
                        </div>
                        {step.instance !== step.nodeId && <code>{step.instance}</code>}
                        <span className={'run-status run-tone-' + step.tone}>{step.label}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>尚无已保存的步骤记录或执行快照。</p>
                )}
              </aside>
              <section className="run-observation-content">
                <div
                  className="run-detail-tabs"
                  role="tablist"
                  aria-label="运行详情内容"
                  hidden={tab === 'logs'}
                >
                  {tabs.map(([id, label], index) => (
                    <button
                      key={id}
                      id={'run-tab-' + id}
                      role="tab"
                      aria-selected={tab === id}
                      aria-controls={'run-panel-' + id}
                      tabIndex={tab === id ? 0 : -1}
                      onClick={() => setTab(id)}
                      onKeyDown={(event) => {
                        const target =
                          event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? tabs.length - 1
                              : event.key === 'ArrowRight'
                                ? (index + 1) % tabs.length
                                : event.key === 'ArrowLeft'
                                  ? (index + tabs.length - 1) % tabs.length
                                  : null;
                        if (target === null) return;
                        event.preventDefault();
                        setTab(tabs[target][0]);
                        event.currentTarget.parentElement
                          ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                          [target]?.focus();
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div
                  id="run-panel-current"
                  role="tabpanel"
                  aria-labelledby="run-tab-current"
                  hidden={tab !== 'current'}
                >
                  <RunObservation detail={observed} compact />
                  {r.business && <p className="run-business-note">{r.business}</p>}
                  {r.debug && (
                    <p className="note">
                      逐步调试 · 执行下一步会实际操作页面；继续将连续运行剩余流程。
                    </p>
                  )}
                  {controllable && r.state === 'PAUSED' && pause && (
                    <section aria-label="调试位置">
                      <h3>下一步：{pause.data.nodeName}</h3>
                      <code>{pause.nodeInstance}</code>
                    </section>
                  )}
                  {results.length > 0 && (
                    <section aria-label="步骤输出">
                      <h3>步骤输出</h3>
                      <p className="note">已保存的脱敏预览；已执行步骤不会因暂停或失败自动重放。</p>
                      {results.map((event: Event) => (
                        <details key={event.sequence} open={event === results.at(-1)}>
                          <summary>{event.nodeInstance}</summary>
                          <pre>{event.data.outputPreview}</pre>
                        </details>
                      ))}
                    </section>
                  )}
                </div>
                <div
                  id="run-panel-output"
                  role="tabpanel"
                  aria-labelledby="run-tab-output"
                  hidden={tab !== 'output'}
                >
                  <RunOutputWorkspace
                    detail={observed}
                    reveal={reveal}
                    reload={reload}
                    rerun={() => setTab('rerun')}
                  />
                </div>
                <div
                  id="run-panel-logs"
                  role="tabpanel"
                  aria-labelledby="run-tab-logs"
                  hidden={tab !== 'logs'}
                >
                  <RunEventLog
                    key={r.id}
                    runId={r.id}
                    run={r}
                    events={d.events}
                    snapshot={d.snapshot}
                  />
                  {d.scriptBundles?.length > 0 && (
                    <details className="script-bundles">
                      <summary>已固定的脚本与依赖 · {d.scriptBundles.length} 个节点</summary>
                      {d.scriptBundles.map((bundle: any) => (
                        <div key={bundle.nodeId}>
                          <p>
                            <b>{bundle.nodeId}</b> ·{' '}
                            {bundle.dependencies.length
                              ? bundle.dependencies
                                  .map((dep: any) => dep.name + '@' + dep.version)
                                  .join('，')
                              : '仅使用脚本及 Node 内置能力'}
                          </p>
                          <code className="path-text">SHA-256 {bundle.sha256}</code>
                        </div>
                      ))}
                    </details>
                  )}
                </div>
              </section>
            </div>
            <div className="run-rerun-entry" hidden={tab === 'output'}>
              <div>
                <h2>重新运行与关联记录</h2>
                <p>先核对已保存输出和外部结果，再选择执行内容。查看不会创建运行。</p>
              </div>
              <button type="button" onClick={() => setTab('rerun')}>
                核对后重新运行
              </button>
            </div>
          </>
        )}
      </div>
      {(tab === 'rerun' || rerunOpened) && (
        <div className="run-rerun-page" hidden={tab !== 'rerun'}>
          <header className="runs-heading">
            <h1 ref={rerunHeading} tabIndex={-1}>
              重新运行前核对
            </h1>
            <p>{r.name} · 新建关联运行，从第一步执行；原记录与产物保留。</p>
          </header>
          <RunRerunPanel
            run={r}
            related={d.rerun}
            open={open}
            page
            active={tab === 'rerun'}
            cancel={cancelRerun}
            busyChanged={rerunBusy}
            inspectSource={(next) => setTab(next)}
          />
        </div>
      )}
    </div>
  );
}
