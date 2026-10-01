const neutral = new URL('./assets/status/neutral.svg?no-inline', import.meta.url).href;
const success = new URL('./assets/status/success.svg?no-inline', import.meta.url).href;

export default function TaskPlanIdentity({
  name,
  revision,
  pending,
  dirty,
  stale,
}: {
  name: string;
  revision: number;
  pending: boolean;
  dirty: boolean;
  stale: boolean;
}) {
  const saved = !pending && !dirty && !stale;
  return (
    <div className="task-plan-identity">
      <h2 tabIndex={-1} data-plan-preview-heading>
        <img src={neutral} alt="" aria-hidden="true" />
        <span>{name}</span>
      </h2>
      <span className={saved ? 'task-plan-saved' : ''} role="status">
        <img src={saved ? success : neutral} alt="" aria-hidden="true" />
        {stale
          ? '草稿已变化，请重新读取'
          : dirty
            ? '有未保存修改'
            : pending
              ? '待采纳方案'
              : `修订 ${revision} · 已保存`}
      </span>
    </div>
  );
}
