import { Alert, Button, Card, type AlertRef } from 'antd';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type useDesktopWindows from './useDesktopWindows';

export default function DesktopSelectionPreview({
  state,
  plan,
  actionLabel = '用这个窗口规划',
  actionDisabled = false,
  note = '下一步可核对发送内容并生成改动预览；修改前还需保存方案并确认试运行。',
}: {
  state: ReturnType<typeof useDesktopWindows>;
  plan: () => void;
  actionLabel?: string;
  actionDisabled?: boolean;
  note?: string;
}) {
  const titleId = useId(),
    heading = useRef<HTMLHeadingElement>(null),
    readButton = useRef<HTMLButtonElement>(null),
    failure = useRef<AlertRef>(null),
    cleared = useRef<AlertRef>(null),
    restoreReadFocus = useRef(false);
  const [clearNotice, setClearNotice] = useState('');
  const { preview, reading, expired, selected } = state;
  useEffect(() => {
    if (!preview) return;
    const target = preview.status === 'ready' ? heading.current : failure.current?.nativeElement;
    if (target) {
      target.tabIndex = -1;
      target.focus();
    }
  }, [preview]);
  useEffect(() => {
    setClearNotice('');
    restoreReadFocus.current = false;
  }, [selected?.id]);
  useLayoutEffect(() => {
    if (!restoreReadFocus.current || reading || preview) return;
    restoreReadFocus.current = false;
    if (readButton.current && !readButton.current.disabled) readButton.current.focus();
    else if (cleared.current) {
      cleared.current.nativeElement.tabIndex = -1;
      cleared.current.nativeElement.focus();
    }
  }, [reading, preview, clearNotice, expired]);
  if (!selected) return null;
  return (
    <section className="task-desktop-selection" aria-labelledby={titleId} aria-busy={reading}>
      <Card size="small" className="task-desktop-selection-card">
        <h3 id={titleId} ref={heading} tabIndex={-1}>
          核对选中的段落
        </h3>
        <p>
          先在这个 TextEdit 窗口选中文字，再明确读取。这里只在本地查看，不发送给 AI，不修改原文。
        </p>
        <div className="ai-task-actions">
          <Button
            ref={readButton}
            type="primary"
            disabled={reading || expired || state.loading || state.settingsPending || undefined}
            onClick={() => {
              setClearNotice('');
              void state.readSelection();
            }}
          >
            {reading ? '正在读取选区…' : preview ? '重新读取选中段落' : '读取选中段落'}
          </Button>
          {(preview || reading) && (
            <Button
              onClick={() => {
                restoreReadFocus.current = true;
                setClearNotice(
                  reading
                    ? '已停止等待，本次迟到结果不会加入预览。可重新读取选区。'
                    : '已清除本地预览，可重新选择并读取段落。',
                );
                state.clearPreview();
              }}
            >
              {reading ? '停止等待' : '清除预览'}
            </Button>
          )}
        </div>
        {reading && <Alert type="info" showIcon role="status" title="正在核对窗口与当前选区…" />}
        {clearNotice && !reading && !preview && !expired && (
          <Alert type="info" showIcon role="status" ref={cleared} title={clearNotice} />
        )}
        {preview?.status === 'ready' && (
          <>
            <pre tabIndex={0} aria-label="选中段落内容">
              {preview.text}
            </pre>
            <p className="task-desktop-observed">
              本次显示 {Array.from(preview.text).length} 个字符 ·{' '}
              {new Date(preview.readAt).toLocaleTimeString('zh-CN')} 读取
            </p>
            {preview.redacted && (
              <Alert
                type="warning"
                showIcon
                role="status"
                title="显示内容已遮盖敏感信息；此预览不能作为原文直接写回。"
              />
            )}
            <p>
              这是本次读取的快照，之后的选区变化不会自动更新。有效至{' '}
              {new Date(preview.expiresAt).toLocaleTimeString('zh-CN')}，继续前需重新核对。
            </p>
          </>
        )}
        {preview && preview.status !== 'ready' && (
          <Alert type="error" showIcon role="alert" ref={failure} title={preview.reason} />
        )}
        {expired && (
          <>
            {!preview && (
              <Alert
                type="warning"
                showIcon
                role="status"
                ref={cleared}
                title="当前窗口检查已失效。请重新检查、选择窗口，再读取段落。"
              />
            )}
            <Button
              onClick={() => void state.refresh()}
              disabled={state.loading || state.settingsPending || undefined}
            >
              重新检查窗口
            </Button>
          </>
        )}
        {preview?.status === 'ready' && (
          <Button
            type="primary"
            onClick={plan}
            disabled={
              actionDisabled ||
              expired ||
              reading ||
              state.loading ||
              state.settingsPending ||
              undefined
            }
          >
            {actionLabel}
          </Button>
        )}
        <p className="task-desktop-observed">{note}</p>
      </Card>
    </section>
  );
}
