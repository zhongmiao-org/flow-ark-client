import { useEffect, useRef, useState, type ReactNode } from 'react';
import './task-modification.css';

export default function TaskModificationPage({
  taskId,
  baseHash,
  name,
  instruction,
  busy,
  conflict,
  invalid,
  change,
  resetReview,
  rebase,
  back,
  controls,
  steps,
}: {
  taskId: string;
  baseHash: string;
  name: string;
  instruction: string;
  busy: boolean;
  conflict: boolean;
  invalid?: string;
  change: (value: string) => void;
  resetReview: () => void;
  rebase: () => void;
  back: () => void;
  controls: ReactNode;
  steps: ReactNode;
}) {
  const [review, setReview] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const disclosure = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setReview(false);
    input.current?.focus({ preventScroll: true });
    document.querySelector('main')?.scrollTo(0, 0);
  }, [taskId, baseHash]);
  useEffect(() => {
    if (review) {
      disclosure.current?.scrollIntoView({ block: 'nearest' });
      disclosure.current?.focus({ preventScroll: true });
    }
  }, [review]);
  return (
    <div className="ai-task-columns task-modification">
      <section className="ai-task-card">
        <label htmlFor="task-modification-instruction">你想怎么调整？</label>
        <textarea
          id="task-modification-instruction"
          ref={input}
          placeholder="输入新的修改要求……"
          value={instruction}
          disabled={busy}
          maxLength={10000}
          aria-invalid={!!invalid || undefined}
          aria-describedby={`task-modification-help${invalid ? ' task-modification-error' : ''}`}
          onChange={(event) => {
            change(event.target.value);
            setReview(false);
          }}
        />
        {conflict && (
          <div className="alert error" role="alert">
            <span>当前草稿已变化，修改要求仍保留，请先重新核对右侧方案。</span>
            <button disabled={busy} onClick={rebase}>
              以当前草稿重新核对
            </button>
          </div>
        )}
        {invalid && (
          <p id="task-modification-error" className="field-error" role="alert">
            {invalid}
          </p>
        )}
        <button
          ref={reviewButton}
          className="primary"
          disabled={busy || conflict || !!invalid || !instruction.trim()}
          aria-expanded={review}
          aria-controls={review ? 'task-modification-review' : undefined}
          onClick={() => {
            resetReview();
            setReview(true);
          }}
        >
          核对修改要求
        </button>
        <p id="task-modification-help">
          先核对发送内容，再生成当前草稿的修改差异。未提出新要求时，不重新套用之前的提议。
        </p>
        {review && (
          <div
            id="task-modification-review"
            className="task-modification-review"
            ref={disclosure}
            tabIndex={-1}
            aria-label="核对修改内容"
          >
            <h2>发送前再确认</h2>
            {controls}
            <button
              disabled={busy}
              onClick={() => {
                resetReview();
                setReview(false);
                reviewButton.current?.focus({ preventScroll: true });
              }}
            >
              收起核对
            </button>
          </div>
        )}
        <button disabled={busy} onClick={back}>
          返回当前方案
        </button>
      </section>
      <section className="ai-task-card">
        <h2>当前方案 · {name}</h2>
        {steps}
        <p className="ai-task-note">新提议仍需检查修改范围并采纳；运行记录与原快照保持不变。</p>
      </section>
    </div>
  );
}
