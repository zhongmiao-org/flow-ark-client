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
    failure = useRef<HTMLParagraphElement>(null),
    cleared = useRef<HTMLParagraphElement>(null),
    restoreReadFocus = useRef(false);
  const [clearNotice, setClearNotice] = useState('');
  const { preview, reading, expired, selected } = state;
  useEffect(() => {
    if (preview) (preview.status === 'ready' ? heading.current : failure.current)?.focus();
  }, [preview]);
  useEffect(() => {
    setClearNotice('');
    restoreReadFocus.current = false;
  }, [selected?.id]);
  useLayoutEffect(() => {
    if (!restoreReadFocus.current || reading || preview) return;
    restoreReadFocus.current = false;
    if (readButton.current && !readButton.current.disabled) readButton.current.focus();
    else cleared.current?.focus();
  }, [reading, preview, clearNotice, expired]);
  if (!selected) return null;
  return (
    <section className="task-desktop-selection" aria-labelledby={titleId} aria-busy={reading}>
      <h3 id={titleId} ref={heading} tabIndex={-1}>
        核对选中的段落
      </h3>
      <p>先在这个 TextEdit 窗口选中文字，再明确读取。这里只在本地查看，不发送给 AI，不修改原文。</p>
      <div className="ai-task-actions">
        <button
          ref={readButton}
          className="primary"
          disabled={reading || expired || state.loading || state.settingsPending}
          onClick={() => {
            setClearNotice('');
            void state.readSelection();
          }}
        >
          {reading ? '正在读取选区…' : preview ? '重新读取选中段落' : '读取选中段落'}
        </button>
        {(preview || reading) && (
          <button
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
          </button>
        )}
      </div>
      {reading && <p role="status">正在核对窗口与当前选区…</p>}
      {clearNotice && !reading && !preview && !expired && (
        <p role="status" ref={cleared} tabIndex={-1}>
          {clearNotice}
        </p>
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
            <p className="ai-task-note" role="status">
              显示内容已遮盖敏感信息；此预览不能作为原文直接写回。
            </p>
          )}
          <p>
            这是本次读取的快照，之后的选区变化不会自动更新。有效至{' '}
            {new Date(preview.expiresAt).toLocaleTimeString('zh-CN')}，继续前需重新核对。
          </p>
        </>
      )}
      {preview && preview.status !== 'ready' && (
        <p className="ai-task-note ai-task-failure" role="alert" ref={failure} tabIndex={-1}>
          {preview.reason}
        </p>
      )}
      {expired && (
        <>
          {!preview && (
            <p className="ai-task-note" role="status" ref={cleared} tabIndex={-1}>
              当前窗口检查已失效。请重新检查、选择窗口，再读取段落。
            </p>
          )}
          <button
            onClick={() => void state.refresh()}
            disabled={state.loading || state.settingsPending}
          >
            重新检查窗口
          </button>
        </>
      )}
      {preview?.status === 'ready' && (
        <button
          className="primary"
          onClick={plan}
          disabled={actionDisabled || expired || reading || state.loading || state.settingsPending}
        >
          {actionLabel}
        </button>
      )}
      <p className="task-desktop-observed">{note}</p>
    </section>
  );
}
