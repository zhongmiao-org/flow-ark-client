import { Card, Alert, ConfigProvider, Button, type AlertRef } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { TaskDetail } from '../shared/planning';
import type { RunReviewInput } from '../shared/run-review';
import { desktopBinding } from '../shared/desktop-run';
import { DesktopWindowList, useDesktopWindows } from './TaskDesktopWindows';
import DesktopSelectionPreview from './DesktopSelectionPreview';

export default function DesktopRunBinding({
  selection,
  flowHash,
  bound,
  close,
}: {
  selection: RunReviewInput;
  flowHash: string;
  bound: (detail: TaskDetail) => void;
  close: () => void;
}) {
  const identity = JSON.stringify([selection.id, selection.task, flowHash]);
  const windows = useDesktopWindows(true, identity);
  const pending = useRef<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const failure = useRef<AlertRef>(null);
  useEffect(() => {
    const target = failure.current?.nativeElement;
    if (!error || !target) return;
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    const ensureVisible = () => {
      if (document.activeElement === target) target.scrollIntoView({ block: 'nearest' });
    };
    ensureVisible();
    const observer = new ResizeObserver(ensureVisible);
    observer.observe(target);
    window.addEventListener('resize', ensureVisible);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', ensureVisible);
    };
  }, [error]);
  useEffect(
    () => () => {
      const requestId = pending.current;
      pending.current = undefined;
      if (requestId)
        void window.flowark.request('desktop.run.cancel', { requestId }).catch(() => {});
    },
    [identity],
  );
  const bind = async () => {
    const preview = windows.preview,
      task = selection.task;
    if (
      pending.current ||
      !task ||
      preview?.status !== 'ready' ||
      preview.redacted ||
      windows.expired
    )
      return;
    const requestId = crypto.randomUUID();
    pending.current = requestId;
    setBusy(true);
    setError('');
    try {
      const detail: TaskDetail = await window.flowark.request('desktop.run.bind', {
        flowId: selection.id,
        taskId: task.id,
        revision: task.revision,
        flowHash,
        requestId,
        observationId: preview.observationId,
        windowId: preview.windowId,
        previewId: preview.previewId,
      });
      if (pending.current !== requestId) return;
      const binding = desktopBinding.parse(detail.flow?.desktopTarget?.binding);
      if (
        detail.task.id !== task.id ||
        detail.task.revision !== task.revision ||
        detail.flow?.id !== selection.id ||
        binding.expiresAt !== preview.expiresAt ||
        binding.expiresAt <= Date.now()
      )
        throw new Error('绑定返回来源不一致');
      pending.current = undefined;
      bound(detail);
    } catch (error) {
      if (pending.current !== requestId) return;
      await window.flowark.request('desktop.run.cancel', { requestId }).catch(() => {});
      if (pending.current !== requestId) return;
      pending.current = undefined;
      setError(error instanceof Error ? error.message : '窗口绑定未完成，请重新读取选区。');
      setBusy(false);
    }
  };
  return (
    <section className="desktop-run-binding" aria-label="重新绑定应用窗口" aria-busy={busy}>
      <Card className="run-review-card">
        <h2>重新选择窗口与原选区</h2>
        <p>请在 TextEdit 中选中采纳方案时的原文。核对一致后返回确认页，这一步不会修改文档。</p>
        <ConfigProvider componentDisabled={busy}>
          <fieldset disabled={busy}>
            <DesktopWindowList state={windows} />
            {windows.snapshot?.platform === 'macos' &&
              windows.snapshot.accessibility !== 'granted' && (
                <Button
                  onClick={() => void windows.openSettings()}
                  disabled={windows.settingsPending || undefined}
                >
                  查看系统辅助功能设置
                </Button>
              )}
            <DesktopSelectionPreview
              state={windows}
              plan={() => void bind()}
              actionLabel="核对原文并绑定这个窗口"
              actionDisabled={windows.preview?.status === 'ready' && windows.preview.redacted}
              note="只绑定本次明确选择的原文；随后还需勾选授权并点击开始试运行。"
            />
            {windows.preview?.status === 'ready' && windows.preview.redacted && (
              <Alert
                type="warning"
                showIcon
                role="alert"
                title="原文含已遮盖内容，不能用于修改绑定。"
              />
            )}
          </fieldset>
        </ConfigProvider>
        {busy && <Alert type="info" showIcon role="status" title="正在核对原文与可用能力…" />}
        {error && <Alert ref={failure} type="error" showIcon role="alert" title={error} />}
        <Button onClick={close}>取消选择，返回确认</Button>
      </Card>
    </section>
  );
}
