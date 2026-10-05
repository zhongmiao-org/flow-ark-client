import { useId, useRef, useState } from 'react';
import type { PlanningResult } from '../shared/planning';
import './planning-questions.css';

export default function PlanningQuestions({
  questions,
  answers,
  busy,
  answer,
  clear,
}: {
  questions: PlanningResult['questions'];
  answers: Record<string, string>;
  busy: boolean;
  answer: (id: string, value: string) => void;
  clear: (id: string) => void;
}) {
  const prefix = useId();
  const inputs = useRef(new Map<string, HTMLTextAreaElement>());
  const removalStatus = useRef<HTMLParagraphElement>(null);
  const [removed, setRemoved] = useState(false);
  const previous = Object.entries(answers).filter(
    ([id]) => !questions.some((question) => question.id === id),
  );
  const atLimit = Object.keys(answers).length >= 30;
  if (!questions.length && !previous.length && !removed) return null;
  const completed = questions.filter((question) => answers[question.id]?.trim()).length;
  return (
    <section className="planning-questions" aria-label="补充任务信息">
      {!!questions.length && (
        <div className="planning-questions-heading">
          <h2>还需要了解这些信息</h2>
          <p role="status">
            已补充 {completed} / {questions.length} 项
          </p>
        </div>
      )}
      {atLimit && (
        <p className="planning-questions-note" role="status" id={`${prefix}-limit`}>
          已保留 30 项回答。请先清除不再需要的回答，再补充新问题；已有回答仍可修改。
        </p>
      )}
      {questions.map((question, index) => {
        const value = answers[question.id] ?? '';
        const exists = Object.hasOwn(answers, question.id);
        const limited = atLimit && !exists;
        const note = `${prefix}-answer-${index}`;
        return (
          <fieldset className="ai-task-question" key={question.id} disabled={busy}>
            <legend>
              {index + 1}. {question.prompt}
            </legend>
            {!!question.options.length && (
              <div className="ai-task-options">
                {question.options.map((option) => (
                  <button
                    type="button"
                    disabled={limited}
                    key={option}
                    aria-pressed={value === option}
                    onClick={() => answer(question.id, option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={(element) => {
                if (element) inputs.current.set(question.id, element);
                else inputs.current.delete(question.id);
              }}
              aria-label={question.prompt}
              aria-describedby={limited ? `${note} ${prefix}-limit` : note}
              disabled={limited}
              value={value}
              maxLength={3000}
              placeholder="选择上方选项，或直接补充说明"
              onChange={(event) => answer(question.id, event.target.value)}
            />
            <div className="planning-answer-footer">
              <small id={note}>
                {value.trim() ? '已补充' : '尚未补充'} · {value.length} / 3000 字符
              </small>
              <button
                type="button"
                disabled={busy || !exists}
                onClick={() => {
                  clear(question.id);
                  inputs.current.get(question.id)?.focus();
                }}
              >
                清除此项回答
              </button>
            </div>
          </fieldset>
        );
      })}
      {!!previous.length && (
        <details className="planning-previous-answers">
          <summary>先前补充 · {previous.length} 项</summary>
          <div className="planning-previous-content">
            <p className="planning-questions-note">
              这些回答没有对应的当前问题，仍会随下一次请求发送。请核对是否继续保留。
            </p>
            {previous.map(([id, value], index) => (
              <fieldset className="ai-task-question" key={id} disabled={busy}>
                <legend>先前补充 {index + 1}</legend>
                <textarea
                  ref={(element) => {
                    if (element) inputs.current.set(id, element);
                    else inputs.current.delete(id);
                  }}
                  aria-label={`先前补充 ${index + 1}`}
                  aria-describedby={`${prefix}-previous-${index}`}
                  value={value}
                  maxLength={3000}
                  onChange={(event) => answer(id, event.target.value)}
                />
                <div className="planning-answer-footer">
                  <small id={`${prefix}-previous-${index}`}>{value.length} / 3000 字符</small>
                  <button
                    type="button"
                    onClick={() => {
                      const next = previous[index + 1]?.[0] ?? previous[index - 1]?.[0];
                      clear(id);
                      setRemoved(true);
                      requestAnimationFrame(() => {
                        if (next) inputs.current.get(next)?.focus();
                        else removalStatus.current?.focus();
                      });
                    }}
                  >
                    移除先前补充 {index + 1}
                  </button>
                </div>
              </fieldset>
            ))}
          </div>
        </details>
      )}
      {removed && (
        <p className="planning-questions-note" role="status" tabIndex={-1} ref={removalStatus}>
          已移除先前补充。保存后生效，下次发送前请重新核对内容。
        </p>
      )}
      <p className="planning-questions-note">
        补充内容只用于下一次生成方案；选择答案不会开始执行任务。
      </p>
    </section>
  );
}
