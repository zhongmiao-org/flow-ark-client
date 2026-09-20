import type { Json, Step } from '../shared/types';
import ValueField from './ValueField';
import type { ReferenceChoice } from './value-references';

export default function LogicNodeConfiguration({
  node,
  choices,
  change,
}: {
  node: Step;
  choices: ReferenceChoice[];
  change: (node: Step) => void;
}) {
  const field = (key: string, label: string, value: Json, defaultValue: Json = '') => (
    <ValueField
      key={key}
      label={label}
      value={value}
      choices={choices}
      defaultValue={defaultValue}
      change={(next) => change({ ...node, [key]: next } as Step)}
    />
  );
  if (node.type === 'value') return field('value', '数据值', node.value);
  if (node.type === 'assert' || node.type === 'condition')
    return (
      <section aria-label="判断配置">
        {field('actual', '判断值', node.actual)}
        <label htmlFor="comparison-operator">判断方式</label>
        <select
          id="comparison-operator"
          value={node.operator}
          onChange={(e) => change({ ...node, operator: e.target.value } as Step)}
        >
          <option value="equals">等于</option>
          <option value="notEquals">不等于</option>
          <option value="contains">包含</option>
          <option value="gt">大于（数字）</option>
          <option value="exists">不是空值</option>
        </select>
        {node.operator !== 'exists' && field('expected', '比较值', node.expected)}
        <p className="note">
          {node.type === 'assert' ? '不满足时停止运行并报错。' : '满足走成立分支，否则走另一分支。'}
          “不是空值”仍要求引用路径存在。
        </p>
      </section>
    );
  if (node.type === 'loop')
    return (
      <section aria-label="循环配置">
        {field('items', '循环集合', node.items, [])}
        <p className="note">
          输入数组，按顺序逐项执行，最多 1000 项。循环内可选择当前项和从 0 开始的序号。
        </p>
      </section>
    );
  if (node.type === 'script') return field('input', '脚本输入', node.input, {});
  if (node.type === 'human')
    return (
      <>
        <label htmlFor="human-message">人工提示</label>
        <textarea
          id="human-message"
          value={node.message}
          onChange={(e) => change({ ...node, message: e.target.value })}
        />
      </>
    );
  return null;
}
