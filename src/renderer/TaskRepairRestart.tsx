import type { taskRunPresentation } from './task-run-presentation';

type Observation = ReturnType<typeof taskRunPresentation>;

function History({ title, rows }: { title: string; rows: Observation['rows'] }) {
  return (
    <details className="task-restart-history">
      <summary>
        {title} · {rows.length} 次
      </summary>
      {rows.length ? (
        <ol tabIndex={0} aria-label={`${title}的完整步骤记录`}>
          {rows.map((row) => (
            <li key={row.instance}>
              <span>{row.name}</span>
              <small>步骤记录：{row.instance}</small>
            </li>
          ))}
        </ol>
      ) : (
        <p>没有此类步骤记录。</p>
      )}
    </details>
  );
}

export default function TaskRepairRestart({
  observation,
  revision,
  applied,
  reviewed,
  review,
  check,
  back,
  modify,
}: {
  observation: Observation;
  revision?: number;
  applied: boolean;
  reviewed: boolean;
  review: (checked: boolean) => void;
  check: () => void;
  back: () => void;
  modify: () => void;
}) {
  return (
    <div className="task-run-columns task-restart-columns">
      <section className="ai-task-card">
        <div className="task-repair-box">
          <h2>从头重新运行</h2>
          <p>{observation.summary}。</p>
          <p>{observation.effectNote}</p>
        </div>
        <label className="run-review-toggle">
          <input
            type="checkbox"
            checked={reviewed}
            disabled={!applied}
            onChange={(event) => review(event.target.checked)}
          />
          我已核对原运行的输出与外部结果，确认可以从头执行
        </label>
        <dl className="task-restart-version">
          <dt>执行起点</dt>
          <dd>第 1 步</dd>
          <dt>采用版本</dt>
          <dd>{applied ? `已采纳的修复方案 · 任务修订 ${revision}` : '修复依据需要重新核对'}</dd>
          <dt>运行前检查</dt>
          <dd>下一页重新核对当前对象、权限、保存位置与可能更改。</dd>
        </dl>
        <p className="task-run-note">
          不恢复旧脚本内部现场。已经完成或结果未知的外部操作，可能在新运行中再次发生。
        </p>
        {!applied && (
          <div className="task-restart-unavailable" role="status">
            <p>当前任务不再保留这次修复依据。请回到任务核对方案，再重新选择目标。</p>
            <button onClick={modify}>回到任务核对</button>
          </div>
        )}
      </section>
      <section className="ai-task-card">
        <h2>已完成操作不会被隐藏</h2>
        <p>
          旧运行：已完成 {observation.completed.length} 次步骤，{observation.unresolved.length}{' '}
          次结果待核对。
          <br />
          新运行：重新检查对象与权限，再按新快照从头执行。
        </p>
        <button className="primary" disabled={!reviewed || !applied} onClick={check}>
          确认，重新检查
        </button>
        <button onClick={back}>先不运行</button>
        <div className="task-restart-records">
          <History title="已完成" rows={observation.completed} />
          <History title="已开始未确认完成" rows={observation.unresolved} />
          <p>按实际执行次数列出，循环中的同一步骤分别保留。步骤完成记录不代替外部结果核对。</p>
        </div>
        <details className="task-restart-history">
          <summary>此前已经提交过试运行确认？</summary>
          <p>下一页会保留该次请求，先查询或查看结果；返回这里不会自动再创建运行。</p>
        </details>
      </section>
    </div>
  );
}
