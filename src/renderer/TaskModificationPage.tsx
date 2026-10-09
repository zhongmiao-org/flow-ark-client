import { Button, Input } from 'antd';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Flow } from '../shared/types';
import type { TaskStepContext } from './task-step-presentation';
import TaskStepList, { type TaskStepListHandle } from './TaskStepList';
import TaskStepInspector from './TaskStepInspector';
import './task-modification.css';

export default function TaskModificationPage({
  taskId,
  baseHash,
  name,
  revision,
  instruction,
  busy,
  conflict,
  invalid,
  change,
  resetReview,
  rebase,
  back,
  controls,
  flow,
  context,
  selected,
  select,
}: {
  taskId: string;
  baseHash: string;
  name: string;
  revision: number;
  instruction: string;
  busy: boolean;
  conflict: boolean;
  invalid?: string;
  change: (value: string) => void;
  resetReview: () => void;
  rebase: () => void;
  back: () => void;
  controls: ReactNode;
  flow: Flow;
  context: TaskStepContext;
  selected: string;
  select: (id: string) => void;
}) {
  const [review, setReview] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const disclosure = useRef<HTMLDivElement>(null);
  const stepList = useRef<TaskStepListHandle>(null);
  const inspector = useRef<HTMLDivElement>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectFocus, setInspectFocus] = useState(0);
  const inspectStep = (id: string) => {
    select(id);
    setInspecting(true);
    setInspectFocus((value) => value + 1);
  };
  useLayoutEffect(() => {
    if (!inspecting) return;
    const heading = inspector.current?.querySelector<HTMLElement>('[data-task-step-heading]');
    heading?.scrollIntoView({ block: 'nearest' });
    heading?.focus({ preventScroll: true });
  }, [inspectFocus, inspecting]);
  useEffect(() => {
    setReview(false);
    setInspecting(false);
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
        <Input.TextArea
          status={!!invalid || undefined ? 'error' : undefined}
          id="task-modification-instruction"
          ref={(instance) => {
            input.current = instance?.resizableTextArea?.textArea ?? null;
          }}
          placeholder="输入新的修改要求……"
          value={instruction}
          disabled={busy || undefined}
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
            <Button disabled={busy || undefined} onClick={rebase}>
              以当前草稿重新核对
            </Button>
          </div>
        )}
        {invalid && (
          <p id="task-modification-error" className="field-error" role="alert">
            {invalid}
          </p>
        )}
        <Button
          ref={reviewButton}
          type="primary"
          disabled={busy || conflict || !!invalid || !instruction.trim() || undefined}
          aria-expanded={review}
          aria-controls={review ? 'task-modification-review' : undefined}
          onClick={() => {
            resetReview();
            setReview(true);
          }}
        >
          核对修改要求
        </Button>
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
            <Button
              disabled={busy || undefined}
              onClick={() => {
                resetReview();
                setReview(false);
                reviewButton.current?.focus({ preventScroll: true });
              }}
            >
              收起核对
            </Button>
          </div>
        )}
        <Button disabled={busy || undefined} onClick={back}>
          返回当前方案
        </Button>
      </section>
      <section className="ai-task-card">
        <h2 title={name}>当前方案 · 修订 {revision}</h2>
        <TaskStepList
          key={`${taskId}:${baseHash}`}
          ref={stepList}
          flow={flow}
          context={context}
          selected={selected}
          select={inspectStep}
        />
        {inspecting && (
          <div ref={inspector}>
            <TaskStepInspector
              flow={flow}
              context={context}
              selected={selected}
              select={inspectStep}
              actions={
                <Button
                  onClick={() => {
                    setInspecting(false);
                    stepList.current?.reveal(selected);
                  }}
                >
                  返回当前方案步骤
                </Button>
              }
            />
          </div>
        )}
        <p className="ai-task-note">新提议仍需检查修改范围并采纳；运行记录与原快照保持不变。</p>
      </section>
    </div>
  );
}
