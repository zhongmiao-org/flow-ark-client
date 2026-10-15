import { Select } from 'antd';
import { useId } from 'react';
import type { ContextNode } from '../shared/template-data';
import { contextOperations } from '../shared/template-data';
import type { ReferenceChoice } from './value-references';
import ValueField from './ValueField';
import './ai-node.css';

export default function ContextNodeConfiguration({
  node,
  choices,
  change,
}: {
  node: ContextNode;
  choices: ReferenceChoice[];
  change: (node: ContextNode) => void;
}) {
  const id = useId();
  return (
    <section className="node-configuration ai-node-configuration" aria-label="配置与状态步骤">
      <h4>配置与状态</h4>
      <label htmlFor={id}>
        操作
        <Select
          id={id}
          value={node.operation}
          options={Object.entries(contextOperations).map(([value, label]) => ({ value, label }))}
          onChange={(operation: ContextNode['operation']) => {
            const { operation: _operation, ...base } = node;
            delete (base as any).expectedRevision;
            delete (base as any).value;
            change(
              operation === 'state.write'
                ? { ...base, operation, expectedRevision: 0, value: {} }
                : { ...base, operation },
            );
          }}
        />
      </label>
      {node.operation === 'state.write' ? (
        <>
          <ValueField
            label="预期修订"
            value={node.expectedRevision ?? 0}
            choices={choices}
            defaultValue={0}
            change={(expectedRevision) => change({ ...node, expectedRevision })}
          />
          <ValueField
            label="完整新值"
            value={node.value ?? null}
            choices={choices}
            jsonDefault={{}}
            defaultValue={{}}
            change={(value) => change({ ...node, value })}
          />
          <p>整值替换，不隐式合并。先读取最新状态，从前序结果选择修订；冲突时停止，不自动重试。</p>
          <p>
            提交前取消不写入；提交后的状态与回执保留。正式实例还须声明状态能力及默认拒绝的独立写动作。
          </p>
        </>
      ) : (
        <p>
          {node.operation === 'configuration'
            ? '读取本次运行开始时固定的共享配置与配置修订。'
            : '读取本实例或当前调试副本的最新完整状态及修订。'}
        </p>
      )}
      <p>仅用于模板实例或已登记的制作副本。制作副本的私有配置、状态与正式实例相互独立。</p>
      <p>
        输出 value、revision、contextId；写入另含
        operationId、previousRevision、committedAt。完整结果保存在本机加密记录中。
      </p>
    </section>
  );
}
