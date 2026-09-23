import { useId, useRef } from 'react';
import type { PlanningResult } from '../shared/planning';
import './planning-questions.css';

export default function PlanningQuestions({
  questions,
  answers,
  busy,
  answer,
}: {
  questions: PlanningResult['questions'];
  answers: Record<string, string>;
  busy: boolean;
  answer: (id: string, value: string) => void;
}) {
  const prefix = useId();
  const inputs = useRef(new Map<string, HTMLTextAreaElement>());
  if (!questions.length) return null;
  const completed = questions.filter((question) => answers[question.id]?.trim()).length;
  return (
    <section className="planning-questions" aria-label="补充任务信息">
      <div className="planning-questions-heading">
        <h2>还需要了解这些信息</h2>
        <p role="status">
          已补充 {completed} / {questions.length} 项
        </p>
      </div>
      {questions.map((question, index) => {
        const value = answers[question.id] ?? '';
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
              aria-describedby={note}
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
                disabled={busy || !value}
                onClick={() => {
                  answer(question.id, '');
                  inputs.current.get(question.id)?.focus();
                }}
              >
                清除此项回答
              </button>
            </div>
          </fieldset>
        );
      })}
      <p className="planning-questions-note">
        补充内容只用于下一次生成方案；选择答案不会开始执行任务。
      </p>
    </section>
  );
}
