import { Button, Descriptions } from 'antd';
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
        <Descriptions
          className="template-parameter-values"
          column={1}
          layout="vertical"
          size="small"
          items={entries.map(([key, current]) => ({
            key,
            label: key,
            children: <pre>{JSON.stringify(current, null, 2)}</pre>,
          }))}
        />
      ) : (
        <p className="note">当前没有参数。</p>
      )}
      <Button htmlType="button" onClick={edit}>
        编辑实例配置
      </Button>
    </section>
  );
}
