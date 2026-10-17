import { Select } from 'antd';
import type { SourceNode } from '../shared/conversation-source';
import type { ReferenceChoice } from './value-references';
export default function SourceNodeConfiguration({
  node,
  choices,
  resources,
  change,
}: {
  node: SourceNode;
  choices: ReferenceChoice[];
  resources: string[];
  change: (node: SourceNode) => void;
}) {
  const positions = choices.filter((c) => c.path.endsWith('.next'));
  const ref =
    node.operation === 'read' &&
    node.cursor &&
    typeof node.cursor === 'object' &&
    !Array.isArray(node.cursor) &&
    '$ref' in node.cursor
      ? String(node.cursor.$ref)
      : '';
  return (
    <section className="node-configuration ai-node-configuration" aria-label="完整会话来源读取配置">
      <h4>读取完整会话来源</h4>
      <label>
        操作
        <Select
          aria-label="来源读取操作"
          value={node.operation}
          options={[
            { value: 'manifest', label: '读取来源清单' },
            { value: 'read', label: '读取一个有界片段' },
          ]}
          onChange={(operation) => {
            const { cursor: _cursor, ...base } = node as Extract<SourceNode, { operation: 'read' }>;
            const name = ['读取来源清单', '读取来源片段'].includes(base.name)
              ? operation === 'read'
                ? '读取来源片段'
                : '读取来源清单'
              : base.name;
            change(
              operation === 'read'
                ? { ...base, name, operation, cursor: null }
                : { ...base, name, operation },
            );
          }}
        />
      </label>
      <label>
        来源资源
        <Select
          aria-label="来源逻辑资源"
          value={node.binding}
          options={[...new Set([node.binding, ...resources])].map((value) => ({
            value,
            label: value,
          }))}
          onChange={(binding) => change({ ...node, binding })}
        />
      </label>
      <p>在“参数与资源”选择本机已确认来源。运行固定使用保存的版本，公开导出仅保留逻辑资源。</p>
      {node.operation === 'read' && (
        <label>
          读取位置
          <Select
            aria-label="来源读取位置"
            value={ref || (node.cursor === null ? 'start' : 'fixed')}
            options={[
              { value: 'start', label: '从头开始' },
              ...(node.cursor !== null && !ref
                ? [{ value: 'fixed', label: '高级固定位置（调试）', disabled: true }]
                : []),
              ...positions.map((c) => ({ value: c.path, label: c.label })),
              ...(!positions.some((c) => c.path === ref) && ref
                ? [{ value: ref, label: '原引用 · ' + ref }]
                : []),
            ]}
            onChange={(value) =>
              change({ ...node, cursor: value === 'start' ? null : { $ref: value } })
            }
          />
        </label>
      )}
      <p>
        输出固定来源清单，或当前片段、下一位置和是否到末尾。每片段有界且保持原记录连续；读取不代表AI已整理。
      </p>
    </section>
  );
}
