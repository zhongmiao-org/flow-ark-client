import { useEffect, useId, useRef, useState } from 'react';
import type { Run } from '../shared/types';
import type {
  RunRerunConfirmInput,
  RunRerunDetails,
  RunRerunMode,
  RunRerunPreview,
} from '../shared/run-rerun';
import { runStateLabels } from '../shared/run-history';
import './run-rerun-layout.css';

const api = (method: string, args: unknown) => window.flowark.request(method, args);
const modes = { snapshot: '原执行快照', saved: '当前已保存流程' };
const names = (values: string[]) => values.join('、') || '无';
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export default function RunRerunPanel({
  run,
  related,
  open,
  initialMode = 'snapshot',
  page = false,
  active = true,
  cancel,
  busyChanged,
  inspectSource,
}: {
  run: Run;
  related?: RunRerunDetails;
  open: (detail: any) => void;
  initialMode?: RunRerunMode;
  page?: boolean;
  active?: boolean;
  cancel?: () => void;
  busyChanged?: (busy: boolean) => void;
  inspectSource?: (tab: 'output' | 'logs') => void;
}) {
  const activeRef = useRef(active);
  activeRef.current = active;
  const choiceId = useId();
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const previewRegion = useRef<HTMLFormElement>(null);
  const errorPanel = useRef<HTMLParagraphElement>(null);
  const [mode, setMode] = useState<RunRerunMode>(initialMode);
  const [debug, setDebug] = useState(false);
  const [preview, setPreview] = useState<RunRerunPreview>();
  const [reviewed, setReviewed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [retry, setRetry] = useState(false);
  const [created, setCreated] = useState<Run>();
  const [opening, setOpening] = useState<string>();
  const [error, setError] = useState('');
  const live = useRef(true);
  const generation = useRef(0);
  const sending = useRef(false);
  const attempt = useRef<RunRerunConfirmInput | undefined>(undefined);
  const previewButton = useRef<HTMLButtonElement>(null);
  const createdButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    busyChanged?.(submitting && active);
    return () => busyChanged?.(false);
  }, [submitting, busyChanged, active]);
  const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(run.state);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (preview && active) (page ? previewRegion.current : previewHeading.current)?.focus();
  }, [preview, active, page]);
  useEffect(() => {
    if (active && created && !submitting && !opening) createdButton.current?.focus();
  }, [created, submitting, opening, active]);
  useEffect(() => {
    if (error && active) errorPanel.current?.focus();
  }, [error, active]);
  const current = (id: number) => live.current && generation.current === id;
  const reset = (preserveCreated = false) => {
    generation.current++;
    attempt.current = undefined;
    setPreview(undefined);
    setReviewed(false);
    setLoading(false);
    setRetry(false);
    if (!preserveCreated) setCreated(undefined);
    setOpening(undefined);
    setError('');
  };
  const leave = () => {
    if (sending.current) return;
    if (cancel) {
      reset(true);
      cancel();
    } else {
      reset();
      previewButton.current?.focus();
    }
  };
  const load = async () => {
    if (sending.current || !related?.available) return;
    reset();
    const id = generation.current;
    setLoading(true);
    try {
      const result: RunRerunPreview = await api('run.rerun.preview', {
        id: run.id,
        mode,
        debug,
      });
      if (current(id)) setPreview(result);
    } catch (error) {
      if (current(id)) setError(message(error));
    } finally {
      if (current(id)) setLoading(false);
    }
  };
  const inspect = async (runId: string) => {
    if (sending.current) return;
    reset(true);
    const id = generation.current;
    setOpening(runId);
    try {
      const detail = await api('run.detail', { id: runId });
      if (current(id) && activeRef.current) open(detail);
    } catch (error) {
      if (current(id)) setError(message(error));
    } finally {
      if (current(id)) setOpening(undefined);
    }
  };
  const confirm = async () => {
    if (!preview || !reviewed || sending.current || (!related?.available && !attempt.current))
      return;
    // Keep exactly this payload after an uncertain reply; a retry uses the same request ID.
    const request =
      attempt.current ??
      (attempt.current = {
        id: run.id,
        mode: preview.mode,
        debug: preview.debug,
        token: preview.token,
        requestId: crypto.randomUUID(),
        reviewed: true,
      });
    const id = ++generation.current;
    sending.current = true;
    setSubmitting(true);
    setRetry(false);
    setError('');
    try {
      const next: Run = await api('run.rerun.confirm', request);
      if (!current(id)) return;
      attempt.current = undefined;
      setCreated(next);
      setPreview(undefined);
      setReviewed(false);
      try {
        const detail = await api('run.detail', { id: next.id });
        if (current(id) && activeRef.current) open(detail);
      } catch (error) {
        if (current(id)) setError('新运行已创建，但详情暂时无法读取：' + message(error));
      }
    } catch (error) {
      if (current(id)) {
        setError(message(error));
        setRetry(true);
      }
    } finally {
      if (current(id)) {
        sending.current = false;
        setSubmitting(false);
      }
    }
  };
  return (
    <section className="run-rerun run-rerun-workspace" aria-label="人工核对后重新运行">
      {!page && (
        <div className="section-row">
          <div>
            <h2>重新运行前，核对已完成操作</h2>
            <p className="muted">创建独立运行记录，从第一个步骤开始。</p>
          </div>
        </div>
      )}
      <div className="run-rerun-layout">
        <div className="run-rerun-main">
          {!terminal && (
            <div className="run-rerun-unavailable" role="status">
              <h2>当前不可重新运行</h2>
              <p>{related?.reason ?? '请等待原运行结束，再核对结果。'}</p>
              <p>可以查看原运行的输出、日志和关联记录。</p>
            </div>
          )}
          {terminal && !created && (
            <>
              <div className="run-rerun-options">
                <fieldset className="run-rerun-mode" disabled={submitting}>
                  <legend>选择执行内容</legend>
                  {(['snapshot', 'saved'] as const).map((value) => (
                    <label key={value} className={mode === value ? 'is-selected' : undefined}>
                      <input
                        type="radio"
                        name={choiceId}
                        value={value}
                        checked={mode === value}
                        onChange={() => {
                          if (sending.current) return;
                          reset();
                          setMode(value);
                        }}
                      />
                      <span>
                        <strong>{modes[value]}</strong>
                        <small>
                          {value === 'snapshot'
                            ? '采用原运行保存的流程、参数与固定脚本。'
                            : '采用当前已保存的流程，未保存草稿不包含在内。'}
                        </small>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <label className="run-rerun-check">
                  <input
                    type="checkbox"
                    checked={debug}
                    disabled={submitting}
                    onChange={(event) => {
                      if (sending.current) return;
                      reset();
                      setDebug(event.target.checked);
                    }}
                  />
                  逐步调试新运行
                </label>
                <button
                  type="button"
                  hidden={!!preview}
                  ref={previewButton}
                  disabled={loading || submitting || !related?.available}
                  onClick={() => void load()}
                >
                  {loading ? '正在准备预览…' : '预览重新运行'}
                </button>
              </div>
              <p className="note" hidden={!!preview}>
                {mode === 'snapshot'
                  ? '使用原运行的流程、参数、本地绑定和固定脚本，并重新检查当前授权。'
                  : '使用当前已保存的内容；编辑器尚未保存的修改不在本次范围内。'}
              </p>
            </>
          )}
          {loading && <p role="status">正在准备重新运行预览…</p>}
          {opening && <p role="status">正在读取关联运行…</p>}
          {created && (
            <p role="status" className="run-rerun-source">
              已创建新运行
              <button
                type="button"
                aria-label={'查看新运行 ' + created.id}
                ref={createdButton}
                disabled={submitting || !!opening}
                onClick={() => void inspect(created.id)}
              >
                {created.id.slice(0, 8)} · 查看新运行
              </button>
            </p>
          )}
          {error && (
            <p ref={errorPanel} tabIndex={-1} className="field-error" role="alert">
              {error}
            </p>
          )}
          {retry && (
            <p className="note">
              确认请求可能已经入队。重试此次确认会查询同一次结果；取消、更改选择或重新预览不会撤销已经创建的运行，之后再次确认属于新的请求。
            </p>
          )}
          {preview && (
            <form
              aria-label="重新运行预览"
              ref={previewRegion}
              tabIndex={-1}
              className="run-rerun-preview"
              onSubmit={(event) => {
                event.preventDefault();
                void confirm();
              }}
            >
              <h3 ref={previewHeading} tabIndex={-1} className={page ? 'sr-only' : undefined}>
                {preview.flow.name} · 本次预览
              </h3>
              <dl className="run-rerun-summary">
                <div>
                  <dt>来源运行</dt>
                  <dd>
                    {preview.source.id} · {modes[preview.mode]}
                  </dd>
                </div>
                <div>
                  <dt>内容摘要</dt>
                  <dd>
                    {preview.flow.stepCount} 个步骤 · {preview.debug ? '逐步调试' : '连续运行'} ·
                    参数 {names(preview.flow.parameterNames)}
                  </dd>
                </div>
              </dl>
              <details className="run-rerun-configuration">
                <summary>查看版本、绑定与引用明细</summary>
                <dl className="run-rerun-facts">
                  <dt>原运行</dt>
                  <dd>
                    {preview.source.name} · <code>{preview.source.id}</code>
                  </dd>
                  <dt>内容来源</dt>
                  <dd>{modes[preview.mode]}</dd>
                  <dt>原执行版本</dt>
                  <dd>
                    <code>{preview.source.versionId}</code>
                  </dd>
                  <dt>采用版本</dt>
                  <dd>
                    <code>{preview.flow.versionId}</code>
                  </dd>
                  <dt>执行方式</dt>
                  <dd>
                    {preview.debug ? '逐步调试' : '连续运行'} · {preview.flow.stepCount} 个步骤
                  </dd>
                  <dt>参数名</dt>
                  <dd>{names(preview.flow.parameterNames)}</dd>
                  <dt>目录绑定名</dt>
                  <dd>{names(preview.flow.directoryBindings)}</dd>
                  <dt>凭据引用名</dt>
                  <dd>{names(preview.flow.credentialRefs)}</dd>
                  <dt>浏览器标识</dt>
                  <dd>{preview.flow.browserId ?? '无'}</dd>
                </dl>
              </details>
              {!!preview.flow.scriptBundles.length && (
                <details>
                  <summary>固定脚本与依赖 · {preview.flow.scriptBundles.length} 个节点</summary>
                  {preview.flow.scriptBundles.map((bundle) => (
                    <p key={bundle.nodeId} className="path-text">
                      {bundle.nodeId} ·{' '}
                      {names(bundle.dependencies.map((item) => item.name + '@' + item.version))}
                      <br />
                      SHA-256 {bundle.sha256}
                    </p>
                  ))}
                </details>
              )}
              {preview.warnings.map((warning, index) => (
                <p className="run-rerun-warning" key={index}>
                  {warning}
                </p>
              ))}
              <label className="run-rerun-check run-rerun-review">
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={submitting}
                  onChange={(event) => setReviewed(event.target.checked)}
                />
                已核对原运行的输出与外部结果，确认从头执行
              </label>
              <div className="run-rerun-actions">
                <button
                  type="submit"
                  className="primary"
                  disabled={submitting || !reviewed || (!related?.available && !attempt.current)}
                >
                  {submitting ? '正在确认…' : retry ? '重试此次确认' : '确认创建新运行'}
                </button>
                <button type="button" disabled={submitting} onClick={leave}>
                  取消
                </button>
              </div>
            </form>
          )}
          {!preview && (cancel || loading || retry || created) && (
            <button
              type="button"
              className="run-rerun-cancel"
              disabled={submitting}
              onClick={leave}
            >
              {created ? '返回原运行' : cancel ? '取消并返回' : '取消重新运行'}
            </button>
          )}
        </div>
        <aside className="run-rerun-context" aria-label="重新运行的来源与边界">
          <h3>当前授权重新检查</h3>
          {inspectSource && (
            <div className="run-rerun-source-actions">
              <button type="button" disabled={submitting} onClick={() => inspectSource('output')}>
                查看原运行输出
              </button>
              <button type="button" disabled={submitting} onClick={() => inspectSource('logs')}>
                查看原运行日志
              </button>
            </div>
          )}
          <p className="run-rerun-availability" role="status">
            {created
              ? '新运行已创建，请先查看记录'
              : terminal && related?.available
                ? '可以预览执行内容'
                : (related?.reason ?? '当前运行暂不可重新运行。')}
          </p>
          <p>
            预览不会启动任务。确认时会重新检查当前授权、资源和执行环境，旧快照不会恢复已撤销的授权。
          </p>
          <dl className="run-rerun-origin">
            <dt>当前运行</dt>
            <dd>{run.name}</dd>
            <dt>运行标识</dt>
            <dd>
              <code>{run.id}</code>
            </dd>
            <dt>当前记录状态</dt>
            <dd>{runStateLabels[run.state]}</dd>
          </dl>
          <p className="run-rerun-effect-note">
            新运行从第一步开始，可能再次发生网页或文件操作。原运行记录、产物和副作用去重记录保持保留。
          </p>
          {run.rerun && (
            <div className="run-rerun-source">
              <span>本次根据{modes[run.rerun.mode]}重新运行，来源：</span>
              <button
                type="button"
                aria-label={'查看来源运行 ' + run.rerun.runId}
                disabled={submitting || !!opening}
                onClick={() => void inspect(run.rerun!.runId)}
              >
                {related?.source?.name ?? '来源运行'} · {run.rerun.runId.slice(0, 8)}
              </button>
              {related?.source && <span>{runStateLabels[related.source.state]}</span>}
            </div>
          )}
          {!!related?.derived.length && (
            <details className="run-rerun-relations" open>
              <summary>由本次派生的运行 · {related.derived.length}</summary>
              <ul aria-label="派生运行">
                {related.derived.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-label={'查看派生运行 ' + item.id}
                      disabled={submitting || !!opening}
                      onClick={() => void inspect(item.id)}
                    >
                      {item.name} · {item.id.slice(0, 8)}
                    </button>
                    <span>{runStateLabels[item.state]}</span>
                    <time>{new Date(item.createdAt).toLocaleString('zh-CN')}</time>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </aside>
      </div>
    </section>
  );
}
