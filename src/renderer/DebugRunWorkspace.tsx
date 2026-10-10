import { runStateColors, runStepColors } from './theme';
import { Alert, Button, Card, Collapse, Descriptions, Empty, Tag, Badge } from 'antd';
import { activateCollapseWithSpace } from './collapseKeyboard';
import type { ReactNode, RefObject } from 'react';
import type { Event } from '../shared/types';
import type { RunPresentation, RunPresentationInput } from '../shared/run-presentation';
import { formatRunDuration } from '../shared/run-presentation';
import { runDisplayLabels } from '../shared/run-history';
import { runTimeline, runTimelineTitle } from './run-timeline';
import { RunObservation, RunStepOutput } from './RunObservation';
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
  logs: () => void;
  output: () => void;
  rerun: () => void;
  receipts: ReactNode;
};
export default function DebugRunWorkspace(props: Props) {
  const { run } = props.detail;
  const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(run.state);
  const paused = props.view.step.kind === 'paused' && !props.lastSaved;
  const current = props.timeline.find((step) => step.instance === props.view.step.instance);
  const stepPrefix = {
    current: '当前步骤',
    paused: '下一步',
    waiting: '等待人工',
    last: '最后记录步骤',
    pending: null,
    unknown: null,
  }[props.view.step.kind];
  const currentLabel =
    current && current.ordinal !== null && stepPrefix
      ? `${stepPrefix}：${runTimelineTitle(current)}`
      : props.view.step.label;
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
      </header>
      <Alert
        type={props.lastSaved || props.view.statusNote ? 'warning' : 'info'}
        showIcon
        title={banner}
        role="status"
      />
      <div className="debug-run-columns">
        <aside className="debug-run-steps" aria-label="调试步骤">
          <Card className="debug-run-steps-card">
            {props.timeline.length ? (
              <ol>
                {props.timeline.map((step) => (
                  <li key={step.instance} aria-current={step.current ? 'step' : undefined}>
                    <h2>{runTimelineTitle(step)}</h2>
                    {step.instance !== step.nodeId && <code>{step.instance}</code>}
                    <Tag
                      className="run-state-tag"
                      variant="filled"
                      color={runStepColors[step.label === '下一步' ? 'neutral' : step.tone]}
                      icon={
                        <Badge
                          status={runStepColors[step.label === '下一步' ? 'neutral' : step.tone]}
                        />
                      }
                    >
                      {step.label === '下一步' ? '下一步 · 未执行' : step.label}
                    </Tag>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="尚无已保存的步骤记录或执行快照。"
              />
            )}
          </Card>
        </aside>
        <section className="debug-run-current" aria-label="调试控制与结果">
          <Card className="debug-run-current-card">
            <Tag
              className="run-state-tag"
              variant="filled"
              color={runStateColors[props.lastSaved ? 'INTERRUPTED' : run.state]}
              icon={<Badge status={runStateColors[props.lastSaved ? 'INTERRUPTED' : run.state]} />}
            >
              {props.lastSaved ? '最后保存：' : ''}
              {runDisplayLabels[run.state]}
            </Tag>
            <h2>{currentLabel}</h2>
            <p>
              {props.results.length
                ? `已保存 ${props.results.length} 条脱敏步骤输出，可展开核对。`
                : '尚无步骤输出。完成步骤后可查看持久化的脱敏结果。'}
            </p>
            {props.controls}
            {props.feedback}
            {run.error && <Alert type="error" showIcon title={run.error} />}
            <Collapse
              className="debug-run-details"
              items={[
                {
                  key: 'outputs',
                  label: '查看步骤输出',
                  forceRender: true,
                  onKeyDown: activateCollapseWithSpace,
                  children: (
                    <section aria-label="调试步骤输出">
                      <h3>已保存的步骤输出</h3>
                      {props.results.length ? (
                        props.results.map((event) => {
                          const step = props.timeline.find(
                            (row) => row.instance === event.nodeInstance,
                          );
                          return (
                            <RunStepOutput
                              key={event.sequence}
                              event={event}
                              latest={event === props.results.at(-1)}
                              label={
                                step ? runTimelineTitle(step) : event.nodeInstance || '运行输出'
                              }
                              instance={
                                step && step.instance !== step.nodeId ? step.instance : undefined
                              }
                            />
                          );
                        })
                      ) : (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description="尚无已保存输出；查看不会执行步骤。"
                        />
                      )}
                      <Button onClick={props.output}>查看输出与运行产物</Button>
                    </section>
                  ),
                },
                {
                  key: 'details',
                  label: '查看暂停 / 等待 / 收尾',
                  forceRender: true,
                  onKeyDown: activateCollapseWithSpace,
                  children: (
                    <section aria-label="调试运行详情">
                      <RunObservation detail={props.detail} compact />
                      <Descriptions
                        size="small"
                        layout="vertical"
                        column={1}
                        items={[
                          { key: 'run', label: '运行', children: run.id },
                          { key: 'version', label: '固定版本', children: run.versionId },
                          {
                            key: 'elapsed',
                            label: '已记录时长',
                            children:
                              props.view.elapsed.milliseconds === null
                                ? '待核对'
                                : formatRunDuration(props.view.elapsed.milliseconds),
                          },
                        ]}
                      />
                      {run.business && <p>{run.business}</p>}
                      <Button onClick={props.logs}>查看运行日志</Button>
                      {terminal && <Button onClick={props.rerun}>核对后重新运行</Button>}
                    </section>
                  ),
                },
              ]}
            />
            {props.receipts}
          </Card>
        </section>
      </div>
    </div>
  );
}
