import { Select, Input, Descriptions } from 'antd';
import { useId } from 'react';
import type { Json, Step } from '../shared/types';
import ValueField from './ValueField';
import { referenceOf, type ReferenceChoice } from './value-references';
import './node-configuration.css';

export default function LogicNodeConfiguration({
  node,
  choices,
  change,
  compact = false,
  guard = () => true,
}: {
  node: Step;
  choices: ReferenceChoice[];
  change: (node: Step) => void;
  compact?: boolean;
  guard?: () => boolean;
}) {
  const id = useId();
  const field = (key: string, label: string, value: Json, defaultValue: Json = '') => (
    <ValueField
      key={key}
      compactReference={compact}
      label={label}
      value={value}
      choices={choices}
      defaultValue={defaultValue}
      jsonDefault={node.type === 'loop' && key === 'items' ? [] : undefined}
      change={(next) => {
        if (node.type === 'loop' && key === 'items' && referenceOf(next) === undefined) {
          if (!Array.isArray(next)) throw new Error('循环集合必须是数组，或选择数组来源的变量引用');
          if (next.length > 1000) throw new Error('循环集合最多 1000 项');
        }
        change({ ...node, [key]: next } as Step);
      }}
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
        <label htmlFor={id + '-operator'}>判断方式</label>
        <Select<string>
          id={id + '-operator'}
          value={node.operator}
          onChange={(value) => {
            if (guard()) change({ ...node, operator: value } as Step);
          }}
          options={[
            { value: 'equals', label: '等于' },
            { value: 'notEquals', label: '不等于' },
            { value: 'contains', label: '包含' },
            { value: 'gt', label: '大于（数字）' },
            { value: 'exists', label: '不是空值' },
          ]}
        />
        {node.operator !== 'exists' && field('expected', '比较值', node.expected)}
        {node.type === 'condition' && (
          <Descriptions
            className="node-control-summary"
            size="small"
            column={1}
            items={[
              { key: 'then', label: '成立分支', children: `${node.then.length} 个直接子步骤` },
              { key: 'else', label: '否则分支', children: `${node.else.length} 个直接子步骤` },
            ]}
          />
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
        <Descriptions
          className="node-control-summary"
          size="small"
          column={1}
          items={[
            { key: 'body', label: '循环体', children: `${node.body.length} 个直接子步骤` },
            { key: 'variables', label: '体内变量', children: 'item / index' },
          ]}
        />
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
        <label htmlFor={id + '-message'}>人工提示</label>
        <Input.TextArea
          id={id + '-message'}
          value={node.message}
          onChange={(e) => change({ ...node, message: e.target.value })}
        />
        <p>执行到此步骤时等待用户回应，不自动继续。执行期限使用节点配置。</p>
      </section>
    );
  return null;
}
