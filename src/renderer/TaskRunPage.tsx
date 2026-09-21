import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ArtifactPreview } from '../shared/artifact-preview';
import type { TaskRunIntent, TaskRunView } from './task-run-presentation';
import { artifactLabel, taskRunPresentation } from './task-run-presentation';
import { RunOutput } from './RunObservation';
import { runDisplayLabels } from '../shared/run-history';
import RunRerunPanel from './RunRerunPanel';
import './task-run.css';

export default function TaskRunPage({
  detail,
  fault,
  page,
  setPage,
  navigate,
  history,
  control,
  reveal,
  showBrowser,
  open,
}: {
  detail: any;
  fault?: string;
  page: TaskRunView;
  setPage: (page: TaskRunView) => void;
  navigate: (intent: TaskRunIntent) => void;
  history: () => void;
  control: (id: string, action: string) => Promise<any>;
  reveal: (id: string) => Promise<any>;
  showBrowser: () => void;
  open: (detail: any) => void;
}) {
  const [, tick] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [preview, setPreview] = useState<ArtifactPreview>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const lock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const detailScroll = useRef(0);
  const detailsButton = useRef<HTMLButtonElement>(null);
  const previousPage = useRef(page);
  const model = taskRunPresentation({ ...detail, fault: detail.fault ?? fault });
  const previousMode = useRef(model.mode);
  useLayoutEffect(() => {
    if (page === 'overview' && previousMode.current !== model.mode) {
      document.querySelector('main')?.scrollTo(0, 0);
      heading.current?.focus({ preventScroll: true });
    }
    previousMode.current = model.mode;
  }, [model.mode, page]);
  const run = detail.run;
  const item = model.artifacts.find((a) => a.artifactId === selected);
  const fileState = JSON.stringify(item);
  const visiblePreview =
    item?.available && item.integrity === 'verified' && preview?.artifactId === selected
      ? preview
      : undefined;
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  useLayoutEffect(() => {
    const returning = page === 'overview' && previousPage.current !== 'overview';
    document.querySelector('main')?.scrollTo(0, returning ? detailScroll.current : 0);
    if (returning) detailsButton.current?.focus({ preventScroll: true });
    else heading.current?.focus({ preventScroll: true });
    previousPage.current = page;
  }, [run.id, page]);
  useEffect(() => {
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
        if (live) setError(e.message);
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
    setSelected(id);
    setPage('details');
  }
  const title =
    page === 'details'
      ? '结果详细信息'
      : page === 'rerun'
        ? '重新运行前，核对已完成操作'
        : model.title;
  const allowed = model.view.activity === 'active' && !model.view.closing && !model.uncertain;
  const steps = (
    <section className="ai-task-card task-run-steps" aria-label="执行步骤">
      <h2>执行步骤</h2>
      <p>
        {model.completed.length} 次已完成 · {model.unresolved.length} 次已开始未确认完成 ·{' '}
        {model.unvisited.length} 个尚未执行
      </p>
      <ol>
        {model.rows.map((row, index) => (
          <li key={row.instance} aria-current={row.current ? 'step' : undefined}>
            <span className="task-run-index">{String(index + 1).padStart(2, '0')}</span>
            <div>
              <strong>{row.name}</strong>
              <p>
                <span className={'run-status run-tone-' + row.tone}>{row.label}</span>
              </p>
              {row.instance !== row.nodeId && <small>循环/分支位置：{row.instance}</small>}
            </div>
          </li>
        ))}
      </ol>
      {!model.rows.length && <p>尚无已保存的执行步骤。</p>}
      <p className="task-run-note">条件中未选择的分支保持未执行；循环按每次实际执行记录。</p>
    </section>
  );
  const fileCards = (
    <>
      {model.artifacts.map((a) => (
        <div className="task-run-file" key={a.artifactId} data-artifact-id={a.artifactId}>
          <h3>{a.name}</h3>
          <p>
            {a.size.toLocaleString('zh-CN')} 字节 · {artifactLabel(a)}
          </p>
          <details>
            <summary>保存位置</summary>
            <p className="task-run-path">{a.path}</p>
          </details>
          <div className="ai-task-actions">
            <button
              className="primary"
              disabled={!a.available || a.integrity !== 'verified'}
              onClick={() => inspect(a.artifactId)}
            >
              预览文件
            </button>
            <button
              disabled={!a.available || busy}
              onClick={() => void act(() => reveal(a.artifactId))}
            >
              定位文件
            </button>
          </div>
        </div>
      ))}
      {!model.artifacts.length && <p>本次尚无已登记的文件产物，可查看步骤输出。</p>}
    </>
  );
  const actions = (
    <>
      <button className="primary" onClick={() => navigate('modify')}>
        {model.success ? '告诉 AI 怎么改' : '修改需求与方案'}
      </button>
      <button onClick={() => navigate('plan')}>手动检查步骤</button>
      {model.terminal && (
        <button onClick={() => setPage('rerun')}>
          {model.success ? '再次运行前检查' : '核对后重新运行'}
        </button>
      )}
      <p>修改先保存为草稿。重新执行需确认版本和已完成操作，从第一个步骤创建新的运行。</p>
    </>
  );
  return (
    <div className="task-run-page" data-task-run-id={run.id} data-task-run-mode={model.mode}>
      <div className="page-heading">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {title}
          </h1>
          <p>
            {run.name} · 运行 {run.id} · 固定方案快照
          </p>
        </div>
      </div>
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
          <section className="ai-task-card">
            <h2>文件预览</h2>
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
            {loading ? (
              <p role="status">正在读取并核对文件副本…</p>
            ) : visiblePreview?.status === 'text' ? (
              <>
                <p>
                  已核对保存的副本 · 纯文本预览，已按当前脱敏规则处理
                  {visiblePreview.truncated ? ' · 内容已截断' : ''}
                </p>
                <pre
                  className="task-file-preview"
                  data-artifact-preview={visiblePreview.artifactId}
                >
                  {visiblePreview.text || '（空文件）'}
                </pre>
              </>
            ) : selected ? (
              <p role="status">
                {preview?.status === 'unavailable'
                  ? preview.reason
                  : item
                    ? artifactLabel(item)
                    : '该产物不在本次记录中'}
              </p>
            ) : (
              <p>选择文件后只读预览，不会执行其中的内容。</p>
            )}
            {selected && (
              <button disabled={loading} onClick={() => setRetry((n) => n + 1)}>
                重新读取预览
              </button>
            )}
            <RunOutput detail={detail} />
          </section>
          <section className="ai-task-card">
            <h2>执行证据</h2>
            <p>{model.summary}</p>
            <p>状态：{runDisplayLabels[run.state as keyof typeof runDisplayLabels]}</p>
            <p>已记录耗时：{model.view.elapsed.label}</p>
            <p className="task-run-path">版本：{run.versionId}</p>
            {run.error && <p className="field-error">{run.error}</p>}
            <details>
              <summary>步骤回执与脱敏日志</summary>
              {detail.events
                .filter((e: any) => e.runId === run.id)
                .map((e: any) => (
                  <details key={e.sequence}>
                    <summary>
                      {e.nodeInstance || '运行'} · {e.type}
                    </summary>
                    <pre>{JSON.stringify(e.data, null, 2)}</pre>
                  </details>
                ))}
            </details>
            <button className="primary" onClick={() => setPage('overview')}>
              返回结果摘要
            </button>
            {fileCards}
          </section>
        </div>
      ) : model.success ? (
        <>
          <section className="task-run-banner">
            <h2>{model.summary}</h2>
            <p>{model.effectNote}</p>
          </section>
          <div className="task-run-columns task-run-result">
            <section className="ai-task-card">
              <h2>结果在哪里</h2>
              {fileCards}
              <button ref={detailsButton} onClick={() => inspect()}>
                详细信息
              </button>
              <p>
                未确认完成的步骤：{model.unresolved.length} 次。尚未执行：{model.unvisited.length}{' '}
                个（包含未选分支）。
              </p>
            </section>
            <section className="ai-task-card">
              <h2>继续完善这个任务</h2>
              {actions}
            </section>
          </div>
          <details className="task-run-outline">
            <summary>查看本次执行步骤</summary>
            {steps}
          </details>
        </>
      ) : (
        <div
          className={
            'task-run-columns ' +
            (model.terminal || model.uncertain ? 'task-run-stopped' : 'task-run-live')
          }
        >
          <section className="ai-task-card">
            <span className={'badge state-' + (model.uncertain ? 'INTERRUPTED' : run.state)}>
              {model.uncertain
                ? '需要核对'
                : runDisplayLabels[run.state as keyof typeof runDisplayLabels]}
            </span>
            <h2 className="task-run-current">{model.current?.name ?? model.view.step.label}</h2>
            {run.error && (
              <p className="field-error" role="alert">
                {run.error}
              </p>
            )}
            <div className="task-run-file">
              <h3>{model.node?.type === 'human' ? '需要你确认' : '当前步骤'}</h3>
              <p>{model.node?.type === 'human' ? model.node.message : model.view.step.label}</p>
              <p>已记录耗时：{model.view.elapsed.label}</p>
              {model.view.progress.kind === 'reported' && <p>{model.view.progress.label}</p>}
            </div>
            <div className="task-run-file">
              <h3>已完成</h3>
              <p>{model.completed.map((r) => r.name).join('、') || '尚无完成记录'}</p>
            </div>
            <div className="task-run-file">
              <h3>尚未完成或未执行</h3>
              <p>
                {[...model.unresolved, ...model.unvisited].map((r) => r.name).join('、') ||
                  '无未完成步骤记录'}
              </p>
            </div>
            <div className="task-run-file">
              <h3>影响范围</h3>
              <p>{model.summary}</p>
              <p>{model.effectNote}</p>
            </div>
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
          </section>
          {model.terminal || model.uncertain ? (
            <section className="ai-task-card">
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
      <div className="ai-task-actions task-run-footer">
        <button onClick={() => navigate('plan')}>回到任务</button>
        <button onClick={history}>运行记录</button>
        <button onClick={() => navigate('home')}>回到开始</button>
      </div>
      <p className="task-run-note">
        返回、查看结果和修改草稿不会重复执行；未知的外部结果请先核对。
      </p>
    </div>
  );
}
