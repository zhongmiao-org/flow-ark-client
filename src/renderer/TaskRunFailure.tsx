import type { ReactNode } from 'react';
import type { taskRunPresentation } from './task-run-presentation';

type Model = ReturnType<typeof taskRunPresentation>;

function failureReason(model: Model, error: string) {
  if (model.node?.type === 'assert' && error === `结果断言失败：${model.node.id}`)
    return {
      title: '结果没有通过检查',
      explanation: '这一步的实际值未满足方案中的检查条件。请核对前面步骤的输出和当前检查条件。',
    };
  if (
    model.node?.type === 'browser' &&
    [
      '所选网页已变化，请重新选择目标',
      '所选元素内容或结构已变化，请重新选取',
      '已选元素内容或结构已变化，请回到任务重新选取',
      '网页或聚焦目标已变化，请重新选取',
    ].includes(error)
  )
    return {
      title: '原先选择的网页目标已变化',
      explanation: '当前网页或所选元素与记录的目标不一致。重新核对目标后，再检查修改方案。',
    };
  if (
    model.node?.type === 'browser' &&
    ['浏览器命令超时（含框架定位）', '网页操作超时'].includes(error)
  )
    return {
      title: '网页操作超时',
      explanation:
        '未在限定时间内取得操作完成记录。请先核对当前网页、目标和可能发生的更改，再决定是否修改或重新运行。',
    };
  if (model.node?.type === 'file' && error === '输出文件已存在，请更换文件名；原文件未覆盖')
    return {
      title: '保存位置已有同名文件',
      explanation: '本次新建步骤没有覆盖原文件。请回到任务检查文件名和同名处理方式。',
    };
  return {
    title: model.current?.started && !model.current.ended ? '这一步没有完成' : '运行未能继续',
    explanation:
      error && error.length <= 240 && error.split('\n').length <= 3
        ? error
        : '运行已停止。展开错误详情，核对具体原因后再修改方案。',
  };
}

function stepNames(rows: Model['rows'], empty: string) {
  return rows.length
    ? rows
        .slice(0, 6)
        .map((row) => row.name)
        .join('、') + (rows.length > 6 ? ` 等 ${rows.length} 条，完整记录见详细信息。` : '')
    : empty;
}

export default function TaskRunFailure({
  model,
  error,
  target,
}: {
  model: Model;
  error: string;
  target: ReactNode;
}) {
  const reason = failureReason(model, error);
  return (
    <>
      <span className="badge state-WAITING_INPUT">需要处理</span>
      <h2 className="task-run-current">{reason.title}</h2>
      <p role="status">{reason.explanation}</p>
      {model.current?.ended && (
        <p>最后记录的“{model.current.name}”已确认完成；当前记录未确认后续执行位置。</p>
      )}
      <section className="task-run-file task-failure-completed" aria-label="失败前已完成">
        <h3>已完成</h3>
        <p>{stepNames(model.completed, '尚无已确认完成的步骤记录')}</p>
      </section>
      <section className="task-run-file task-failure-remaining" aria-label="失败时尚未完成">
        <h3>尚未完成</h3>
        <p>已开始但未确认完成：{stepNames(model.unresolved, '无此类记录')}</p>
        <p>尚未执行：{stepNames(model.unvisited, '无此类记录')}。</p>
        {!!model.unvisited.length && (
          <p className="task-run-path">未执行清单可能包含未选择的分支。</p>
        )}
      </section>
      <section className="task-run-file task-failure-impact" aria-label="失败时已记录影响">
        <h3>已记录的影响</h3>
        <p>{model.summary}</p>
        <p>{model.effectNote}</p>
      </section>
      <details className="task-failure-details">
        <summary>错误详情与运行对象</summary>
        <p>
          {model.view.step.label} · 已记录耗时：{model.view.elapsed.label}
        </p>
        {error ? (
          <pre tabIndex={0} aria-label="完整运行错误">
            {error}
          </pre>
        ) : (
          <p>没有保存具体错误说明。</p>
        )}
        {target}
      </details>
    </>
  );
}
