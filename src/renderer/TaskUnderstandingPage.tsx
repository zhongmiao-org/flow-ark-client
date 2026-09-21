import type { ReactNode } from 'react';
import type { PlanningTask, PlanningResult } from '../shared/planning';
import { learningPrompt } from '../shared/learning';
import type { TaskOutputTarget } from '../shared/task-output';

export type OutputOptions = Pick<TaskOutputTarget, 'name' | 'onConflict'>;
export default function TaskUnderstandingPage({
  task,
  description,
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
  const web = task.webTarget;
  const output = task.outputTarget;
  const policy =
    options.onConflict === 'number' ? '同名自动加序号，保留原文件' : '覆盖所选同名文件';
  return (
    <div className="task-understanding-columns">
      <section className="ai-task-card task-understanding-input">
        <div className="task-understanding-reply">
          <b>FlowArk</b>
          <p>
            {result?.summary ||
              (description === learningPrompt
                ? '练习目标：读取你选定网页的标题，标题不为空时保存成文本；否则告诉你原因。'
                : `按你提供的需求：${description}`)}
          </p>
        </div>
        {result?.kind === 'clarify' &&
          result.questions.map((q) => (
            <fieldset className="ai-task-question" key={q.id} disabled={busy}>
              <legend>{q.prompt}</legend>
              <div className="ai-task-options">
                {q.options.map((option) => (
                  <button
                    type="button"
                    key={option}
                    aria-pressed={answers[q.id] === option}
                    onClick={() => answer(q.id, option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <textarea
                aria-label={q.prompt}
                value={answers[q.id] ?? ''}
                maxLength={3000}
                placeholder="也可以直接补充说明"
                onChange={(e) => answer(q.id, e.target.value)}
              />
            </fieldset>
          ))}
        <h2>{requiredOutput && !output ? '还差一个信息' : '确认输出信息'}</h2>
        <div className="task-understanding-directory">
          <label htmlFor="task-output-directory">结果保存到哪里？</label>
          <button
            id="task-output-directory"
            disabled={busy}
            onClick={choose}
            title={output?.directory}
          >
            {output ? '任务输出（本机目录）· 更换' : '选择本机输出目录'}
          </button>
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
        {controls}
      </section>
      <section className="ai-task-card task-understanding-summary">
        <h2>任务理解卡</h2>
        <div className="task-understanding-fact">
          <h3>输入来源</h3>
          <p>
            {web ? '你确认的网页及明确提供的资料；不读取其他标签' : '你填写的需求及明确提供的资料'}
          </p>
          {!!task.context.length && <p>{task.context.map((c) => c.label).join('、')}</p>}
        </div>
        <div className="task-understanding-fact" aria-label="已选网页来源">
          <div className="task-understanding-fact-heading">
            <h3>操作对象</h3>
            <button disabled={busy} onClick={target}>
              {web ? '查看或更换网页目标' : '选择网页对象'}
            </button>
          </div>
          <p title={web?.page.url}>
            {web
              ? `内置浏览器 · ${web.page.title || '未命名网页'} · 账号未核对`
              : '尚未选择网页对象，按需求核对后再执行。'}
          </p>
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
        </div>
        <div className="task-understanding-fact" aria-label="输出结果">
          <h3>输出结果</h3>
          <p>{output ? `任务输出 / ${options.name}（${policy}）` : '尚未选择输出目录'}</p>
          {output && (
            <>
              <details className="task-understanding-output-options">
                <summary>修改文件名或移除目录</summary>
                <p className="task-understanding-path">{output.directory}</p>
                <label>
                  输出文件名
                  <input
                    disabled={busy}
                    value={options.name}
                    maxLength={255}
                    onChange={(e) => changed({ ...options, name: e.target.value })}
                  />
                </label>
                <button disabled={busy} onClick={clear}>
                  移除输出目录
                </button>
              </details>
            </>
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
