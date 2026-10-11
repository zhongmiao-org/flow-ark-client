import { runStateColors, runStepColors } from './theme';
import { Alert, Button, Collapse, Tabs, Tag, Badge, Card } from 'antd';
import { activateCollapseWithSpace } from './collapseKeyboard';
import McpRunReceipts from './McpRunReceipts';
import DebugRunWorkspace from './DebugRunWorkspace';
import { useRunControl, RunControlFeedback } from './useRunControl';
import { useEffect, useRef, useState } from 'react';
import type { Event, Run } from '../shared/types';
import { formatRunDuration, presentRun } from '../shared/run-presentation';
import {
  runSource,
  runSourceLabels,
  runDisplayLabels as runStateLabels,
} from '../shared/run-history';
import { RunObservation, RunStepOutput } from './RunObservation';
import RunRerunPanel, { type RunRerunView } from './RunRerunPanel';
import RunOutputWorkspace from './RunOutputWorkspace';
import { runTimeline, runTimelineTitle } from './run-timeline';
import RunEventLog, { type RunLogPosition } from './RunEventLog';
import RunLogSummary from './RunLogSummary';
import DesktopRunReceipt from './DesktopRunReceipt';
import { runInstancePresenter } from './run-instance-presentation';

export type RunDetailReturnContext = {
  runId: string;
  tab: RunTab;
  scroll: number;
  rerun?: RunRerunView;
  logs?: RunLogPosition;
  relatedRunId?: string;
};
export type RunTab = 'current' | 'output' | 'logs' | 'rerun';
const tabs: [Exclude<RunTab, 'rerun'>, string][] = [
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
  inspectRelated,
  restored,
  humanRequest,
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
  inspectRelated: (detail: any, context: RunDetailReturnContext) => void;
  restored?: RunDetailReturnContext;
  humanRequest?: () => void;
}) {
  const [rerunOpened, setRerunOpened] = useState(tab === 'rerun');
  const previousTab = useRef<RunTab | null>(null);
  useEffect(() => {
    if (!restored || restored.runId !== d.run.id) return;
    const frame = requestAnimationFrame(() =>
      document.querySelector('main')?.scrollTo({ top: restored.scroll }),
    );
    return () => cancelAnimationFrame(frame);
  }, []);
  const rerunHeading = useRef<HTMLHeadingElement>(null);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const logPosition = useRef<RunLogPosition>(
    restored?.logs ?? { instance: '*', limit: 100, latest: null },
  );
  useEffect(() => {
    if (tab === 'rerun') {
      setRerunOpened(true);
      rerunHeading.current?.focus({ preventScroll: true });
    } else if (tab === 'logs' || tab === 'output' || previousTab.current === null) {
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
  const results = d.events.filter(
    (event: Event) => event.runId === r.id && typeof event.data?.outputPreview === 'string',
  );
  const pause = [...d.events]
    .reverse()
    .find((event: Event) => event.runId === r.id && event.type === 'debug-pause');
  const controller = useRunControl({ run: r, events: d.events, view, control, reload });
  const { controlBusy, controlPending, controlNote, command, sendControl } = controller;
  const runControls = (
    <div className="run-controls">
      {controllable && !observed.fault && r.state === 'RUNNING' && (
        <Button disabled={controlPending || undefined} onClick={() => void sendControl('pause')}>
          {command?.action === 'pause' ? '暂停请求中' : '请求暂停'}
        </Button>
      )}
      {controllable && !observed.fault && r.state === 'PAUSED' && (
        <Button
          type={r.debug ? 'primary' : 'default'}
          disabled={controlPending || undefined}
          onClick={() => void sendControl('step')}
        >
          执行下一步
        </Button>
      )}
      {controllable &&
        !observed.fault &&
        ['PAUSED', 'WAITING_INPUT'].includes(r.state) &&
        (r.state === 'WAITING_INPUT' && humanRequest ? (
          <Button type="primary" onClick={humanRequest}>
            查看本次人工请求
          </Button>
        ) : (
          <Button disabled={controlPending || undefined} onClick={() => void sendControl('resume')}>
            继续运行
          </Button>
        ))}
      {!terminal && (controllable || (r.state === 'QUEUED' && !observed.fault)) && (
        <Button
          danger
          disabled={controlBusy || (!!command && command.action === 'cancel') || undefined}
          onClick={() => void sendControl('cancel')}
        >
          取消运行
        </Button>
      )}
    </div>
  );
  const controlFeedbackContent = <RunControlFeedback controller={controller} />;
  const runPanels = {
    current: (
      <>
        <RunObservation detail={observed} compact />
        {r.business && <p className="run-business-note">{r.business}</p>}
        {r.debug && (
          <p className="note">逐步调试 · 执行下一步会实际操作页面；继续将连续运行剩余流程。</p>
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
            {results.map((event: Event) => {
              const step = timeline.find((row) => row.instance === event.nodeInstance);
              return (
                <RunStepOutput
                  key={event.sequence}
                  event={event}
                  latest={event === results.at(-1)}
                  label={step ? runTimelineTitle(step) : event.nodeInstance || '运行输出'}
                  instance={step && step.instance !== step.nodeId ? step.instance : undefined}
                />
              );
            })}
          </section>
        )}
      </>
    ),
    output: (
      <>
        <RunOutputWorkspace
          detail={observed}
          reveal={reveal}
          reload={reload}
          rerun={() => setTab('rerun')}
        />
      </>
    ),
    logs: (
      <>
        <RunEventLog
          key={r.id}
          position={logPosition}
          runId={r.id}
          run={r}
          events={d.events}
          snapshot={d.snapshot}
          summary={
            <RunLogSummary
              detail={observed}
              active={tab === 'logs'}
              restoredRunId={restored?.relatedRunId}
              showOutput={() => setTab('output')}
              showCurrent={() => setTab('current')}
              showRerun={() => setTab('rerun')}
              inspect={(next, relatedRunId) =>
                inspectRelated(next, {
                  runId: r.id,
                  tab: 'logs',
                  scroll: document.querySelector('main')?.scrollTop ?? 0,
                  logs: { ...logPosition.current },
                  relatedRunId,
                })
              }
            />
          }
        />
        {d.scriptBundles?.length > 0 && (
          <Collapse
            className="script-bundles"
            size="small"
            items={[
              {
                key: 'bundles',
                label: `已固定的脚本与依赖 · ${d.scriptBundles.length} 个节点`,
                forceRender: true,
                onKeyDown: activateCollapseWithSpace,
                children: d.scriptBundles.map((bundle: any) => (
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
                )),
              },
            ]}
          />
        )}
      </>
    ),
  };
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
                  {tab === 'output' ? (
                    <>
                      <span title={r.id}>{r.id}</span> · 使用本次运行保存的结果，不重新执行节点。
                    </>
                  ) : (
                    <>
                      {tab !== 'current' && `${r.name} · `}
                      <span title={r.id}>{r.id}</span> · {runSourceLabels[runSource(r)] ?? r.source}{' '}
                      · {time(r.createdAt)}
                    </>
                  )}
                </p>
              </div>
              {tab === 'current' && (
                <Button type="primary" onClick={showBrowser}>
                  查看网页
                </Button>
              )}
            </div>
            <section
              className="run-runtime-summary"
              aria-label="运行状态"
              hidden={tab !== 'current'}
            >
              <div className="run-runtime-line">
                <Tag
                  role="status"
                  className="run-state-tag"
                  variant="filled"
                  color={runStateColors[lastSaved ? 'INTERRUPTED' : r.state]}
                  icon={<Badge status={runStateColors[lastSaved ? 'INTERRUPTED' : r.state]} />}
                >
                  {command?.action === 'pause' && command.accepted && !lastSaved
                    ? '暂停请求中'
                    : `${lastSaved ? '最后保存：' : ''}${runStateLabels[r.state]}`}
                </Tag>
                <strong>
                  {r.state === 'QUEUED'
                    ? '正在等待执行'
                    : view.closing
                      ? '正在收尾'
                      : command?.action === 'pause' && command.accepted
                        ? '将在步骤边界暂停'
                        : view.step.instance &&
                            runInstancePresenter(d.snapshot)(view.step.instance) === null
                          ? `运行位置：${view.step.instance}（位置待核对）`
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
              {controlNote && <Alert type="info" showIcon title={controlNote} role="status" />}
              {view.statusNote && (
                <Alert type="warning" showIcon title={view.statusNote} role="status" />
              )}
              {controlFeedbackContent}
              {r.error && <Alert type="error" showIcon title={r.error} />}
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
                    {timeline.map((step) => (
                      <li key={step.key} aria-current={step.current ? 'step' : undefined}>
                        <div>
                          <span
                            className="timeline-index"
                            aria-label={step.ordinal === null ? '步骤编号不可确定' : undefined}
                          >
                            {step.ordinal === null ? '—' : String(step.ordinal).padStart(2, '0')}
                          </span>
                          <span>{step.name}</span>
                        </div>
                        {step.instance !== step.nodeId && <code>{step.instance}</code>}
                        <Tag
                          className="run-state-tag"
                          variant="filled"
                          color={runStepColors[step.tone]}
                          icon={<Badge status={runStepColors[step.tone]} />}
                        >
                          {step.label}
                        </Tag>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>尚无已保存的步骤记录或执行快照。</p>
                )}
              </aside>
              <section className="run-observation-content">
                <Tabs
                  id="run"
                  className={'run-detail-tabs' + (tab === 'output' ? ' is-output' : '')}
                  aria-label="运行详情内容"
                  activeKey={tab}
                  animated={false}
                  destroyOnHidden={false}
                  onChange={(key) => setTab(key as RunTab)}
                  tabBarExtraContent={
                    tab === 'output' ? (
                      <Button onClick={() => setTab('rerun')}>核对后重新运行</Button>
                    ) : undefined
                  }
                  items={tabs.map(([key, label]) => ({
                    key,
                    label: key === 'logs' && tab === 'output' ? '日志与步骤' : label,
                    disabled: key === 'current' && tab === 'output',
                    forceRender: true,
                    children: runPanels[key],
                  }))}
                />
              </section>
            </div>
            <div className="run-rerun-entry" hidden={tab === 'output' || tab === 'logs'}>
              <Card className="run-rerun-entry-card">
                <div>
                  <h2>重新运行与关联记录</h2>
                  <p>先核对已保存输出和外部结果，再选择执行内容。查看不会创建运行。</p>
                </div>
                <Button htmlType="button" onClick={() => setTab('rerun')}>
                  核对后重新运行
                </Button>
              </Card>
            </div>
          </>
        )}
      </div>
      {(tab === 'rerun' || rerunOpened) && (
        <div className="run-rerun-page" id="run-panel-rerun" hidden={tab !== 'rerun'}>
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
            initialView={restored?.runId === r.id ? restored.rerun : undefined}
            inspectRelated={(next, view) =>
              inspectRelated(next, {
                runId: r.id,
                tab,
                scroll: document.querySelector('main')?.scrollTop ?? 0,
                rerun: view,
              })
            }
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
