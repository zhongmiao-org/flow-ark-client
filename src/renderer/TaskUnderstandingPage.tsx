import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { PlanningTask, PlanningResult, PlanningContext } from '../shared/planning';
import { learningPrompt } from '../shared/learning';
import PlanningQuestions from './PlanningQuestions';
import type { TaskOutputTarget } from '../shared/task-output';

export type OutputFeedback = {
  kind: 'choosing' | 'clearing' | 'chosen' | 'cancelled' | 'cleared' | 'error';
  message: string;
};
export type OutputOptions = Pick<TaskOutputTarget, 'name' | 'onConflict'>;
export default function TaskUnderstandingPage({
  task,
  description,
  context,
  outputDirty,
  outputNameError,
  outputFeedback,
  result,
  answers,
  options,
  busy,
  requiredOutput,
  changed,
  answer,
  choose,
  clear,
  describe,
  target,
  controls,
}: {
  task: PlanningTask;
  description: string;
  context: PlanningContext[];
  outputDirty: boolean;
  outputNameError?: string;
  outputFeedback?: OutputFeedback;
  result?: PlanningResult;
  answers: Record<string, string>;
  options: OutputOptions;
  busy: boolean;
  requiredOutput: boolean;
  changed: (value: OutputOptions) => void;
  answer: (id: string, value: string) => void;
  choose: () => void;
  clear: () => void;
  describe: () => void;
  target: () => void;
  controls: ReactNode;
}) {
  const outputErrorId = useId();
  const outputFeedbackId = useId();
  const directoryButton = useRef<HTMLButtonElement>(null);
  const feedbackElement = useRef<HTMLParagraphElement>(null);
  const handledFeedback = useRef<OutputFeedback | undefined>(outputFeedback);
  const outputPending = outputFeedback?.kind === 'choosing' || outputFeedback?.kind === 'clearing';
  useLayoutEffect(() => {
    if (busy || !outputFeedback || outputPending || handledFeedback.current === outputFeedback)
      return;
    handledFeedback.current = outputFeedback;
    if (outputFeedback.kind === 'error') feedbackElement.current?.focus();
    else directoryButton.current?.focus();
  }, [busy, outputFeedback, outputPending]);
  const outputInput = useRef<HTMLInputElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  useEffect(() => {
    if (outputNameError) setOptionsOpen(true);
  }, [outputNameError]);
  const web = task.webTarget;
  const output = task.outputTarget;
  const sources = [
    ...(context.length ? [`${context.length} 项资料`] : []),
    ...(task.attachments?.length ? [`${task.attachments.length} 个附件`] : []),
  ];
  const policy =
    options.onConflict === 'number' ? '同名自动加序号，保留原文件' : '覆盖所选同名文件';
  return (
    <div className="task-understanding-columns">
      <section className="ai-task-card task-understanding-input">
        <div className="task-understanding-reply">
          <b>{result ? 'FlowArk · 上次理解' : '当前需求'}</b>
          <p>
            {result?.summary ||
              (description === learningPrompt
                ? '练习目标：读取你选定网页的标题，标题不为空时保存成文本；否则告诉你原因。'
                : `按你提供的需求：${description}`)}
          </p>
        </div>
        {result?.kind === 'clarify' && (
          <PlanningQuestions
            questions={result.questions}
            answers={answers}
            busy={busy}
            answer={answer}
          />
        )}
        <h2>{requiredOutput && !output ? '还差一个信息' : '确认输出信息'}</h2>
        <div className="task-understanding-directory" aria-busy={outputPending}>
          <label htmlFor="task-output-directory">结果保存到哪里？</label>
          <button
            id="task-output-directory"
            ref={directoryButton}
            aria-describedby={outputFeedback ? outputFeedbackId : undefined}
            disabled={busy || !!outputNameError}
            onClick={choose}
            title={output?.directory}
          >
            {outputFeedback?.kind === 'choosing'
              ? '等待目录选择…'
              : output
                ? '任务输出（本机目录）· 更换'
                : '选择本机输出目录'}
          </button>
          {outputFeedback && (
            <p
              id={outputFeedbackId}
              ref={feedbackElement}
              tabIndex={-1}
              role={outputFeedback.kind === 'error' ? 'alert' : 'status'}
              className={
                outputFeedback.kind === 'error'
                  ? 'task-output-feedback is-error'
                  : 'task-output-feedback'
              }
            >
              {outputFeedback.message}
            </p>
          )}
          {!requiredOutput && !output && (
            <small>需要保存文本时选择目录；其他需求可先生成方案。</small>
          )}
        </div>
        <fieldset className="task-output-policy" disabled={busy}>
          <legend>已有同名文件时</legend>
          <label>
            <input
              type="radio"
              name="task-output-policy"
              checked={options.onConflict === 'number'}
              onChange={() => changed({ ...options, onConflict: 'number' })}
            />
            新建带序号的文件，保留原文件
          </label>
          <label>
            <input
              type="radio"
              name="task-output-policy"
              checked={options.onConflict === 'overwrite'}
              onChange={() => changed({ ...options, onConflict: 'overwrite' })}
            />
            覆盖原文件
          </label>
        </fieldset>
        {outputNameError && (
          <div className="ai-task-note" role="alert">
            <p>输出文件名需要修改，暂不能选择目录{output ? '、保存或生成方案' : ''}。</p>
            <button
              disabled={busy}
              onClick={() => {
                setOptionsOpen(true);
                requestAnimationFrame(() => outputInput.current?.focus());
              }}
            >
              修改输出文件名
            </button>
          </div>
        )}
        <div className="task-understanding-controls">{controls}</div>
      </section>
      <section className="ai-task-card task-understanding-summary">
        <h2>任务理解卡</h2>
        <div className="task-understanding-fact">
          <h3>输入来源</h3>
          <p>
            {web
              ? web.element
                ? '已选网页元素的文字；不读取其他元素或标签'
                : '你确认的网页；不读取其他标签'
              : task.toolTargets?.length
                ? '你填写的需求与已选工具定义'
                : '你填写的需求'}
            {sources.length ? `；另有 ${sources.join('、')}` : ''}
          </p>
          <details className="task-understanding-extra">
            <summary>资料与发送范围</summary>
            {web && (
              <>
                <p>网页来源：{web.page.title || '未命名网页'}</p>
                <p className="task-understanding-url">{web.page.url}</p>
                <p>
                  {web.element
                    ? `读取范围：${web.element.target.label || web.element.target.tag}（${web.element.target.framePath.length ? `${web.element.target.framePath.length} 层框架` : '主页面'}）。`
                    : '读取范围：已确认网页中的只读操作。'}
                  这是已保存的选择；执行前仍需核对对象是否有效。
                </p>
              </>
            )}
            {!!context.length && (
              <ul className="task-understanding-input-list" aria-label="当前资料">
                {context.map((entry) => (
                  <li key={entry.id}>
                    {entry.label || '未命名资料'} · {entry.text.length} 字符
                  </li>
                ))}
              </ul>
            )}
            {!!task.attachments?.length && (
              <ul className="task-understanding-input-list" aria-label="已选附件">
                {task.attachments.map((attachment) => (
                  <li key={attachment.id}>
                    {attachment.name} · {attachment.kind === 'image' ? '图片副本' : '文本副本'}
                  </li>
                ))}
              </ul>
            )}
            <p>可展开“查看本次发送给…的内容”核对完整范围。</p>
          </details>
        </div>
        <div className="task-understanding-fact" aria-label="已选操作对象">
          <div className="task-understanding-fact-heading">
            <h3>操作对象</h3>
            <button disabled={busy} onClick={target}>
              {web || task.toolTargets?.length ? '查看或更换任务对象' : '选择任务对象'}
            </button>
          </div>
          <p title={web?.page.url}>
            {web
              ? `内置浏览器 · ${web.page.title || '未命名网页'} · 账号未核对`
              : task.toolTargets?.length
                ? '已选择工具对象；可先核对内容并生成方案。'
                : '尚未选择操作对象，按需求核对后再执行。'}
          </p>
          {web?.element && (
            <p>
              只读取已选元素：{web.element.target.label || web.element.target.tag} ·{' '}
              {web.element.target.framePath.length
                ? `${web.element.target.framePath.length} 层框架`
                : '主页面'}
              。页面或元素变化后需重新选择。
            </p>
          )}
          {!!task.toolTargets?.length && (
            <details className="task-understanding-tools">
              <summary>核对已选工具 · {task.toolTargets.length} 个对象</summary>
              <ul>
                {task.toolTargets.map((target) => (
                  <li key={target.selectionId}>
                    {target.displayName} · {target.tools.length} 项工具
                  </li>
                ))}
              </ul>
              <p>账号、工作区和读写影响尚未核对，所选定义将在你核对并生成时发送给模型。</p>
            </details>
          )}
        </div>
        <div className="task-understanding-fact">
          <h3>修改内容</h3>
          <p>
            {output
              ? options.onConflict === 'number'
                ? '在所选目录新建文本文件，保留同名文件。'
                : '只覆盖已确认文件名的文本文件。'
              : '生成方案后核对实际修改范围与所需资源。'}
            {web ? ' 不改变网页内容。' : ''}
          </p>
          <details className="task-understanding-extra">
            <summary>核对修改范围</summary>
            <p>以上是你选定的范围；方案生成后还需核对全部读写步骤。</p>
          </details>
        </div>
        <div className="task-understanding-fact" aria-label="输出结果">
          <h3>输出结果</h3>
          <p>{output ? `任务输出 / ${options.name}（${policy}）` : '尚未选择输出目录'}</p>
          {outputDirty && (
            <span className="task-understanding-output-state">输出偏好已修改 · 待保存</span>
          )}
          <details
            className="task-understanding-output-options"
            open={optionsOpen}
            onToggle={(event) => setOptionsOpen(event.currentTarget.open)}
          >
            <summary>文件名与输出目录</summary>
            <p className="task-understanding-path">
              {output?.directory || '尚未选择目录；文件名可先填写。'}
            </p>
            <label>
              输出文件名
              <input
                disabled={busy}
                ref={outputInput}
                aria-invalid={!!outputNameError}
                aria-describedby={outputNameError ? outputErrorId : undefined}
                value={options.name}
                maxLength={255}
                onChange={(e) => changed({ ...options, name: e.target.value })}
              />
            </label>
            {output && (
              <button disabled={busy} onClick={clear}>
                {outputFeedback?.kind === 'clearing' ? '正在移除…' : '移除输出目录'}
              </button>
            )}
          </details>
          {outputNameError && (
            <p id={outputErrorId} className="task-output-name-error">
              {outputNameError}
            </p>
          )}
        </div>
        <button className="task-understanding-describe" disabled={busy} onClick={describe}>
          理解不对，重新描述
        </button>
        {result?.limitations.map((limitation, i) => (
          <p className="ai-task-note" key={i}>
            {limitation}
          </p>
        ))}
      </section>
    </div>
  );
}
