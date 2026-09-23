import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PlanningTask, PlanningResult } from '../shared/planning';
import './task-generation.css';

export default function TaskGenerationPage({
  task,
  result,
  busy,
  savedFlow,
  controls,
  cancel,
  edit,
  settings,
  tools,
  showSaved,
  resetReview,
}: {
  task: PlanningTask;
  result?: PlanningResult;
  busy: boolean;
  savedFlow?: string;
  controls: ReactNode;
  cancel: () => void;
  edit: () => void;
  settings: () => void;
  tools: () => void;
  showSaved: () => void;
  resetReview: () => void;
}) {
  const generating = task.status === 'generating';
  const unsupported = task.status === 'unsupported';
  const [retry, setRetry] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const review = useRef<HTMLDivElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setRetry(false);
    heading.current?.focus({ preventScroll: true });
    document.querySelector('main')?.scrollTo(0, 0);
  }, [task.id, task.status]);
  useEffect(() => {
    if (!retry) return;
    review.current?.scrollIntoView({ block: 'nearest' });
    review.current?.focus({ preventScroll: true });
  }, [retry]);
  return (
    <section className="ai-task-card task-generation" aria-labelledby="generation-heading">
      <span
        className={`badge state-${generating ? 'RUNNING' : unsupported ? 'WAITING_INPUT' : 'FAILED'}`}
        role="status"
      >
        {generating ? '正在生成' : unsupported ? '缺少可用能力' : '生成未完成'}
      </span>
      <h2 id="generation-heading" tabIndex={-1} ref={heading}>
        {generating
          ? '正在理解需求并检查可用步骤'
          : unsupported
            ? '这项操作还缺少可用能力'
            : '可以重试，也可以先修改需求'}
      </h2>
      {generating ? (
        <>
          <article className="task-generation-current">
            <h3>{task.scope ? '当前修改要求' : '当前任务'}</h3>
            <p>{task.scope?.instruction || task.description}</p>
            {task.scope && <small>仅修改所选步骤 · {task.scope.nodeId}</small>}
          </article>
          <p>
            生成结果完整且校验通过后，才显示可确认的方案。
            <br />
            取消会保留需求、附件和补问；不会创建运行。
          </p>
        </>
      ) : unsupported ? (
        <>
          {result?.summary && <p className="task-generation-reason">{result.summary}</p>}
          {!!result?.limitations.length && (
            <ul aria-label="当前能力限制">
              {result.limitations.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          )}
          <p>
            你可以连接具备所需能力的工具，或调整任务要求。
            <br />
            连接新的工具后，仍需重新选择对象并核对本次任务的范围。
          </p>
        </>
      ) : (
        <>
          <p className="task-generation-reason" role="alert">
            {task.error || '没有取得完整方案，请重新核对需求后生成。'}
          </p>
          <p>
            本次不完整的结果不会替换已采纳的草稿。
            <br />
            重试只重新生成提案，不会重复运行任务。
          </p>
        </>
      )}
      {savedFlow && (
        <p className="task-generation-preserved">
          已保留草稿 · {savedFlow}；本次规划没有启动新的运行。
        </p>
      )}
      <div className="ai-task-actions">
        {generating ? (
          <button disabled={busy} onClick={cancel}>
            {busy ? '正在取消…' : '取消生成'}
          </button>
        ) : unsupported ? (
          <>
            <button className="primary" disabled={busy} onClick={tools}>
              查看应用与工具
            </button>
            <button disabled={busy} onClick={edit}>
              调整任务要求
            </button>
          </>
        ) : (
          <>
            <button
              className="primary"
              ref={retryButton}
              aria-expanded={retry}
              disabled={busy}
              onClick={() => {
                if (!retry) resetReview();
                setRetry(true);
              }}
            >
              重试生成
            </button>
            <button disabled={busy} onClick={edit}>
              返回修改需求
            </button>
            <button disabled={busy} onClick={settings}>
              检查 AI 配置
            </button>
          </>
        )}
        {!generating && savedFlow && (
          <button disabled={busy} onClick={showSaved}>
            查看保留的草稿
          </button>
        )}
      </div>
      {retry && !generating && !unsupported && (
        <div
          className="task-generation-review"
          tabIndex={-1}
          ref={review}
          aria-label="核对重试内容"
        >
          <h3>核对后重新生成</h3>
          <p>检查本次发送的内容与 AI 服务，再明确确认。重试会发起新的模型请求。</p>
          {controls}
          <button
            disabled={busy}
            onClick={() => {
              resetReview();
              setRetry(false);
              retryButton.current?.focus();
            }}
          >
            取消重试
          </button>
        </div>
      )}
    </section>
  );
}
