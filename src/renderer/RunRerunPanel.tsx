import { useEffect, useRef, useState } from 'react';
import type { Run } from '../shared/types';
import type {
  RunRerunConfirmInput,
  RunRerunDetails,
  RunRerunMode,
  RunRerunPreview,
} from '../shared/run-rerun';
import { runStateLabels } from '../shared/run-history';

const api = (method: string, args: unknown) => window.flowark.request(method, args);
const modes = { snapshot: '原执行快照', saved: '当前已保存流程' };
const names = (values: string[]) => values.join('、') || '无';
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export default function RunRerunPanel({
  run,
  related,
  open,
}: {
  run: Run;
  related?: RunRerunDetails;
  open: (detail: any) => void;
}) {
  const [mode, setMode] = useState<RunRerunMode>('snapshot');
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
  const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(run.state);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      generation.current++;
    };
  }, []);
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
      if (current(id)) open(detail);
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
        if (current(id)) open(detail);
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
    <section className="run-rerun" aria-label="人工核对后重新运行">
      <div className="section-row">
        <div>
          <b>人工核对后重新运行</b>
          <p className="muted">创建独立运行记录，从第一个步骤开始。</p>
        </div>
      </div>
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
      {terminal && (
        <>
          <div className="run-rerun-options">
            <label>
              使用的内容
              <select
                aria-label="重新运行使用的内容"
                value={mode}
                disabled={submitting}
                onChange={(event) => {
                  if (sending.current) return;
                  reset();
                  setMode(event.target.value as RunRerunMode);
                }}
              >
                <option value="snapshot">原执行快照</option>
                <option value="saved">当前已保存流程</option>
              </select>
            </label>
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
              ref={previewButton}
              disabled={loading || submitting || !related?.available}
              onClick={() => void load()}
            >
              预览重新运行
            </button>
          </div>
          <p className="note">
            {mode === 'snapshot'
              ? '使用原运行的流程、参数、本地绑定和固定脚本，并重新检查当前授权。'
              : '使用当前已保存的内容；编辑器尚未保存的修改不在本次范围内。'}
          </p>
        </>
      )}
      {!related?.available && (
        <p className="muted">{related?.reason ?? '当前运行暂不可重新运行。'}</p>
      )}
      {loading && <p role="status">正在准备重新运行预览…</p>}
      {opening && <p role="status">正在读取关联运行…</p>}
      {created && (
        <p role="status" className="run-rerun-source">
          已创建新运行
          <button
            type="button"
            aria-label={'查看新运行 ' + created.id}
            disabled={submitting || !!opening}
            onClick={() => void inspect(created.id)}
          >
            {created.id.slice(0, 8)} · 查看新运行
          </button>
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
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
          className="run-rerun-preview"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <h3>{preview.flow.name}</h3>
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
            <p className="note" key={index}>
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
          <button
            type="submit"
            className="primary"
            disabled={submitting || !reviewed || (!related?.available && !attempt.current)}
          >
            {retry ? '重试此次确认' : '确认从头运行'}
          </button>
        </form>
      )}
      {(loading || preview || retry) && (
        <button
          type="button"
          className="run-rerun-cancel"
          disabled={submitting}
          onClick={() => {
            if (sending.current) return;
            reset();
            previewButton.current?.focus();
          }}
        >
          取消重新运行
        </button>
      )}
    </section>
  );
}
