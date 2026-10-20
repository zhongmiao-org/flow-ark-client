import { Alert, Button, Card, Checkbox, Select } from 'antd';
import type { BatchDeclaration } from '../shared/entry-batches';
import { assertBatchDeclaration } from '../../contracts/entry-batch-decision.mjs';

type Choice = { path: string[]; label: string; schema: any };
function fields(schema: any, path: string[] = [], labels: string[] = []): Choice[] {
  if (
    !schema ||
    typeof schema !== 'object' ||
    Array.isArray(schema) ||
    path.length >= 16 ||
    ['$ref', '$dynamicRef', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else'].some((k) =>
      Object.hasOwn(schema, k),
    )
  )
    return [];
  if (schema.type !== 'object' || !schema.properties || !Array.isArray(schema.required)) return [];
  return Object.entries(schema.properties).flatMap(([key, child]: [string, any]) => {
    if (
      !key.trim() ||
      key.length > 100 ||
      /[\uD800-\uDFFF]/.test(key) ||
      !schema.required.includes(key) ||
      ['__proto__', 'constructor', 'prototype'].includes(key)
    )
      return [];
    const next = [...path, key],
      label = [
        ...labels,
        typeof child?.title === 'string' && child.title.trim() ? child.title : key,
      ];
    if (child?.type === 'object') return fields(child, next, label);
    return [{ path: next, label: label.join(' › '), schema: child }];
  });
}
const mappings = [
  ['decisionPath', '批次决策'],
  ['progressPath', '进度标记'],
  ['reasonPath', '状态说明'],
] as const;
export default function AuthorBatchEditor({
  schema,
  value,
  disabled,
  change,
  changeSchema,
}: {
  schema: unknown;
  value?: BatchDeclaration;
  disabled: boolean;
  change: (value?: BatchDeclaration) => void;
  changeSchema: (schema: Record<string, unknown>) => void;
}) {
  const choices = fields(schema);
  const decision =
    value &&
    choices.find((field) => JSON.stringify(field.path) === JSON.stringify(value.decisionPath));
  let issue = '';
  if (value)
    try {
      assertBatchDeclaration(value, schema);
    } catch (e) {
      issue = e instanceof Error ? e.message : '结果字段引用尚未核对';
    }
  return (
    <Card title="连续批次设置" className="batch-settings-card">
      <p>从当前入口的完整结果选择三个字段。使用者默认仅运行一次，须明确选择连续运行。</p>
      <Checkbox
        checked={!!value}
        disabled={disabled}
        onChange={(e) =>
          change(
            e.target.checked
              ? ({
                  version: 1,
                  decisionPath: [],
                  progressPath: [],
                  reasonPath: [],
                } as unknown as BatchDeclaration)
              : undefined,
          )
        }
      >
        允许使用者选择连续批次
      </Checkbox>
      {value && (
        <div className="batch-form">
          {mappings.map(([key, label]) => {
            const selected = JSON.stringify(value[key]);
            const options = choices.map((field) => ({
              value: JSON.stringify(field.path),
              label: field.label,
            }));
            if (value[key].length && !options.some((o) => o.value === selected))
              options.push({ value: selected, label: '原引用字段已删除或改型，请重新选择' });
            return (
              <label key={key}>
                <span>{label}</span>
                <Select
                  aria-label={label}
                  disabled={disabled}
                  value={value[key].length ? selected : undefined}
                  placeholder="选择当前入口的结果字段"
                  options={options}
                  showSearch
                  optionFilterProp="label"
                  onChange={(selected) => {
                    const field = choices.find((v) => JSON.stringify(v.path) === selected);
                    if (field) change({ ...value, [key]: field.path } as BatchDeclaration);
                  }}
                />
              </label>
            );
          })}
          <p>
            决策枚举为
            continue（继续）、complete（完成）、review（需要查看）；进度须为1–256字非空文本，说明须为1–1000字非空文本。三个路径必须不同，且沿途都是必填对象字段。
          </p>
          <p>
            设置三态决策会替换所选决策字段的原选项或选项组合规则；其他字段、已有约束与流程保持。
          </p>
          <Button
            disabled={disabled || !decision || decision.schema.type !== 'string'}
            onClick={() => {
              if (!decision || decision.schema.type !== 'string') return;
              const next = structuredClone(schema) as any;
              let parent = next;
              for (const key of decision.path.slice(0, -1)) parent = parent.properties[key];
              const field = parent.properties[decision.path.at(-1)!];
              field.enum = ['continue', 'complete', 'review'];
              delete field.oneOf;
              changeSchema(next);
            }}
          >
            设置三态决策
          </Button>
          {issue ? (
            <Alert
              type="warning"
              showIcon
              title="结果引用需要处理"
              description={`${issue}。已阻止保存或导出无效映射；请重新选择字段，或关闭连续批次。`}
            />
          ) : (
            <Alert
              type="success"
              showIcon
              title="字段引用已核对"
              description="保存制作草稿后生效；公开 ZIP 只携带逻辑定义，不携带个人资源或运行授权。"
            />
          )}
        </div>
      )}
    </Card>
  );
}
