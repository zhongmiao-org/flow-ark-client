import { Button } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { RunOutput } from './RunObservation';
import ArtifactCleanupPanel from './ArtifactCleanupPanel';
import { artifactLabel, type RunArtifact } from './task-run-presentation';
import { runDisplayLabels } from '../shared/run-history';
import type { RunState } from '../shared/types';
import { presentRun } from '../shared/run-presentation';
import RunResultReview from './RunResultReview';
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
  const errorPanel = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    setError('');
    setNotice('');
  }, [artifact.artifactId, artifact.available, artifact.integrity, artifact.path]);
  useEffect(() => {
    if (error) errorPanel.current?.focus();
  }, [error]);
  const tone =
    artifact.integrity === 'cleared'
      ? 'is-cleared'
      : artifact.available && artifact.integrity === 'verified'
        ? 'is-verified'
        : ['missing', 'changed'].includes(artifact.integrity)
          ? 'is-unavailable'
          : 'is-unverified';
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
      <p role="status" className={'run-artifact-status ' + tone}>
        {!artifact.available && artifact.integrity === 'verified'
          ? '副本暂不可访问'
          : artifactLabel(artifact)}
      </p>
      <details>
        <summary>查看保存位置</summary>
        <p className="path-text">{artifact.path || '位置未记录'}</p>
        <p>
          {snapshot
            ? '本次运行保存的独立副本，定位不会改写业务输出原文件。'
            : '外部文件记录，当前文件不代表运行时的历史内容。'}
        </p>
      </details>
      <Button
        disabled={busy || !artifact.available || undefined}
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
      </Button>
      {!artifact.available && <p>当前文件不可定位；保留本条记录供核对。</p>}
      {notice && artifact.available && <p role="status">{notice}</p>}
      {error && (
        <p ref={errorPanel} tabIndex={-1} role="alert" className="field-error">
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
  rerun,
}: {
  detail: any;
  reveal: (id: string) => Promise<unknown>;
  reload: () => Promise<void>;
  rerun: () => void;
}) {
  const view = presentRun(detail, Date.now());
  const lastSaved =
    !['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(detail.run.state) &&
    (Boolean(detail.fault) || (detail.run.state !== 'QUEUED' && view.activity !== 'active'));
  const artifacts: RunArtifact[] = (detail.artifacts ?? []).filter(
    (artifact: RunArtifact) => artifact.runId === detail.run.id,
  );
  return (
    <div className="run-output-workspace">
      <div className="run-output-columns">
        <section className="run-output-result" aria-label="已保存结果">
          <span className={'badge state-' + (lastSaved ? 'INTERRUPTED' : detail.run.state)}>
            {lastSaved && '最后保存：'}
            {runDisplayLabels[detail.run.state as RunState] ?? detail.run.state}
          </span>
          {view.statusNote && (
            <p className="run-output-boundary" role="status">
              {view.statusNote}
            </p>
          )}
          <RunOutput detail={detail} layout="result" />
          <RunResultReview key={detail.run.id} runId={detail.run.id} />
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
          <ArtifactCleanupPanel
            key={detail.run.id}
            run={detail.run}
            cleanup={detail.artifactCleanup}
            changed={reload}
            compact
          />
          <Button type="primary" onClick={rerun}>
            核对后重新运行
          </Button>
        </aside>
      </div>
    </div>
  );
}
