import { runRecordLabel } from './readable-labels';
import { runStateColors } from './theme';
import { Alert, Button, Descriptions, Tag, Badge, Card } from 'antd';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { TaskRunIntent, TaskRunView, taskRunPresentation } from './task-run-presentation';
import { runDisplayLabels } from '../shared/run-history';
import DesktopRunReceipt from './DesktopRunReceipt';
import RunEventLog from './RunEventLog';
import TaskExecutionSteps, { type TaskExecutionView } from './TaskExecutionSteps';
import './desktop-run.css';

export default function DesktopTaskRun({
  detail,
  model,
  page,
  setPage,
  navigate,
  history,
  connections,
  control,
  busy,
  cancelBusy,
  pausePending,
  controlFeedback,
  error,
}: {
  detail: any;
  model: ReturnType<typeof taskRunPresentation>;
  page: TaskRunView;
  setPage: (page: TaskRunView) => void;
  navigate: (intent: TaskRunIntent) => void;
  history: () => void;
  connections: () => void;
  control: (action: string) => void;
  busy: boolean;
  cancelBusy: boolean;
  pausePending: boolean;
  controlFeedback: ReactNode;
  error: string;
}) {
  const [stepsView, setStepsView] = useState<TaskExecutionView>();
  const desktop = model.desktop!;
  const run = detail.run;
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    document.querySelector('main')?.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [run.id, page, model.mode]);
  const active = model.view.activity === 'active' && !model.view.closing && !detail.fault;
  const currentStep =
    active &&
    !model.terminal &&
    !model.uncertain &&
    ['current', 'paused', 'waiting'].includes(model.view.step.kind) &&
    model.current?.nodeId === desktop.node.id
      ? model.view.step.kind === 'paused'
        ? '下一步 1 / 1'
        : '第 1 / 1 步'
      : undefined;
  const verified = desktop.phase === 'verified';
  const title =
    page === 'details'
      ? '应用修改详细信息'
      : model.view.closing
        ? '正在完成应用试运行收尾'
        : model.terminal && !model.success
          ? model.title
          : desktop.title;
  return (
    <div
      className="task-run-page desktop-task-run"
      data-task-run-id={run.id}
      data-task-run-mode={model.mode}
    >
      <div className="page-heading">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {title}
          </h1>
          <p>{runRecordLabel(run)} · 按启动时保存的方案执行</p>
        </div>
      </div>
      {error && (
        <Alert className="workspace-feedback" type="error" role="alert" showIcon title={error} />
      )}
      <section aria-label="应用执行与结果">
        <Card className="task-run-card desktop-task-run-panel">
          <div className="desktop-task-run-status">
            <Tag
              className="run-state-tag"
              variant="filled"
              color={runStateColors[model.uncertain ? 'INTERRUPTED' : run.state]}
              icon={<Badge status={runStateColors[model.uncertain ? 'INTERRUPTED' : run.state]} />}
            >
              {model.uncertain
                ? '结果待核对'
                : model.view.closing
                  ? '正在收尾'
                  : (runDisplayLabels[run.state as keyof typeof runDisplayLabels] ?? run.state)}
              {currentStep && ` · ${currentStep}`}
            </Tag>
          </div>
          <h2>
            {verified
              ? desktop.windowTitle
                ? `修改了 ${desktop.windowTitle} 的选中段落`
                : '修改了已核对的原选区'
              : desktop.title}
          </h2>
          {!verified && (
            <Card size="small" className="task-run-file desktop-task-object">
              <h3>{model.terminal ? '记录中的对象' : '当前对象'}</h3>
              <p>
                {desktop.windowTitle
                  ? `文本编辑 / ${desktop.windowTitle} / 原选区`
                  : '本次记录没有提供窗口名称，请核对原应用窗口。'}
              </p>
            </Card>
          )}
          {model.view.statusNote && (
            <Alert type="info" role="status" showIcon title={model.view.statusNote} />
          )}
          {detail.fault && <Alert type="error" role="alert" showIcon title={detail.fault} />}
          {run.error && <Alert type="error" role="alert" showIcon title={run.error} />}
          {!verified && (
            <div className="desktop-task-progress">
              <p>
                步骤记录：{model.completed.length} 次已完成
                {model.unresolved.length > 0
                  ? ` · ${model.unresolved.length} 次已开始未确认完成`
                  : ` · ${model.unvisited.length} 个尚未执行`}
                。
              </p>
              <Alert
                type={desktop.needsReview ? 'warning' : 'info'}
                role={desktop.needsReview ? 'alert' : 'status'}
                showIcon
                title={desktop.effect}
              />
            </div>
          )}
          {verified && (
            <>
              <div className="desktop-task-readback">
                <h3>本次回读内容</h3>
                <pre tabIndex={0} aria-label="本次回读内容">
                  {desktop.receipt!.readback}
                </pre>
              </div>
              <div className="desktop-task-effect">
                <Alert type="success" role="status" showIcon title={desktop.effect} />
                <p>结果仍在原文档中，请在文本编辑中查看并按需要保存。此处不会自动刷新后续编辑。</p>
              </div>
              {!model.success && (
                <p>文字回读与运行整体状态分别记录；请同时核对上方取消、中断、收尾或异常提示。</p>
              )}
            </>
          )}
          {!model.terminal && (
            <div className="ai-task-actions">
              {active && run.state === 'RUNNING' && (
                <Button disabled={busy || undefined} onClick={() => control('pause')}>
                  {pausePending ? '暂停请求中' : '请求暂停'}
                </Button>
              )}
              {active && ['PAUSED', 'WAITING_INPUT'].includes(run.state) && (
                <Button
                  type="primary"
                  disabled={busy || undefined}
                  onClick={() => control('resume')}
                >
                  继续
                </Button>
              )}
              {active && run.state === 'PAUSED' && (
                <Button disabled={busy || undefined} onClick={() => control('step')}>
                  执行下一步
                </Button>
              )}
              {!model.view.closing && (active || run.state === 'QUEUED') && (
                <Button danger disabled={cancelBusy || undefined} onClick={() => control('cancel')}>
                  取消运行
                </Button>
              )}
              <Button onClick={connections}>查看连接状态</Button>
            </div>
          )}
          {controlFeedback}
          {model.terminal && (
            <>
              {!verified && (
                <p>再次执行需回到任务，重新选择窗口与原文并确认单次修改。未知结果应先人工核对。</p>
              )}
              <div className="ai-task-actions">
                <Button onClick={() => navigate('desktop-target')}>重新查看应用窗口</Button>
                <Button onClick={() => navigate('plan')}>返回任务方案</Button>
                <Button type="primary" onClick={() => navigate('home')}>
                  开始新任务
                </Button>
              </div>
            </>
          )}
          {page === 'details' ? (
            <>
              <DesktopRunReceipt
                runId={run.id}
                receipts={detail.desktopReceipts}
                snapshot={detail.snapshot}
              />
              <div className="desktop-task-record">
                <Descriptions
                  className="metadata-facts"
                  column={1}
                  bordered
                  size="small"
                  items={[
                    {
                      key: 'target',
                      label: '记录中的对象',
                      children: desktop.windowTitle
                        ? `文本编辑 / ${desktop.windowTitle} / 原选区`
                        : '本次记录未提供窗口名称',
                    },
                    { key: 'version', label: '执行方案', children: '按启动时保存的方案执行' },
                    {
                      key: 'state',
                      label: '运行记录',
                      children:
                        runDisplayLabels[run.state as keyof typeof runDisplayLabels] ?? run.state,
                    },
                    { key: 'elapsed', label: '已记录耗时', children: model.view.elapsed.label },
                  ]}
                />
                <p>记录只代表本次执行时的目标和回读，不代表当前窗口或文档仍然一致。</p>
              </div>
              <TaskExecutionSteps
                model={model}
                detail={detail}
                view={stepsView}
                change={setStepsView}
              />
              <RunEventLog runId={run.id} events={detail.events} snapshot={detail.snapshot} />
              <Button onClick={() => setPage('overview')}>返回应用结果</Button>
            </>
          ) : (
            <Button className="desktop-task-details" onClick={() => setPage('details')}>
              查看修改回执与执行记录
            </Button>
          )}
        </Card>
      </section>
      <div className="ai-task-actions">
        {!model.terminal && <Button onClick={() => navigate('plan')}>返回任务方案</Button>}
        <Button onClick={history}>运行记录</Button>
      </div>
      <p className="task-run-note">查看结果、返回或重新查看窗口不会重复执行修改。</p>
    </div>
  );
}
