import { Button, Checkbox, Modal } from 'antd';
import './antd-layout.css';
import { useEffect, useId, useRef, useState } from 'react';
import type { ArtifactCleanupPreview, ArtifactCleanupRecord } from '../shared/artifact-cleanup';
import type { Run } from '../shared/types';
import './artifact-cleanup.css';
const api = (method: string, args: unknown) => window.flowark.request(method, args);
const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} 字节`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
const message = (reason: unknown) =>
  (reason instanceof Error ? reason.message : '未取得明确结果，请核对运行记录').replace(
    /^Error invoking remote method 'flowark:request': (?:Error: )?/,
    '',
  );

function CleanupDialog({
  run,
  changed,
  close,
}: {
  run: Run;
  changed: () => Promise<void>;
  close: () => void;
}) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const live = useRef(false);
  const locked = useRef(false);
  const [stage, setStage] = useState<'loading' | 'review' | 'clearing' | 'result' | 'error'>(
    'loading',
  );
  const [preview, setPreview] = useState<ArtifactCleanupPreview>();
  const [result, setResult] = useState<ArtifactCleanupRecord>();
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState('');
  const [clearAttempted, setClearAttempted] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const refreshLock = useRef(false);
  const load = async () => {
    if (locked.current) return;
    locked.current = true;
    setStage('loading');
    setClearAttempted(false);
    setError('');
    setPreview(undefined);
    setReviewed(false);
    try {
      const next: ArtifactCleanupPreview = await api('run.artifacts.preview', { id: run.id });
      if (!live.current) return;
      if (next.runId !== run.id) throw new Error('清理预览与当前运行不一致，请重新读取');
      setPreview(next);
      setStage('review');
    } catch (reason) {
      if (live.current) {
        setError(message(reason));
        setStage('error');
      }
    } finally {
      locked.current = false;
    }
  };
  useEffect(() => {
    live.current = true;
    const origin = document.activeElement as HTMLElement | null;
    void load();
    return () => {
      live.current = false;
      if (origin?.isConnected) origin.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [stage]);
  const refresh = async () => {
    if (refreshLock.current) return;
    refreshLock.current = true;
    setRefreshing(true);
    try {
      await changed();
      if (live.current) setRefreshError('');
    } catch (reason) {
      if (live.current) setRefreshError(message(reason));
    } finally {
      refreshLock.current = false;
      if (live.current) setRefreshing(false);
    }
  };
  const clear = async () => {
    if (locked.current || !preview || !reviewed || stage !== 'review') return;
    locked.current = true;
    setStage('clearing');
    setClearAttempted(true);
    setError('');
    try {
      const receipt: ArtifactCleanupRecord = await api('run.artifacts.clear', {
        id: run.id,
        token: preview.token,
        reviewed: true,
      });
      if (!live.current) return;
      if (receipt.runId !== run.id || receipt.state !== 'completed')
        throw new Error('尚未取得清理完成回执，请核对记录后重新预览');
      setResult(receipt);
      setStage('result');
    } catch (reason) {
      if (live.current) {
        setError(message(reason));
        setStage('error');
      }
    } finally {
      setPreview(undefined);
      setReviewed(false);
      locked.current = false;
      if (live.current) await refresh();
    }
  };
  const busy = stage === 'clearing';
  const dismiss = () => {
    if (!busy) close();
  };
  const empty = preview && !preview.count && !preview.indexedCount;
  const title =
    stage === 'loading'
      ? '正在核对清理范围'
      : stage === 'clearing'
        ? '正在清理本次运行产物'
        : stage === 'result'
          ? '本次运行产物已清理'
          : stage === 'error'
            ? clearAttempted
              ? '清理尚未完成'
              : '清理范围暂不可用'
            : empty
              ? '无需清理产物'
              : '清理本次运行产物？';
  return (
    <Modal
      open
      width={640}
      centered
      closable={false}
      mask={{ closable: false }}
      keyboard={!busy}
      footer={null}
      className="flowark-content-modal artifact-cleanup-dialog"
      focusable={{ focusTriggerAfterClose: false }}
      aria-labelledby={titleId}
      aria-busy={busy}
      onCancel={dismiss}
      afterOpenChange={(open) => {
        if (open) heading.current?.focus();
      }}
    >
      <header>
        <span className="artifact-cleanup-kicker">运行产物管理</span>
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <p>
          来源运行 <code>{run.id}</code>
        </p>
      </header>
      {(stage === 'loading' || busy) && (
        <p role="status" className="artifact-cleanup-message">
          {busy
            ? '等待本次清理的实际结果，请勿关闭。不会重新执行流程。'
            : '读取应用内副本与产物记录，本次预览不会删除文件。'}
        </p>
      )}
      {stage === 'error' && (
        <div className="artifact-cleanup-message error" role="alert">
          <p>{error}</p>
          <p>
            {clearAttempted
              ? '可能已有部分文件被清理。重新预览剩余范围后再确认，不会自动继续删除。'
              : '本次未发出清理请求。核对状态后可重新预览。'}
          </p>
        </div>
      )}
      {stage === 'result' && result && (
        <div className="artifact-cleanup-message success" role="status">
          <strong>
            已清理 {result.count} 个文件 · {size(result.bytes)}
          </strong>
          <p>运行记录、快照、原业务文件和待办已保留。</p>
        </div>
      )}
      {refreshError && (
        <div className="artifact-cleanup-message warning" role="alert">
          <p>运行详情暂未刷新：{refreshError}</p>
          <p>刷新只读取记录，不再次清理。</p>
          <Button disabled={refreshing || undefined} onClick={() => void refresh()}>
            {refreshing ? '正在刷新…' : '刷新运行详情'}
          </Button>
        </div>
      )}
      {preview && (stage === 'review' || busy) && (
        <>
          <div className="artifact-cleanup-summary">
            <div>
              <span>应用内文件</span>
              <strong>{preview.count} 个</strong>
            </div>
            <div>
              <span>文件大小</span>
              <strong>{size(preview.bytes)}</strong>
            </div>
            <div>
              <span>保留外部产物记录</span>
              <strong>{preview.externalCount} 条</strong>
            </div>
          </div>
          <p className="artifact-cleanup-message warning">
            {preview.count
              ? '确认后永久删除下列应用内副本。原业务文件、运行历史、快照与待办继续保留。'
              : '原业务文件、运行历史、快照与待办继续保留。'}
          </p>
          {!!preview.files.length && (
            <ul className="artifact-cleanup-files" aria-label="将清理的文件">
              {preview.files.map((file) => (
                <li key={file.name}>
                  <code>{file.name}</code>
                  <span>{file.link ? '仅删除链接' : size(file.size)}</span>
                </li>
              ))}
            </ul>
          )}
          {!!preview.omitted && (
            <p>另有 {preview.omitted} 个文件在同一运行产物目录内，也将清理。</p>
          )}
          {!preview.count && (
            <p className="artifact-cleanup-message">
              {preview.indexedCount
                ? `目录内没有剩余文件；确认后将 ${preview.indexedCount} 条缺失产物记录标记为已清理。`
                : '没有剩余应用内文件或待清理索引，无需清理。'}
            </p>
          )}
          {!empty && (
            <Checkbox
              checked={reviewed}
              disabled={busy || undefined}
              onChange={(event) => setReviewed(event.target.checked)}
              className="artifact-cleanup-confirm"
            >
              已核对范围，并保存需要保留的文件
            </Checkbox>
          )}
        </>
      )}
      <footer className="artifact-cleanup-actions">
        <Button disabled={busy || undefined} onClick={dismiss}>
          {stage === 'result' ? '返回产物列表' : '取消清理'}
        </Button>
        {stage === 'error' && (
          <Button disabled={refreshing || undefined} onClick={() => void load()}>
            重新预览清理
          </Button>
        )}
        {preview && !empty && (
          <Button danger disabled={busy || !reviewed || undefined} onClick={() => void clear()}>
            {busy ? '正在清理…' : '确认清理产物'}
          </Button>
        )}
      </footer>
    </Modal>
  );
}

export default function ArtifactCleanupPanel({
  run,
  cleanup,
  changed,
  compact = false,
}: {
  run: Run;
  cleanup?: ArtifactCleanupRecord;
  compact?: boolean;
  changed: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(run.state);
  return (
    <section
      className={'artifact-cleanup' + (compact ? ' is-compact' : '')}
      aria-label="运行产物管理"
    >
      <div className="section-row">
        <div hidden={compact}>
          <h3>产物保留与清理</h3>
          <p>默认保留。仅清理本次运行在应用内保存的副本。</p>
        </div>
        <Button
          disabled={!terminal || cleanup?.state === 'pending' || undefined}
          onClick={() => setOpen(true)}
        >
          预览产物清理
        </Button>
      </div>
      {!terminal && <p>运行尚未结束，暂不能清理产物。</p>}
      {cleanup?.state === 'completed' && (
        <p role="status">
          已清理 · {cleanup.count} 个文件 · {size(cleanup.bytes)}，运行记录已保留
        </p>
      )}
      {cleanup?.state === 'pending' && <p role="status">正在清理产物，等待实际结果…</p>}
      {cleanup && ['failed', 'interrupted'].includes(cleanup.state) && (
        <p className="field-error" role="status">
          清理未完成 · {cleanup.error}。请重新预览剩余范围。
        </p>
      )}
      {open && <CleanupDialog run={run} changed={changed} close={() => setOpen(false)} />}
    </section>
  );
}
