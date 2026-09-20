import type { Json } from '../shared/types';

export default function TemplateParameters({
  value,
  edit,
}: {
  value: Record<string, Json>;
  edit: () => void;
}) {
  const entries = Object.entries(value);
  return (
    <section className="template-parameters" aria-label="模板运行参数（只读）">
      <p className="note">运行参数由实例配置统一管理。</p>
      {entries.length ? (
        <dl>
          {entries.map(([key, current]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>
                <pre>{JSON.stringify(current, null, 2)}</pre>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="note">当前没有参数。</p>
      )}
      <button type="button" onClick={edit}>
        编辑实例配置
      </button>
    </section>
  );
}
