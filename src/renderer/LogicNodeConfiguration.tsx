import type { Json, Step } from '../shared/types';
import ValueField from './ValueField';
import type { ReferenceChoice } from './value-references';
import './node-configuration.css';

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
  if (node.type === 'value')
    return (
      <section className="node-configuration" aria-label="数据配置">
        <header>
          <h4>数据值</h4>
        </header>
        {field('value', '数据值', node.value)}
        <p>输出当前数据值，供后续步骤引用。</p>
      </section>
    );
  if (node.type === 'assert' || node.type === 'condition')
    return (
      <section className="node-configuration" aria-label="判断配置">
        <header>
          <h4>{node.type === 'assert' ? '结果断言' : '条件分支'}</h4>
        </header>
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
        {node.type === 'condition' && (
          <dl className="node-control-summary">
            <div>
              <dt>成立分支</dt>
              <dd>{node.then.length} 个直接子步骤</dd>
            </div>
            <div>
              <dt>否则分支</dt>
              <dd>{node.else.length} 个直接子步骤</dd>
            </div>
          </dl>
        )}
        <p className="note">
          {node.type === 'assert' ? '不满足时停止运行并报错。' : '满足走成立分支，否则走另一分支。'}
          “不是空值”仍要求引用路径存在。
        </p>
      </section>
    );
  if (node.type === 'loop')
    return (
      <section className="node-configuration" aria-label="循环配置">
        <header>
          <h4>串行循环</h4>
        </header>
        {field('items', '循环集合', node.items, [])}
        <dl className="node-control-summary">
          <div>
            <dt>循环体</dt>
            <dd>{node.body.length} 个直接子步骤</dd>
          </div>
          <div>
            <dt>体内变量</dt>
            <dd>item / index</dd>
          </div>
        </dl>
        <p className="note">
          输入数组，按顺序逐项执行，最多 1000 项。循环内可选择当前项和从 0 开始的序号。
        </p>
      </section>
    );
  if (node.type === 'script') return field('input', '脚本输入', node.input, {});
  if (node.type === 'human')
    return (
      <section className="node-configuration" aria-label="人工等待配置">
        <header>
          <h4>等待人工</h4>
        </header>
        <label htmlFor="human-message">人工提示</label>
        <textarea
          id="human-message"
          value={node.message}
          onChange={(e) => change({ ...node, message: e.target.value })}
        />
        <p>执行到此步骤时等待用户回应，不自动继续。期限使用上方节点规则。</p>
      </section>
    );
  return null;
}
