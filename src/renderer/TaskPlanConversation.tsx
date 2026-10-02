import type { ReactNode } from 'react';

export default function TaskPlanConversation({
  request,
  reply,
  pending,
  dirty,
  busy,
  stale,
  graph,
  edit,
  toggleView,
  discard,
  children,
  notice,
}: {
  request: string;
  reply: string;
  pending: boolean;
  dirty: boolean;
  busy: boolean;
  stale: boolean;
  graph: boolean;
  edit: () => void;
  toggleView: () => void;
  discard: () => void;
  children?: ReactNode;
  notice?: ReactNode;
}) {
  return (
    <div className="task-plan-conversation" aria-label="任务与方案说明">
      <article className="ai-step-user">
        <h2>你</h2>
        <p>{request}</p>
      </article>
      <article className="ai-task-note ai-step-reply">
        <h2>FlowArk</h2>
        <p>{reply}</p>
      </article>
      {notice}
      {dirty && (
        <div className="ai-task-note" role="status">
          <p>
            还有未保存的任务修改。当前仍显示原方案，请继续编辑并重新生成，或放弃这些输入后再确认。
          </p>
          <button disabled={busy || stale} onClick={discard}>
            放弃未保存修改
          </button>
        </div>
      )}
      <button data-task-modify disabled={busy || stale} onClick={edit}>
        {dirty ? '继续编辑修改要求' : '继续描述修改'}
      </button>
      <button disabled={busy} onClick={toggleView}>
        {graph ? '查看步骤清单' : '查看完整流程图'}
      </button>
      {pending && (
        <p className="task-plan-approval-note">先检查方案和修改范围，采纳后再决定是否试运行。</p>
      )}
      {children}
    </div>
  );
}
