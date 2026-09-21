import type { LearningStatus } from '../shared/learning';

export default function FirstTaskGuide({
  progress,
  busy,
  start,
  skip,
}: {
  progress?: LearningStatus;
  busy: boolean;
  start: (mode: 'continue' | 'restart') => void;
  skip: () => void;
}) {
  return (
    <div className="learning-columns">
      <section className="ai-task-card learning-intro">
        <h2>把网页标题保存为文件</h2>
        <p>你会学会四件事：选操作对象、检查步骤、试一次、找到结果。</p>
        {[
          ['1 选目标', '明确看到将操作哪个网页'],
          ['2 看方案', '确认读取内容和输出位置'],
          ['3 试一次', '每一步都能看见进度'],
          ['4 找结果', '打开文件并继续修改'],
        ].map(([heading, text]) => (
          <div className="learning-topic" key={heading}>
            <h3>{heading}</h3>
            <p>{text}</p>
          </div>
        ))}
      </section>
      <section className="ai-task-card learning-practice">
        <h2>练习内容</h2>
        {[
          ['打开选定网页', '对象：内置浏览器 · 示例资料页'],
          ['读取页面标题', '字段：页面标题 · 仅读取'],
          ['标题不为空？', '满足条件继续；否则结束并提醒'],
          ['保存为文本文件', '位置：任务输出 · 新建文件，不覆盖'],
        ].map(([heading, text], i) => (
          <div className="learning-step" key={heading}>
            <span>{String(i + 1).padStart(2, '0')}</span>
            <div>
              <h3>{heading}</h3>
              <p>{text}</p>
            </div>
          </div>
        ))}
        <p className="ai-task-note">
          练习只读取示例页，并在选定目录新建一个文本文件。不会发送消息或提交网页表单。
        </p>
        {progress?.taskId && (
          <p className="learning-resume-note" role="status">
            {progress.status === 'completed'
              ? '上次学习已完成。'
              : `已完成 ${Object.keys(progress.achieved).length} / 4 项学习。`}{' '}
            继续会保留原任务；重新学习会创建新草稿，旧任务和结果保留。
          </p>
        )}
        <div className="ai-task-actions">
          <button
            className="primary"
            disabled={busy || !progress || (!!progress.taskId && !progress.taskExists)}
            onClick={() => start('continue')}
          >
            {progress?.status === 'completed'
              ? '查看上次结果'
              : progress?.taskId
                ? '继续教学'
                : '跟着做一次'}
          </button>
          {progress?.taskId && (
            <button disabled={busy} onClick={() => start('restart')}>
              重新开始学习
            </button>
          )}
          {progress?.status !== 'completed' && (
            <button disabled={busy || !progress} onClick={skip}>
              先跳过
            </button>
          )}
        </div>
        {progress?.taskId && !progress.taskExists && (
          <p role="alert">原教学任务已不存在，请选择重新开始学习。</p>
        )}
      </section>
    </div>
  );
}
