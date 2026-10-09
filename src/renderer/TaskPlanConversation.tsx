import { Button, Collapse } from 'antd';
import type { ReactNode } from 'react';
import { activateCollapseWithSpace } from './collapseKeyboard';

export default function TaskPlanConversation({
  request,
  answers,
  reply,
  explanation,
  pending,
  dirty,
  busy,
  stale,
  graph,
  edit,
  toggleView,
  discard,
  stepAction,
  undoAction,
  children,
  notice,
}: {
  request: string;
  answers?: Record<string, string>;
  reply: string;
  explanation?: string;
  pending: boolean;
  dirty: boolean;
  busy: boolean;
  stale: boolean;
  graph: boolean;
  edit: () => void;
  toggleView: () => void;
  discard: () => void;
  stepAction?: ReactNode;
  undoAction?: ReactNode;
  children?: ReactNode;
  notice?: ReactNode;
}) {
  const suppliedAnswers = Object.entries(answers || {}).filter(([, value]) => value.trim());
  return (
    <div className="task-plan-conversation" aria-label="任务与方案说明">
      <article className="ai-step-user">
        <h2>你</h2>
        <p>{request}</p>
        {suppliedAnswers.length > 0 && (
          <Collapse
            className="task-plan-answers"
            items={[
              {
                key: 'answers',
                onKeyDown: activateCollapseWithSpace,
                label: `补充信息 · ${suppliedAnswers.length} 项`,
                children: (
                  <ol aria-label="已保存的补充信息">
                    {suppliedAnswers.map(([id, value]) => (
                      <li key={id}>{value}</li>
                    ))}
                  </ol>
                ),
              },
            ]}
          />
        )}
      </article>
      <article className="ai-task-note ai-step-reply">
        <h2>FlowArk</h2>
        <p>{reply}</p>
        {explanation && (
          <Collapse
            items={[
              {
                key: 'explanation',
                onKeyDown: activateCollapseWithSpace,
                label: '查看 AI 的方案说明',
                children: <p>{explanation}</p>,
              },
            ]}
          />
        )}
      </article>
      {notice}
      {dirty && (
        <div className="ai-task-note" role="status">
          <p>
            还有未保存的任务修改。当前仍显示原方案，请继续编辑并重新生成，或放弃这些输入后再确认。
          </p>
          <Button disabled={busy || stale || undefined} onClick={discard}>
            放弃未保存修改
          </Button>
        </div>
      )}
      <Button data-task-modify disabled={busy || stale || undefined} onClick={edit}>
        {dirty ? '继续编辑修改要求' : '继续描述修改'}
      </Button>
      {stepAction}
      <Button disabled={busy || undefined} onClick={toggleView}>
        {graph ? '查看步骤清单' : '查看完整流程图'}
      </Button>
      {undoAction}
      {pending && (
        <p className="task-plan-approval-note">先检查方案和修改范围，采纳后再决定是否试运行。</p>
      )}
      {children}
    </div>
  );
}
