import { useEffect, useRef, useState } from 'react';
import type { Attention, Bootstrap } from '../shared/types';
import AttentionDetails from './AttentionDetails';

export default function RunResultReview({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Attention[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const scroll = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  useEffect(() => {
    if (open) heading.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (error) feedback.current?.focus();
  }, [error]);
  const read = async () => {
    const request = ++sequence.current;
    setBusy(true);
    setError('');
    setItems(null);
    try {
      const data: Bootstrap = await window.flowark.request('bootstrap', {});
      if (request !== sequence.current) return;
      setItems(
        data.attention.filter(
          (item) =>
            item.kind === 'unknown-result' &&
            (item.detail?.runId === runId ||
              (Array.isArray(item.detail?.runIds) && item.detail.runIds.includes(runId))),
        ),
      );
    } catch (reason) {
      if (request === sequence.current)
        setError(reason instanceof Error ? reason.message : '暂时无法读取待核对结果。');
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  };
  const close = () => {
    sequence.current++;
    setOpen(false);
    setBusy(false);
    setError('');
    requestAnimationFrame(() => {
      document.querySelector('main')?.scrollTo({ top: scroll.current });
      trigger.current?.focus({ preventScroll: true });
    });
  };
  return (
    <div className="run-result-review">
      <button
        ref={trigger}
        aria-expanded={open}
        aria-controls="run-result-review-content"
        onClick={() => {
          if (open) close();
          else {
            scroll.current = document.querySelector('main')?.scrollTop ?? 0;
            setOpen(true);
            void read();
          }
        }}
      >
        {open ? '收起待核对结果' : '查看待核对结果'}
      </button>
      {open && (
        <section id="run-result-review-content" aria-labelledby="run-result-review-heading">
          <h3 id="run-result-review-heading" ref={heading} tabIndex={-1}>
            本次运行的待核对结果
          </h3>
          <p>只显示明确关联此运行的结果待核对提醒。已读不代表结果已确认；查看不会重试操作。</p>
          {busy && <p role="status">正在读取待核对记录…</p>}
          {error && (
            <p className="field-error" role="alert" ref={feedback} tabIndex={-1}>
              {error}
            </p>
          )}
          {items && (
            <>
              <p role="status">
                {items.length
                  ? `已读取 ${items.length} 条关联记录`
                  : '当前没有直接关联此运行的待核对提醒；这不代表外部业务已经成功。'}
              </p>
              {items.map((item) => (
                <article key={item.id} aria-label={item.title}>
                  <h4>{item.title}</h4>
                  <p>{item.read ? '已读 · 结果仍待核对' : '未读 · 结果待核对'}</p>
                  <AttentionDetails item={item} />
                </article>
              ))}
            </>
          )}
          <div className="ai-task-actions">
            <button disabled={busy} onClick={() => void read()}>
              {error ? '重试读取' : '刷新记录'}
            </button>
            <button onClick={close}>返回已保存结果</button>
          </div>
        </section>
      )}
    </div>
  );
}
