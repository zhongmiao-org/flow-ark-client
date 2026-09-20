import { useRef, useState } from 'react';
import type { ArtifactCleanupPreview, ArtifactCleanupRecord } from '../shared/artifact-cleanup';
import type { Run } from '../shared/types';
const api = (method: string, args: unknown) => window.flowark.request(method, args);
const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} 字节`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

export default function ArtifactCleanupPanel({
  run,
  cleanup,
  changed,
}: {
  run: Run;
  cleanup?: ArtifactCleanupRecord;
  changed: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<ArtifactCleanupPreview>();
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(run.state);
  const load = async () => {
    setBusy(true);
    setError('');
    setReviewed(false);
    setPreview(undefined);
    try {
      setPreview(await api('run.artifacts.preview', { id: run.id }));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="artifact-cleanup" aria-label="运行产物管理">
      <div className="section-row">
        <div>
          <b>产物保留与清理</b>
          <p className="muted">默认保留。可清理本次运行在应用内保存的文件。</p>
        </div>
        <button ref={button} disabled={busy || !terminal} onClick={load}>
          {busy ? '正在处理…' : '预览产物清理'}
        </button>
      </div>
      {cleanup?.state === 'completed' && (
        <p role="status">
          已清理 · {cleanup.count} 个文件 · {size(cleanup.bytes)}，运行记录已保留
        </p>
      )}
      {cleanup?.state === 'pending' && <p role="status">正在清理产物…</p>}
      {cleanup && ['failed', 'interrupted'].includes(cleanup.state) && (
        <p className="field-error" role="status">
          清理未完成 · {cleanup.error}
        </p>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {preview && (
        <form
          aria-label="产物清理预览"
          className="artifact-cleanup-preview"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!reviewed || busy) return;
            setBusy(true);
            setError('');
            try {
              await api('run.artifacts.clear', {
                id: run.id,
                token: preview.token,
                reviewed: true,
              });
              setPreview(undefined);
              setReviewed(false);
            } catch (e) {
              setError(String(e));
              setPreview(undefined);
              setReviewed(false);
            } finally {
              await changed().catch((e) => setError(String(e)));
              setBusy(false);
              button.current?.focus();
            }
          }}
        >
          <h3>
            {preview.count} 个文件 · {size(preview.bytes)}
          </h3>
          <p>确认后永久删除这些应用内产物。运行记录、快照、业务输出原文件和待办继续保留。</p>
          {!!preview.externalCount && (
            <p>另有 {preview.externalCount} 条外部产物记录，原文件保留。</p>
          )}
          <ul className="artifact-cleanup-files" aria-label="将清理的文件">
            {preview.files.map((file) => (
              <li key={file.name}>
                <code>{file.name}</code>
                <span>{file.link ? '仅删除链接' : size(file.size)}</span>
              </li>
            ))}
          </ul>
          {!!preview.omitted && (
            <p>另有 {preview.omitted} 个文件在同一运行产物目录内，也将清理。</p>
          )}
          {!preview.count && (
            <p>
              目录内没有剩余文件。
              {preview.indexedCount ? '确认后将现有的缺失产物标记为已清理。' : '无需清理。'}
            </p>
          )}
          <label className="artifact-cleanup-confirm">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            已核对结果并保存需要保留的文件
          </label>
          <div className="row">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPreview(undefined);
                setReviewed(false);
                button.current?.focus();
              }}
            >
              取消清理
            </button>
            <button
              type="submit"
              disabled={busy || !reviewed || (!preview.count && !preview.indexedCount)}
            >
              确认清理产物
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
