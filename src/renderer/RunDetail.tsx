import { useEffect, useState } from 'react';
import type { Event, Run } from '../shared/types';
import { formatRunDuration, presentRun } from '../shared/run-presentation';
import {
  runSource,
  runSourceLabels,
  runDisplayLabels as runStateLabels,
} from '../shared/run-history';
import { RunObservation, RunOutput } from './RunObservation';
import RunRerunPanel from './RunRerunPanel';
import ArtifactCleanupPanel from './ArtifactCleanupPanel';
import { runTimeline } from './run-timeline';
import { kinds } from './node-kinds';

export type RunTab = 'current' | 'output' | 'logs';
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
}: {
  detail: any;
  fault?: string;
  control: (id: string, action: string) => void;
  reveal: (id: string) => void;
  reload: () => Promise<void>;
  open: (detail: any) => void;
  tab: RunTab;
  setTab: (tab: RunTab) => void;
  showBrowser: () => void;
}) {
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
      <div className="runs-heading run-detail-heading">
        <div>
          <h1>{r.name}</h1>
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
      <div className="run-observation-layout">
        <aside className="run-timeline" aria-label="执行步骤">
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
            <RunOutput detail={observed} />
            <h3>运行产物</h3>
            {d.artifacts.length ? (
              d.artifacts.map((a: any) => (
                <div
                  key={a.artifactId}
                  className="row artifact-row"
                  data-artifact-id={a.artifactId}
                >
                  <div className="artifact-description">
                    <p>
                      {a.name} · {a.size} 字节
                    </p>
                    <span className={!a.available ? 'field-error' : undefined}>
                      {a.integrity === 'cleared'
                        ? '已清理'
                        : a.integrity === 'verified'
                          ? '已保存副本'
                          : a.integrity === 'changed'
                            ? '副本内容已改动'
                            : a.integrity === 'unverified'
                              ? '旧记录，未保存副本'
                              : '文件已移动、删除或不可访问'}
                    </span>
                    <p className="path-text">{a.path}</p>
                  </div>
                  <button disabled={!a.available} onClick={() => reveal(a.artifactId)}>
                    {a.storage === 'snapshot-v1' ? '定位副本' : '定位当前文件'}
                  </button>
                </div>
              ))
            ) : (
              <p>尚无已保存的运行产物。</p>
            )}
            <ArtifactCleanupPanel run={r} cleanup={d.artifactCleanup} changed={reload} />
          </div>
          <div
            id="run-panel-logs"
            role="tabpanel"
            aria-labelledby="run-tab-logs"
            hidden={tab !== 'logs'}
          >
            <h3>运行日志</h3>
            <p className="note">仅展示已保存的运行事件，包含节点实例路径与脱敏内容。</p>
            <div className="event-list">
              {d.events.map((event: Event) => (
                <details key={event.sequence}>
                  <summary>
                    <time>{time(event.time)}</time> <b>{event.type}</b>{' '}
                    <code>{event.nodeInstance}</code>
                  </summary>
                  <pre>{JSON.stringify(event.data, null, 2)}</pre>
                </details>
              ))}
            </div>
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
      <RunRerunPanel run={r} related={d.rerun} open={open} />
    </div>
  );
}
