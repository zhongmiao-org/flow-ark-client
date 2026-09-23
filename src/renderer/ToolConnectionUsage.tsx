import type { ToolConnection } from '../shared/tool-connections';

export type ConnectionTaskReference = NonNullable<ToolConnection['taskReferences']>[number];

export default function ToolConnectionUsage({
  connection,
  busy = false,
  openTask,
}: {
  connection: ToolConnection;
  busy?: boolean;
  openTask?: (task: ConnectionTaskReference) => void;
}) {
  const references = connection.taskReferences;
  return (
    <section className="tool-usage" aria-label="引用此连接的任务">
      <h3>任务引用{references ? ` · ${references.length} 个` : ''}</h3>
      <p>
        {connection.activeRunCount === undefined
          ? '尚未取得关联流程的活动运行数量。'
          : `关联流程中的活动运行：${connection.activeRunCount} 个。`}
        选择连接不等于授权执行。
      </p>
      {references ? (
        references.length ? (
          <ul className="tool-usage-list">
            {references.map((task) => (
              <li key={task.taskId}>
                <strong>{task.description || '未命名任务'}</strong>
                <small>流程 {task.flowId}</small>
                {openTask && (
                  <button disabled={busy} onClick={() => openTask(task)}>
                    查看任务
                    <span className="sr-only">：{task.description || task.taskId}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>本次读取未发现任务引用此连接。</p>
        )
      ) : (
        <p>尚未取得任务引用，请刷新后核对。</p>
      )}
      <p className="ai-task-note">
        断开、删除或重新保存连接后，原任务的工具选择需重新核对；任务草稿和已有运行记录保留。
      </p>
      {!!connection.activeRunCount && (
        <p className="ai-task-note tool-warning">
          断开或删除会取消本连接正在执行或收尾的工具调用。已发送操作的结果可能未知，请查看运行回执；不会自动重试或回滚外部操作。
        </p>
      )}
    </section>
  );
}
