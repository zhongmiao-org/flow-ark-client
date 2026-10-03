import TaskRunFailure from './TaskRunFailure';
import McpRunReceipts from './McpRunReceipts';
import type { LearningStatus } from '../shared/learning';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ArtifactPreview } from '../shared/artifact-preview';
import type { TaskRunIntent, TaskRunView } from './task-run-presentation';
import { artifactLabel, taskRunPresentation } from './task-run-presentation';
import { RunOutput } from './RunObservation';
import { runDisplayLabels } from '../shared/run-history';
import RunRerunPanel from './RunRerunPanel';
import TaskRepairPage from './TaskRepairPage';
import './task-run.css';
import TaskExecutionSteps, { type TaskExecutionView } from './TaskExecutionSteps';
import RunEventLog from './RunEventLog';
import TaskRunTarget from './TaskRunTarget';
import DesktopRunReceipt from './DesktopRunReceipt';
import DesktopTaskRun from './DesktopTaskRun';
import TaskRunSource from './TaskRunSource';

export type TaskRunReturnContext = {
  runId: string;
  page: TaskRunView;
  selected?: string;
  scroll: number;
  stepsView?: TaskExecutionView & { runId: string };
};

export default function TaskRunPage({
  detail,
  fault,
  page,
  setPage,
  navigate,
  history,
  connections,
  control,
  reveal,
  showBrowser,
  hideBrowser,
  open,
  restored,
}: {
  detail: any;
  fault?: string;
  page: TaskRunView;
  setPage: (page: TaskRunView) => void;
  navigate: (intent: TaskRunIntent) => void;
  history: () => void;
  connections: () => void;
  control: (id: string, action: string) => Promise<any>;
  reveal: (id: string) => Promise<any>;
  showBrowser: () => void;
  hideBrowser: () => void;
  open: (detail: any, context?: TaskRunReturnContext) => void;
  restored?: TaskRunReturnContext;
}) {
  const [, tick] = useState(0);
  const [learning, setLearning] = useState<LearningStatus>();
  const initial =
    restored && restored.runId === detail.run.id && restored.page === page ? restored : undefined;
  const [selected, setSelected] = useState<string | undefined>(initial?.selected);
  const [preview, setPreview] = useState<ArtifactPreview>();
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [stepsView, setStepsView] = useState<(TaskExecutionView & { runId: string }) | undefined>(
    initial?.stepsView,
  );
  const restoredPosition = useRef(initial);
  const lock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const detailScroll = useRef(0);
  const detailsButton = useRef<HTMLButtonElement>(null);
  const previousPage = useRef(page);
  const returnAction = useRef<string | undefined>(undefined);
  const previewButtons = useRef(new Map<string, HTMLButtonElement>());
  const rerunButton = useRef<HTMLButtonElement>(null);
  const model = taskRunPresentation({ ...detail, fault: detail.fault ?? fault });
  const target = (
    <TaskRunTarget
      run={detail.run}
      flow={detail.snapshot}
      node={model.node}
      context={detail.targetContext}
      historical={model.terminal || model.uncertain || model.view.closing}
      next={model.view.step.kind === 'paused'}
    />
  );
  const previousMode = useRef(model.mode);
  useLayoutEffect(() => {
    if (page === 'overview' && previousMode.current !== model.mode) {
      document.querySelector('main')?.scrollTo(0, 0);
      heading.current?.focus({ preventScroll: true });
    }
    previousMode.current = model.mode;
  }, [model.mode, page]);
  const run = detail.run;
  const openSource = (next: any) =>
    open(next, {
      runId: run.id,
      page,
      selected,
      scroll: document.querySelector('main')?.scrollTop ?? 0,
      stepsView,
    });
  const versionLabel =
    run.rerun?.mode === 'saved'
      ? '已保存方案快照'
      : run.rerun?.mode === 'snapshot'
        ? '原执行快照'
        : '固定方案快照';
  const item = model.artifacts.find((a) => a.artifactId === selected);
  const fileState = JSON.stringify(item);
  const visiblePreview =
    item?.available && item.integrity === 'verified' && preview?.artifactId === selected
      ? preview
      : undefined;
  useEffect(() => {
    let live = true,
      pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const value = await window.flowark.request('learning.status');
        if (live) setLearning(value);
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [run.id]);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  useLayoutEffect(() => {
    if (restoredPosition.current) {
      const position = restoredPosition.current;
      restoredPosition.current = undefined;
      document.querySelector('main')?.scrollTo(0, position.scroll);
      document
        .querySelector<HTMLButtonElement>('.task-run-source button')
        ?.focus({ preventScroll: true });
      return;
    }
    const returning = page === 'overview' && previousPage.current !== 'overview';
    document.querySelector('main')?.scrollTo(0, returning ? detailScroll.current : 0);
    if (returning) {
      const origin =
        returnAction.current === 'rerun'
          ? rerunButton.current
          : previewButtons.current.get(returnAction.current ?? '');
      (origin && !origin.disabled ? origin : detailsButton.current)?.focus({ preventScroll: true });
    } else heading.current?.focus({ preventScroll: true });
    previousPage.current = page;
  }, [run.id, page]);
  useEffect(() => {
    setPreviewError('');
    if (page !== 'details' || !selected) {
      setPreview(undefined);
      setLoading(false);
      return;
    }
    let live = true;
    setPreview(undefined);
    setError('');
    if (!item?.available || item.integrity !== 'verified') {
      setLoading(false);
      return;
    }
    setLoading(true);
    void window.flowark
      .request('artifact.preview', { id: selected })
      .then((value: ArtifactPreview) => {
        if (!live) return;
        if (value.artifactId !== selected) throw new Error('文件预览与所选产物不一致');
        setPreview(value);
      })
      .catch((e) => {
        if (live) setPreviewError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [page, run.id, selected, fileState, retry]);
  async function act(operation: () => Promise<any>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (e: any) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function inspect(id?: string) {
    detailScroll.current = document.querySelector('main')?.scrollTop ?? 0;
    returnAction.current = id;
    setSelected(id ?? (model.artifacts.length === 1 ? model.artifacts[0].artifactId : undefined));
    setPage('details');
  }
  const title =
    page === 'details'
      ? '结果详细信息'
      : page === 'rerun'
        ? '重新运行前，核对已完成操作'
        : model.title;
  const failed = run.state === 'FAILED' && !model.uncertain && !model.view.closing;
  const compactLive = !model.terminal && !model.uncertain && !model.view.closing;
  const linearPosition =
    compactLive &&
    model.current &&
    detail.snapshot?.steps.length === model.rows.length &&
    model.rows.every(
      (row) => row.instance === row.nodeId && !['condition', 'loop'].includes(row.type ?? ''),
    )
      ? `${model.view.step.kind === 'paused' ? '下一步' : '第'} ${model.rows.indexOf(model.current) + 1} / ${model.rows.length}${model.view.step.kind === 'paused' ? '' : ' 步'}`
      : undefined;
  const stepNames = (rows: typeof model.rows, empty: string) =>
    rows
      .slice(0, 6)
      .map((row) => row.name)
      .join('、') + (rows.length > 6 ? ` 等 ${rows.length} 条，完整记录见执行步骤。` : '') || empty;
  const allowed = model.view.activity === 'active' && !model.view.closing && !model.uncertain;
  const steps = (
    <TaskExecutionSteps
      key={run.id}
      model={model}
      compact={compactLive && page === 'overview'}
      snapshot={detail.snapshot}
      view={stepsView?.runId === run.id ? stepsView : undefined}
      change={(view) => setStepsView({ ...view, runId: run.id })}
    />
  );
  const previewButton = (a: (typeof model.artifacts)[number]) => (
    <button
      ref={(element) => {
        if (element) previewButtons.current.set(a.artifactId, element);
        else previewButtons.current.delete(a.artifactId);
      }}
      className="primary"
      aria-label={`预览文件：${a.name}`}
      disabled={!a.available || a.integrity !== 'verified'}
      onClick={() => inspect(a.artifactId)}
    >
      预览文件
    </button>
  );
  const singleResultFile = model.success && page === 'overview' && model.artifacts.length === 1;
  const fileCards = (
    <>
      {model.artifacts.map((a) => (
        <section
          className={'task-run-file' + (singleResultFile ? ' task-run-single-file' : '')}
          aria-label={`文件产物：${a.name}`}
          key={a.artifactId}
          data-artifact-id={a.artifactId}
        >
          <h3>{a.name}</h3>
          <p>
            {a.size.toLocaleString('zh-CN')} 字节 · {artifactLabel(a)}
          </p>
          {!singleResultFile && (
            <details>
              <summary>保存位置</summary>
              <p className="task-run-path">{a.path}</p>
              <button
                disabled={!a.available || busy}
                onClick={() => void act(() => reveal(a.artifactId))}
              >
                定位文件
              </button>
            </details>
          )}
          {!singleResultFile && <div className="ai-task-actions">{previewButton(a)}</div>}
        </section>
      ))}
      {!model.artifacts.length && <p>本次尚无已登记的文件产物，可查看步骤输出。</p>}
    </>
  );
  const canRepair =
    !!run.task?.id &&
    model.terminal &&
    !model.success &&
    !model.uncertain &&
    !model.view.closing &&
    model.node?.type === 'browser' &&
    model.node.version !== 1 &&
    model.node.operation !== 'navigate' &&
    !!model.node.selector;
  const actions = (
    <>
      {canRepair && (
        <>
          <button className="primary" onClick={() => setPage('repair')}>
            重新选择网页目标
          </button>
          <button onClick={() => setPage('repair')}>让 AI 提议修复</button>
        </>
      )}
      <button className={canRepair ? undefined : 'primary'} onClick={() => navigate('modify')}>
        {model.success ? '告诉 AI 怎么改' : '修改需求与方案'}
      </button>
      {!model.success && <button onClick={() => navigate('plan')}>手动检查步骤</button>}
      {model.terminal && (
        <button
          ref={rerunButton}
          onClick={() => {
            detailScroll.current = document.querySelector('main')?.scrollTop ?? 0;
            returnAction.current = 'rerun';
            setPage('rerun');
          }}
        >
          {model.success ? '再次运行前检查' : '核对后重新运行'}
        </button>
      )}
      {model.success ? (
        <details className="task-run-next-help">
          <summary>修改与再次运行说明</summary>
          <p>修改先保存为草稿。重新执行需确认版本和已完成操作，从第一个步骤创建新的运行。</p>
        </details>
      ) : (
        <p>修改先保存为草稿。重新执行需确认版本和已完成操作，从第一个步骤创建新的运行。</p>
      )}
    </>
  );
  if (model.desktop)
    return (
      <DesktopTaskRun
        detail={{ ...detail, fault: detail.fault ?? fault }}
        model={model}
        page={page}
        setPage={setPage}
        navigate={navigate}
        history={history}
        connections={connections}
        busy={busy}
        error={error}
        control={(action) => void act(() => control(run.id, action))}
      />
    );
  return (
    <div className="task-run-page" data-task-run-id={run.id} data-task-run-mode={model.mode}>
      <div className="task-run-content" hidden={page === 'repair'}>
        <div className="page-heading">
          <div>
            <h1 ref={heading} tabIndex={-1}>
              {title}
            </h1>
            <p>
              {model.success && page === 'overview' ? (
                <>
                  运行 {run.id} · 已完成 · {model.completed.length} 次步骤已确认完成
                </>
              ) : (
                <>
                  {run.name} · 本次执行 {run.id} · {versionLabel}
                  {run.task && ` · 任务修订 ${run.task.revision}`}
                  {run.rerun && page === 'overview' && (
                    <>
                      {' '}
                      · <TaskRunSource key={run.id} run={run} open={openSource} />
                    </>
                  )}
                </>
              )}
            </p>
          </div>
        </div>
        {learning?.taskId && learning.taskId === run.task?.id && (
          <p className="task-run-note" role="status" aria-label="教学进度">
            {learning.status === 'completed'
              ? '已完成第一次学习 · 已找到并预览真实结果。'
              : '学习：已尝试运行。成功后预览文本文件，完成“找结果”；执行状态以下方记录为准。'}
          </p>
        )}
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        {model.view.statusNote && (
          <p className="task-run-note" role="status">
            {model.view.statusNote}
          </p>
        )}
        <McpRunReceipts
          runId={run.id}
          receipts={detail.mcpReceipts}
          snapshot={detail.snapshot}
          running={!model.terminal && model.view.activity === 'active'}
        />
        <DesktopRunReceipt
          runId={run.id}
          receipts={detail.desktopReceipts}
          snapshot={detail.snapshot}
        />
        {page === 'rerun' ? (
          <section className="ai-task-card task-run-restart">
            <h2>已完成操作不会被隐藏</h2>
            <p>
              {model.summary}。{model.effectNote}
            </p>
            <RunRerunPanel
              key={run.id}
              run={run}
              related={detail.rerun}
              open={open}
              initialMode="saved"
            />
            <button onClick={() => setPage('overview')}>先不运行，返回结果</button>
          </section>
        ) : page === 'details' ? (
          <div className="task-run-columns task-run-details">
            <section className="ai-task-card task-run-preview" aria-label="文件与结构化输出">
              <h2>{item ? `${item.name} · 文件预览` : '文件预览'}</h2>
              {model.artifacts.length > 1 && (
                <>
                  <label htmlFor="task-artifact">选择本次文件</label>
                  <select
                    id="task-artifact"
                    value={selected ?? ''}
                    onChange={(e) => setSelected(e.target.value || undefined)}
                  >
                    <option value="">请选择文件</option>
                    {model.artifacts.map((a) => (
                      <option key={a.artifactId} value={a.artifactId}>
                        {a.name} · {artifactLabel(a)}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <div className="task-file-content">
                <p>
                  文件内容
                  {visiblePreview?.status === 'text' && visiblePreview.truncated
                    ? ' · 内容已截断'
                    : ''}
                </p>
                {loading ? (
                  <p role="status">正在读取并核对文件副本…</p>
                ) : visiblePreview?.status === 'text' ? (
                  <>
                    <pre
                      className="task-file-preview"
                      tabIndex={0}
                      aria-label={`文件内容：${visiblePreview.name}`}
                      data-artifact-preview={visiblePreview.artifactId}
                    >
                      {visiblePreview.text || '（空文件）'}
                    </pre>
                  </>
                ) : selected ? (
                  <p
                    role={previewError ? 'alert' : 'status'}
                    className={previewError ? 'field-error' : undefined}
                  >
                    {previewError ||
                      (preview?.status === 'unavailable'
                        ? preview.reason
                        : item
                          ? artifactLabel(item)
                          : '该产物不在本次记录中')}
                  </p>
                ) : (
                  <p>
                    {model.artifacts.length
                      ? '选择文件后只读预览，不会执行其中的内容。'
                      : '本次没有登记的文件产物，可查看下方已保存的结构化输出。'}
                  </p>
                )}
              </div>
              <RunOutput detail={detail} layout="task" />
            </section>
            <section className="ai-task-card task-run-evidence" aria-label="执行证据">
              <h2>执行证据</h2>
              <dl className="task-run-evidence-summary">
                <div>
                  <dt className="sr-only">运行标识</dt>
                  <dd className="task-run-path">
                    {run.id}
                    {run.rerun && (
                      <>
                        {' · '}
                        <TaskRunSource key={run.id} run={run} open={openSource} />
                      </>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="sr-only">执行步骤</dt>
                  <dd>{model.completed.length} 次步骤已确认完成</dd>
                </div>
                <div>
                  <dt className="sr-only">文件产物</dt>
                  <dd>
                    {model.artifacts.length} 个文件产物 · {model.verified.length} 个副本已核对
                  </dd>
                </div>
                <div>
                  <dt className="sr-only">待核对步骤</dt>
                  <dd>
                    {model.unresolved.length} 次未确认完成 · {model.unvisited.length}{' '}
                    个尚未执行（含未选分支）
                  </dd>
                </div>
              </dl>
              {run.error && <p className="field-error">{run.error}</p>}
              <button className="primary" onClick={() => setPage('overview')}>
                返回结果摘要
              </button>
              <details className="task-run-record-info">
                <summary>运行状态与耗时</summary>
                <dl>
                  <div>
                    <dt>记录状态</dt>
                    <dd>{runDisplayLabels[run.state as keyof typeof runDisplayLabels]}</dd>
                  </div>
                  <div>
                    <dt>已记录耗时</dt>
                    <dd>{model.view.elapsed.label}</dd>
                  </div>
                </dl>
                <p>输出为已保存的脱敏内容；业务结果请结合回执核对。</p>
              </details>
              {selected && (
                <details className="task-run-file-info">
                  <summary>文件信息与保存位置</summary>
                  {visiblePreview?.status === 'text' && (
                    <p>已核对保存的副本 · 纯文本预览，已按当前脱敏规则处理</p>
                  )}
                  {item && (
                    <>
                      <p>
                        {item.size.toLocaleString('zh-CN')} 字节 · {artifactLabel(item)}
                      </p>
                      <p className="task-run-path">{item.path}</p>
                    </>
                  )}
                  <div className="ai-task-actions">
                    <button disabled={loading} onClick={() => setRetry((n) => n + 1)}>
                      重新读取预览
                    </button>
                    {item && (
                      <button
                        disabled={!item.available || busy}
                        onClick={() => void act(() => reveal(item.artifactId))}
                      >
                        定位文件
                      </button>
                    )}
                  </div>
                </details>
              )}
              <details className="task-run-fixed-evidence">
                <summary>固定版本与已记录影响</summary>
                <p className="task-run-path">版本：{run.versionId}</p>
                <p>
                  {versionLabel}
                  {run.task && ` · 任务修订 ${run.task.revision}`}
                </p>
                {run.rerun && <p>本次从第一步创建独立运行，原运行的结果与产物保持保留。</p>}
                <p>{model.effectNote}</p>
                {target}
              </details>
              <details>
                <summary>步骤回执与脱敏日志</summary>
                <RunEventLog
                  key={run.id}
                  runId={run.id}
                  events={detail.events}
                  snapshot={detail.snapshot}
                />
              </details>
              <details className="task-run-outline">
                <summary>查看本次执行步骤</summary>
                {steps}
              </details>
            </section>
          </div>
        ) : model.success ? (
          <>
            <section className="task-run-banner" aria-label="运行结果摘要">
              <h2>
                <span aria-hidden="true">✓ </span>
                {model.summary}
              </h2>
              <p>{model.effectNote}</p>
            </section>
            <div className="task-run-columns task-run-result">
              <section className="ai-task-card">
                <h2>结果在哪里</h2>
                {fileCards}
                <div className="ai-task-actions task-run-result-actions">
                  {singleResultFile && previewButton(model.artifacts[0])}
                  <button ref={detailsButton} onClick={() => inspect()}>
                    详细信息
                  </button>
                </div>
                <p>
                  未确认完成：{model.unresolved.length} 次。
                  <br />
                  尚未执行：{model.unvisited.length} 个（包含未选分支）。
                </p>
              </section>
              <section className="ai-task-card task-run-next">
                <h2>继续完善这个任务</h2>
                <p>描述你想调整的内容，先查看修改方案，再决定是否执行。</p>
                {actions}
              </section>
            </div>
          </>
        ) : (
          <div
            className={
              'task-run-columns ' +
              (model.terminal || model.uncertain ? 'task-run-stopped' : 'task-run-live') +
              (failed ? ' task-run-failed' : '')
            }
          >
            <section className="ai-task-card">
              {failed ? (
                <TaskRunFailure model={model} error={run.error ?? ''} target={target} />
              ) : (
                <>
                  <span className={'badge state-' + (model.uncertain ? 'INTERRUPTED' : run.state)}>
                    {model.uncertain
                      ? '需要核对'
                      : runDisplayLabels[run.state as keyof typeof runDisplayLabels]}
                    {linearPosition && ` · ${linearPosition}`}
                  </span>
                  <h2 className="task-run-current">
                    {model.current?.name ?? model.view.step.label}
                  </h2>
                  {target}
                  {run.error && (
                    <p className="field-error" role="alert">
                      {run.error}
                    </p>
                  )}
                  {compactLive ? (
                    <div className="task-run-progress" aria-label="当前运行进度">
                      <dl>
                        <div>
                          <dt>已完成</dt>
                          <dd>{stepNames(model.completed, '尚无完成记录')}</dd>
                        </div>
                        <div>
                          <dt>{model.view.step.kind === 'paused' ? '下一步' : '当前'}</dt>
                          <dd>{model.view.step.label}</dd>
                        </div>
                        <div>
                          <dt>尚未执行</dt>
                          <dd>{stepNames(model.unvisited, '无尚未执行的步骤记录')}</dd>
                        </div>
                      </dl>
                      {model.node?.type === 'human' && (
                        <p className="task-run-human-prompt">需要你确认：{model.node.message}</p>
                      )}
                      <p>已记录耗时：{model.view.elapsed.label}</p>
                      {model.view.progress.kind === 'reported' && (
                        <p>{model.view.progress.label}</p>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="task-run-file">
                        <h3>{model.node?.type === 'human' ? '需要你确认' : '当前步骤'}</h3>
                        <p>
                          {model.node?.type === 'human'
                            ? model.node.message
                            : model.view.step.label}
                        </p>
                        <p>已记录耗时：{model.view.elapsed.label}</p>
                        {model.view.progress.kind === 'reported' && (
                          <p>{model.view.progress.label}</p>
                        )}
                      </div>
                      <div className="task-run-file">
                        <h3>已完成</h3>
                        <p>
                          {model.completed
                            .slice(0, 6)
                            .map((r) => r.name)
                            .join('、') || '尚无完成记录'}
                          {model.completed.length > 6 &&
                            ` 等 ${model.completed.length} 次，完整记录见执行步骤。`}
                        </p>
                      </div>
                      <div className="task-run-file">
                        <h3>尚未完成或未执行</h3>
                        <p>
                          {[...model.unresolved, ...model.unvisited]
                            .slice(0, 6)
                            .map((r) => r.name)
                            .join('、') || '无未完成步骤记录'}
                          {model.unresolved.length + model.unvisited.length > 6 &&
                            ` 等 ${model.unresolved.length + model.unvisited.length} 条，完整记录见执行步骤。`}
                        </p>
                      </div>
                      <div className="task-run-file">
                        <h3>影响范围</h3>
                        <p>{model.summary}</p>
                        <p>{model.effectNote}</p>
                      </div>
                    </>
                  )}
                </>
              )}
              <div className="ai-task-actions">
                {allowed && run.state === 'RUNNING' && (
                  <button disabled={busy} onClick={() => void act(() => control(run.id, 'pause'))}>
                    请求暂停
                  </button>
                )}
                {allowed && ['PAUSED', 'WAITING_INPUT'].includes(run.state) && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void act(() => control(run.id, 'resume'))}
                  >
                    继续
                  </button>
                )}
                {allowed && run.state === 'PAUSED' && (
                  <button disabled={busy} onClick={() => void act(() => control(run.id, 'step'))}>
                    执行下一步
                  </button>
                )}
                {!model.terminal &&
                  !model.view.closing &&
                  !model.uncertain &&
                  (allowed || run.state === 'QUEUED') && (
                    <button
                      disabled={busy}
                      className="danger"
                      onClick={() => void act(() => control(run.id, 'cancel'))}
                    >
                      取消运行
                    </button>
                  )}
                {model.rows.some((r) => r.type === 'browser') && (
                  <button onClick={showBrowser}>查看当前网页</button>
                )}
                <button ref={detailsButton} onClick={() => inspect()}>
                  详细信息
                </button>
              </div>
              {compactLive && (
                <details className="task-run-live-impact">
                  <summary>已记录的操作与影响</summary>
                  <p>{model.summary}</p>
                  <p>{model.effectNote}</p>
                  <p>尚未执行的清单包含未选择的分支；循环次数由运行时数据决定。</p>
                </details>
              )}
            </section>
            {model.terminal || model.uncertain ? (
              <section className="ai-task-card task-run-next">
                <h2>下一步可以这样做</h2>
                {actions}
                <details>
                  <summary>查看执行步骤</summary>
                  {steps}
                </details>
              </section>
            ) : (
              steps
            )}
          </div>
        )}
        {page !== 'details' && (
          <>
            <div className="ai-task-actions task-run-footer">
              <button onClick={() => navigate('plan')}>回到任务</button>
              <button onClick={history}>运行记录</button>
              <button onClick={() => navigate('home')}>回到开始</button>
            </div>
            <p className="task-run-note">
              返回、查看结果和修改草稿不会重复执行；未知的外部结果请先核对。
            </p>
          </>
        )}
      </div>
      {run.task?.id && (
        <TaskRepairPage
          active={page === 'repair'}
          taskId={run.task.id}
          runDetail={detail}
          back={() => setPage('overview')}
          browser={(visible) => (visible ? showBrowser() : hideBrowser())}
          open={open}
          modify={() => navigate('modify')}
        />
      )}
    </div>
  );
}
