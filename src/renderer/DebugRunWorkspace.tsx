import { useId, useState, type ReactNode, type RefObject } from 'react';
import type { Event } from '../shared/types';
import type { RunPresentation, RunPresentationInput } from '../shared/run-presentation';
import { formatRunDuration } from '../shared/run-presentation';
import { runDisplayLabels } from '../shared/run-history';
import { runTimeline } from './run-timeline';
import { kinds } from './node-kinds';
import { RunObservation } from './RunObservation';
import './debug-run-workspace.css';

type Props = {
  detail: RunPresentationInput;
  view: RunPresentation;
  timeline: ReturnType<typeof runTimeline>;
  results: Event[];
  controls: ReactNode;
  feedback: ReactNode;
  controlNote?: string | null;
  lastSaved: boolean;
  heading: RefObject<HTMLHeadingElement | null>;
  showBrowser: () => void;
  logs: () => void;
  output: () => void;
  rerun: () => void;
  receipts: ReactNode;
};
export default function DebugRunWorkspace(props: Props) {
  const id = useId();
  const [outputsOpen, setOutputsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { run } = props.detail;
  const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(run.state);
  const paused = props.view.step.kind === 'paused' && !props.lastSaved;
  const banner =
    props.controlNote ||
    props.view.statusNote ||
    (terminal
      ? '本次调试已结束。请核对已保存的步骤输出与外部结果。'
      : props.view.closing
        ? '正在收尾，等待执行进程停止与资源回收。'
        : run.state === 'PAUSED'
          ? paused
            ? '已暂停在下一节点之前。点击“执行下一步”会真实操作网页或文件。'
            : '已暂停，当前步骤位置尚未确认。执行下一步或继续运行会真实操作网页或文件。'
          : run.state === 'WAITING_INPUT'
            ? '当前步骤正在等待人工回应，请核对输入请求。'
            : run.state === 'QUEUED'
              ? '正在排队，尚未开始执行启动时固定的快照。'
              : props.view.activity === 'active'
                ? '正在执行固定版本。暂停会在步骤边界生效，继续将连续执行剩余流程。'
                : '当前执行状态尚不能确认，请刷新运行记录后核对。');
  return (
    <div className="debug-run-workspace">
      <header className="runs-heading run-detail-heading">
        <div>
          <h1 ref={props.heading} tabIndex={-1}>
            {run.name} · 逐步调试
          </h1>
          <p>启动时已固定快照；修改编辑器草稿不会改变当前执行。</p>
        </div>
        <button onClick={props.showBrowser}>显示网页</button>
      </header>
      <div className="debug-run-banner" role="status">
        {banner}
      </div>
      <div className="debug-run-columns">
        <aside className="debug-run-steps" aria-label="调试步骤">
          {props.timeline.length ? (
            <ol>
              {props.timeline.map((step, index) => (
                <li key={step.instance} aria-current={step.current ? 'step' : undefined}>
                  <h2>
                    <span>{String(index + 1).padStart(2, '0')}</span>{' '}
                    {step.name === step.nodeId && step.type
                      ? (kinds[step.type]?.label ?? step.name)
                      : step.name}
                  </h2>
                  {step.instance !== step.nodeId && <code>{step.instance}</code>}
                  <span className={'run-status run-tone-' + step.tone}>
                    {step.label === '下一步' ? '下一步 · 未执行' : step.label}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p>尚无已保存的步骤记录或执行快照。</p>
          )}
        </aside>
        <section className="debug-run-current" aria-label="调试控制与结果">
          <span className={'badge state-' + (props.lastSaved ? 'INTERRUPTED' : run.state)}>
            {props.lastSaved ? '最后保存：' : ''}
            {runDisplayLabels[run.state]}
          </span>
          <h2>{props.view.step.label}</h2>
          <p>
            {props.results.length
              ? `已保存 ${props.results.length} 条脱敏步骤输出，可展开核对。`
              : '尚无步骤输出。完成步骤后可查看持久化的脱敏结果。'}
          </p>
          {props.controls}
          {props.feedback}
          {run.error && (
            <p className="field-error" role="alert">
              {run.error}
            </p>
          )}
          <div className="debug-run-detail-actions">
            <button
              aria-expanded={outputsOpen}
              aria-controls={id + '-outputs'}
              onClick={() => setOutputsOpen(!outputsOpen)}
            >
              查看步骤输出
            </button>
            <button
              aria-expanded={detailsOpen}
              aria-controls={id + '-details'}
              onClick={() => setDetailsOpen(!detailsOpen)}
            >
              查看暂停 / 等待 / 收尾
            </button>
          </div>
          <section id={id + '-outputs'} hidden={!outputsOpen} aria-label="调试步骤输出">
            <h3>已保存的步骤输出</h3>
            {props.results.length ? (
              props.results.map((event) => (
                <details key={event.sequence} open={event === props.results.at(-1)}>
                  <summary>{event.nodeInstance}</summary>
                  <pre tabIndex={0}>{event.data.outputPreview}</pre>
                </details>
              ))
            ) : (
              <p>尚无已保存输出；查看不会执行步骤。</p>
            )}
            <button onClick={props.output}>查看输出与运行产物</button>
          </section>
          <section id={id + '-details'} hidden={!detailsOpen} aria-label="调试运行详情">
            <RunObservation detail={props.detail} compact />
            <dl>
              <dt>运行</dt>
              <dd>{run.id}</dd>
              <dt>固定版本</dt>
              <dd>{run.versionId}</dd>
              <dt>已记录时长</dt>
              <dd>
                {props.view.elapsed.milliseconds === null
                  ? '待核对'
                  : formatRunDuration(props.view.elapsed.milliseconds)}
              </dd>
            </dl>
            {run.business && <p>{run.business}</p>}
            <button onClick={props.logs}>查看运行日志</button>
            {terminal && <button onClick={props.rerun}>核对后重新运行</button>}
          </section>
          {props.receipts}
        </section>
      </div>
    </div>
  );
}
