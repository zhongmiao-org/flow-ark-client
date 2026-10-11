import { activateCollapseWithSpace } from './collapseKeyboard';
import { runStateColors } from './theme';
import { Card, Empty, Alert, Button, Collapse, Tag, Badge } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { RunOutput } from './RunObservation';
import ArtifactCleanupPanel from './ArtifactCleanupPanel';
import { artifactLabel, type RunArtifact } from './task-run-presentation';
import { runDisplayLabels } from '../shared/run-history';
import type { RunState } from '../shared/types';
import { presentRun } from '../shared/run-presentation';
import RunResultReview from './RunResultReview';
import './run-output-workspace.css';
import { keepFocusedElementVisible } from './keepFocusedElementVisible';

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
  const errorPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setError('');
    setNotice('');
  }, [artifact.artifactId, artifact.available, artifact.integrity, artifact.path]);
  useEffect(() => {
    const target = errorPanel.current;
    if (!error || !target) return;
    target.focus({ preventScroll: true });
    return keepFocusedElementVisible(target);
  }, [error]);
  const tone =
    artifact.integrity === 'cleared'
      ? 'default'
      : artifact.available && artifact.integrity === 'verified'
        ? 'success'
        : ['missing', 'changed'].includes(artifact.integrity)
          ? 'error'
          : 'warning';
  return (
    <article data-artifact-id={artifact.artifactId} aria-label={artifact.name}>
      <Card className="run-artifact-card" size="small" styles={{ body: { padding: 16 } }}>
        <header>
          <h4>{artifact.name}</h4>
          <span>{fileSize(artifact.size)}</span>
        </header>
        <Tag
          className="run-artifact-status"
          color={tone}
          icon={<Badge status={tone} />}
          role="status"
        >
          {!artifact.available && artifact.integrity === 'verified'
            ? '副本暂不可访问'
            : artifactLabel(artifact)}
        </Tag>
        <Collapse
          size="small"
          items={[
            {
              key: 'location',
              onKeyDown: activateCollapseWithSpace,
              label: '查看保存位置',
              forceRender: true,
              children: (
                <>
                  <p className="path-text">{artifact.path || '位置未记录'}</p>
                  <p>
                    {snapshot
                      ? '本次运行保存的独立副本，定位不会改写业务输出原文件。'
                      : '外部文件记录，当前文件不代表运行时的历史内容。'}
                  </p>
                </>
              ),
            },
          ]}
        />
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
        {notice && artifact.available && (
          <Alert type="info" showIcon title={notice} role="status" />
        )}
        {error && (
          <div ref={errorPanel} tabIndex={-1} className="run-artifact-error">
            <Alert type="error" showIcon title={error} />
          </div>
        )}
      </Card>
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
        <section aria-label="已保存结果">
          <Card className="run-output-result">
            <Tag
              className="run-state-tag"
              variant="filled"
              color={runStateColors[lastSaved ? 'INTERRUPTED' : detail.run.state]}
              icon={<Badge status={runStateColors[lastSaved ? 'INTERRUPTED' : detail.run.state]} />}
            >
              {lastSaved && '最后保存：'}
              {runDisplayLabels[detail.run.state as RunState] ?? detail.run.state}
            </Tag>
            {view.statusNote && (
              <Alert type="warning" showIcon title={view.statusNote} role="status" />
            )}
            <RunOutput detail={detail} layout="result" />
            <RunResultReview key={detail.run.id} runId={detail.run.id} />
          </Card>
        </section>
        <aside aria-label="本次运行的产物">
          <Card className="run-output-files">
            <header>
              <h3>本次运行的产物</h3>
              <span>{artifacts.length} 条记录</span>
            </header>
            {artifacts.length ? (
              artifacts.map((artifact) => (
                <ArtifactCard key={artifact.artifactId} artifact={artifact} reveal={reveal} />
              ))
            ) : (
              <Empty
                className="run-artifact-empty"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <>
                    <h4>尚无已保存的运行产物</h4>
                    <p>有运行输出不一定会生成文件；这里只列出本次运行已登记的产物。</p>
                  </>
                }
              />
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
          </Card>
        </aside>
      </div>
    </div>
  );
}
