import { useLayoutEffect, useRef, useState } from 'react';
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
  control,
  busy,
  error,
}: {
  detail: any;
  model: ReturnType<typeof taskRunPresentation>;
  page: TaskRunView;
  setPage: (page: TaskRunView) => void;
  navigate: (intent: TaskRunIntent) => void;
  history: () => void;
  control: (action: string) => void;
  busy: boolean;
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
  const verified = desktop.phase === 'verified';
  const title =
    page === 'details'
      ? '应用修改详细信息'
      : model.view.closing
        ? '正在完成应用试运行收尾'
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
          <p>
            {run.name} · 应用任务 {run.id} · 固定方案快照
          </p>
        </div>
      </div>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <section className="ai-task-card desktop-task-run-panel" aria-label="应用执行与结果">
        <div className="desktop-task-run-status">
          <span className={'badge state-' + (model.uncertain ? 'INTERRUPTED' : run.state)}>
            {model.uncertain
              ? '结果待核对'
              : (runDisplayLabels[run.state as keyof typeof runDisplayLabels] ?? run.state)}
          </span>
          <span>
            运行记录：{runDisplayLabels[run.state as keyof typeof runDisplayLabels] ?? run.state} ·
            已记录耗时：{model.view.elapsed.label}
          </span>
        </div>
        <h2>{verified ? '修改了已核对的原选区' : desktop.title}</h2>
        <div className="task-run-file">
          <h3>{model.terminal ? '记录中的对象' : '当前对象'}</h3>
          <p>
            {desktop.windowTitle
              ? `文本编辑 / ${desktop.windowTitle} / 原选区`
              : '本次记录没有提供窗口名称，请核对原应用窗口。'}
          </p>
          <p>这里显示本次运行的固定目标，不代表当前窗口或选区仍然一致。</p>
        </div>
        {model.view.statusNote && <p role="status">{model.view.statusNote}</p>}
        {detail.fault && (
          <p role="alert" className="field-error">
            {detail.fault}
          </p>
        )}
        {run.error && (
          <p role="alert" className="field-error">
            {run.error}
          </p>
        )}
        <p role={desktop.needsReview ? 'alert' : 'status'}>{desktop.effect}</p>
        {verified && (
          <>
            <div className="desktop-task-readback">
              <h3>本次回读内容</h3>
              <pre tabIndex={0} aria-label="本次回读内容">
                {desktop.receipt!.readback}
              </pre>
            </div>
            <p>结果仍在原文档中，请在文本编辑中查看并按需要保存。此处不会自动刷新后续编辑。</p>
            {!model.success && (
              <p>文字回读与运行整体状态分别记录；请同时核对上方取消、中断、收尾或异常提示。</p>
            )}
          </>
        )}
        {!model.terminal && (
          <div className="ai-task-actions">
            {active && run.state === 'RUNNING' && (
              <button disabled={busy} onClick={() => control('pause')}>
                请求暂停
              </button>
            )}
            {active && ['PAUSED', 'WAITING_INPUT'].includes(run.state) && (
              <button className="primary" disabled={busy} onClick={() => control('resume')}>
                继续
              </button>
            )}
            {active && run.state === 'PAUSED' && (
              <button disabled={busy} onClick={() => control('step')}>
                执行下一步
              </button>
            )}
            {!model.view.closing && (active || run.state === 'QUEUED') && (
              <button className="danger" disabled={busy} onClick={() => control('cancel')}>
                取消运行
              </button>
            )}
          </div>
        )}
        {page === 'details' ? (
          <>
            <DesktopRunReceipt
              runId={run.id}
              receipts={detail.desktopReceipts}
              snapshot={detail.snapshot}
            />
            <p className="task-run-path">固定版本：{run.versionId}</p>
            <TaskExecutionSteps model={model} view={stepsView} change={setStepsView} />
            <RunEventLog runId={run.id} events={detail.events} snapshot={detail.snapshot} />
            <button onClick={() => setPage('overview')}>返回应用结果</button>
          </>
        ) : (
          <button className="desktop-task-details" onClick={() => setPage('details')}>
            查看修改回执与执行记录
          </button>
        )}
        {model.terminal && (
          <>
            <p>再次执行需回到任务，重新选择窗口与原文并确认单次修改。未知结果应先人工核对。</p>
            <div className="ai-task-actions">
              <button onClick={() => navigate('desktop-target')}>重新查看应用窗口</button>
              <button onClick={() => navigate('plan')}>返回任务方案</button>
              <button className="primary" onClick={() => navigate('home')}>
                开始新任务
              </button>
            </div>
          </>
        )}
      </section>
      <div className="ai-task-actions">
        {!model.terminal && <button onClick={() => navigate('plan')}>返回任务方案</button>}
        <button onClick={history}>运行记录</button>
      </div>
      <p className="task-run-note">查看结果、返回或重新查看窗口不会重复执行修改。</p>
    </div>
  );
}
