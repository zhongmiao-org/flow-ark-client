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
  control: (id: string, action: string) => void;
  reveal: (id: string) => Promise<unknown>;
  reload: () => Promise<void>;
  open: (detail: any) => void;
  tab: RunTab;
  setTab: (tab: RunTab) => void;
  showBrowser: () => void;
  cancelRerun: () => void;
  rerunBusy: (busy: boolean) => void;
}) {
  const [rerunOpened, setRerunOpened] = useState(tab === 'rerun');
  const previousTab = useRef(tab);
  const rerunHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (tab === 'rerun') {
      setRerunOpened(true);
      rerunHeading.current?.focus({ preventScroll: true });
    } else if (previousTab.current === 'rerun') {
      document.getElementById('run-tab-' + tab)?.focus({ preventScroll: true });
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
  return (
    <div className="run-detail">
      <div className="run-detail-content" hidden={tab === 'rerun'}>
        <div className="runs-heading run-detail-heading">
          <div>
            <h1 tabIndex={-1}>{r.name}</h1>
            <p>
              <span title={r.id}>{r.id}</span> · {runSourceLabels[runSource(r)] ?? r.source} ·{' '}
              {time(r.createdAt)}
            </p>
          </div>
          <button className="primary" onClick={showBrowser}>
            查看网页
          </button>
        </div>
        <section className="run-runtime-summary" aria-label="运行状态">
          <div className="run-runtime-line">
            <span className={'badge state-' + (lastSaved ? 'INTERRUPTED' : r.state)}>
              {lastSaved ? '最后保存：' : ''}
              {runStateLabels[r.state]}
            </span>
            <strong>{view.closing ? '正在收尾' : view.step.label}</strong>
            <div className="run-controls">
              {controllable && !observed.fault && r.state === 'RUNNING' && (
                <button onClick={() => control(r.id, 'pause')}>请求暂停</button>
              )}
              {controllable && !observed.fault && ['PAUSED', 'WAITING_INPUT'].includes(r.state) && (
                <button onClick={() => control(r.id, 'resume')}>继续</button>
              )}
              {controllable && !observed.fault && r.state === 'PAUSED' && (
                <button onClick={() => control(r.id, 'step')}>执行下一步</button>
              )}
              {!terminal && (controllable || (r.state === 'QUEUED' && !observed.fault)) && (
                <button className="danger" onClick={() => control(r.id, 'cancel')}>
                  取消运行
                </button>
              )}
            </div>
          </div>
          <p>
            {view.elapsed.kind === 'recorded' ? '已记录时长' : terminal ? '总耗时' : '已运行'}{' '}
            {view.elapsed.milliseconds === null
              ? '待核对'
              : formatRunDuration(view.elapsed.milliseconds)}{' '}
            · 使用启动时的固定版本 <code title={r.versionId}>{r.versionId.slice(0, 12)}</code>
          </p>
          {view.statusNote && <p role="status">{view.statusNote}</p>}
          {r.error && (
            <p className="field-error" role="alert">
              {r.error}
            </p>
          )}
        </section>
        <DesktopRunReceipt runId={r.id} receipts={d.desktopReceipts} snapshot={d.snapshot} />
        <div className={'run-observation-layout' + (tab === 'output' ? ' is-output' : '')}>
          <aside className="run-timeline" aria-label="执行步骤" hidden={tab === 'output'}>
            <h2>执行步骤</h2>
            {timeline.length ? (
              <ol>
                {timeline.map((step, index) => (
                  <li key={step.instance} aria-current={step.current ? 'step' : undefined}>
                    <div>
                      <span className="timeline-index">{String(index + 1).padStart(2, '0')}</span>
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
            <div className="run-detail-tabs" role="tablist" aria-label="运行详情内容">
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
              <RunObservation detail={observed} />
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
              <RunOutputWorkspace detail={observed} reveal={reveal} reload={reload} />
            </div>
            <div
              id="run-panel-logs"
              role="tabpanel"
              aria-labelledby="run-tab-logs"
              hidden={tab !== 'logs'}
            >
              <RunEventLog key={r.id} runId={r.id} events={d.events} snapshot={d.snapshot} />
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
        <div className="run-rerun-entry">
          <div>
            <h2>重新运行与关联记录</h2>
            <p>先核对已保存输出和外部结果，再选择执行内容。查看不会创建运行。</p>
          </div>
          <button type="button" onClick={() => setTab('rerun')}>
            核对后重新运行
          </button>
        </div>
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
