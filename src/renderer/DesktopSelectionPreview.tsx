import { useEffect, useId, useRef } from 'react';
import type useDesktopWindows from './useDesktopWindows';

export default function DesktopSelectionPreview({
  state,
  plan,
}: {
  state: ReturnType<typeof useDesktopWindows>;
  plan: () => void;
}) {
  const titleId = useId(),
    heading = useRef<HTMLHeadingElement>(null),
    readButton = useRef<HTMLButtonElement>(null);
  const { preview, reading, expired, selected } = state;
  useEffect(() => {
    if (preview) heading.current?.focus();
  }, [preview]);
  if (!selected) return null;
  return (
    <section className="task-desktop-selection" aria-labelledby={titleId}>
      <h3 id={titleId} ref={heading} tabIndex={-1}>
        核对选中的段落
      </h3>
      <p>先在这个 TextEdit 窗口选中文字，再明确读取。这里只在本地查看，不发送给 AI，不修改原文。</p>
      <div className="ai-task-actions">
        <button
          ref={readButton}
          className="primary"
          disabled={reading || expired || state.loading || state.settingsPending}
          onClick={() => void state.readSelection()}
        >
          {reading ? '正在读取选区…' : preview ? '重新读取选中段落' : '读取选中段落'}
        </button>
        {(preview || reading) && (
          <button
            onClick={() => {
              state.clearPreview();
              readButton.current?.focus();
            }}
          >
            清除预览
          </button>
        )}
      </div>
      {reading && <p role="status">正在核对窗口与当前选区…</p>}
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
        <p className="ai-task-note ai-task-failure" role="alert">
          {preview.reason}
        </p>
      )}
      {expired && (
        <button
          onClick={() => void state.refresh()}
          disabled={state.loading || state.settingsPending}
        >
          重新检查窗口
        </button>
      )}
      {preview?.status === 'ready' && (
        <button className="primary" onClick={plan} disabled={expired || reading || state.loading}>
          用这个窗口规划
        </button>
      )}
      <p className="task-desktop-observed">
        下一步可核对发送内容并生成改动预览；文档写入尚未开放。
      </p>
    </section>
  );
}
