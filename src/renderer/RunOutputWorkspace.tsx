import { useRef, useState } from 'react';
import { RunOutput } from './RunObservation';
import ArtifactCleanupPanel from './ArtifactCleanupPanel';
import { artifactLabel, type RunArtifact } from './task-run-presentation';
import './run-output-workspace.css';

function fileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return '大小未记录';
  if (bytes < 1024) return `${bytes} 字节`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function ArtifactCard({
  artifact,
  reveal,
}: {
  artifact: RunArtifact;
  reveal: (id: string) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const snapshot = artifact.storage === 'snapshot-v1';
  return (
    <article
      className="run-artifact-card"
      data-artifact-id={artifact.artifactId}
      aria-label={artifact.name}
    >
      <header>
        <h4>{artifact.name}</h4>
        <span>{fileSize(artifact.size)}</span>
      </header>
      <p
        className={
          'run-artifact-status ' +
          (artifact.available && artifact.integrity === 'verified'
            ? 'is-verified'
            : 'is-unavailable')
        }
      >
        {!artifact.available && artifact.integrity === 'verified'
          ? '副本暂不可访问'
          : artifactLabel(artifact)}
      </p>
      <p>
        {snapshot
          ? '本次运行保存的独立副本，定位不会改写业务输出原文件。'
          : '外部文件记录，当前文件不代表运行时的历史内容。'}
      </p>
      <details>
        <summary>查看保存位置</summary>
        <p className="path-text">{artifact.path || '位置未记录'}</p>
      </details>
      <button
        disabled={busy || !artifact.available}
        onClick={async () => {
          if (lock.current || !artifact.available) return;
          lock.current = true;
          setBusy(true);
          setError('');
          setNotice('');
          try {
            await reveal(artifact.artifactId);
            setNotice('已请求在文件管理器中显示此文件。');
          } catch (e) {
            setError(e instanceof Error ? e.message : '定位失败，请稍后重试。');
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        {busy ? '正在定位…' : snapshot ? '定位副本' : '定位当前文件'}
      </button>
      {!artifact.available && <p>当前文件不可定位；保留本条记录供核对。</p>}
      {notice && artifact.available && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </article>
  );
}

export default function RunOutputWorkspace({
  detail,
  reveal,
  reload,
}: {
  detail: any;
  reveal: (id: string) => Promise<unknown>;
  reload: () => Promise<void>;
}) {
  const artifacts: RunArtifact[] = (detail.artifacts ?? []).filter(
    (artifact: RunArtifact) => artifact.runId === detail.run.id,
  );
  return (
    <div className="run-output-workspace">
      <div className="run-output-columns">
        <section className="run-output-result" aria-label="已保存结果">
          <RunOutput detail={detail} />
          <p className="run-output-boundary">
            运行结束、外部业务结果与文件可用性分别核对；查看结果不会重新执行步骤。
          </p>
        </section>
        <aside className="run-output-files" aria-label="本次运行的产物">
          <header>
            <h3>本次运行的产物</h3>
            <span>{artifacts.length} 条记录</span>
          </header>
          {artifacts.length ? (
            artifacts.map((artifact) => (
              <ArtifactCard key={artifact.artifactId} artifact={artifact} reveal={reveal} />
            ))
          ) : (
            <div className="run-artifact-empty">
              <h4>尚无已保存的运行产物</h4>
              <p>有运行输出不一定会生成文件；这里只列出本次运行已登记的产物。</p>
            </div>
          )}
        </aside>
      </div>
      <ArtifactCleanupPanel
        key={detail.run.id}
        run={detail.run}
        cleanup={detail.artifactCleanup}
        changed={reload}
      />
    </div>
  );
}
