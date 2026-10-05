import { useLayoutEffect, useRef } from 'react';

export type AttachmentFeedback = {
  action: 'file' | 'image' | 'preview' | 'remove';
  attachmentId?: string;
  status: 'pending' | 'success' | 'cancelled' | 'error';
  message: string;
  focus?: boolean;
};

export default function TaskAttachmentFeedback({
  feedback,
  busy,
  retry,
}: {
  feedback: AttachmentFeedback;
  busy: boolean;
  retry: () => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  const handled = useRef<AttachmentFeedback | undefined>(undefined);
  useLayoutEffect(() => {
    if (busy || handled.current === feedback) return;
    handled.current = feedback;
    if (feedback.focus) content.current?.focus();
  }, [busy, feedback]);
  return (
    <div
      className={`task-attachment-feedback${feedback.status === 'error' ? ' field-error' : ''}`}
      ref={content}
      tabIndex={-1}
      role={feedback.status === 'error' ? 'alert' : 'status'}
      aria-atomic="true"
    >
      <p>{feedback.message}</p>
      {feedback.status === 'error' && (
        <button disabled={busy} onClick={retry}>
          {feedback.action === 'preview'
            ? '重新读取附件'
            : feedback.action === 'remove'
              ? '重试移除附件'
              : feedback.action === 'image'
                ? '重新选择图片'
                : '重新选择文件'}
        </button>
      )}
    </div>
  );
}
