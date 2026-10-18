import { Select } from 'antd';
import type { RunResultNode } from '../shared/contracts.generated';
export default function RunResultNodeConfiguration({
  node,
  resources,
  change,
}: {
  node: RunResultNode;
  resources: { id: string; name: string }[];
  change: (node: RunResultNode) => void;
}) {
  return (
    <section className="node-configuration ai-node-configuration" aria-label="读取已保存结果配置">
      <h4>读取已选择的运行结果</h4>
      <label>
        操作
        <Select
          aria-label="结果读取操作"
          value="read"
          options={[{ value: 'read', label: '读取已绑定结果' }]}
        />
      </label>
      <label>
        结果资源
        <Select
          aria-label="结果逻辑资源"
          value={node.binding}
          options={[
            ...resources.map((r) => ({ value: r.id, label: r.name + ' · 只读' })),
            ...(!resources.some((r) => r.id === node.binding)
              ? [{ value: node.binding, label: node.binding + ' · 尚未在模板声明' }]
              : []),
          ]}
          onChange={(binding) => change({ ...node, binding })}
        />
      </label>
      <p>
        在模板制作中声明来源入口，在“参数与资源”选择准确的已保存结果。后续节点通过变量选择器引用“可复用数据”或“固定来源”。
      </p>
      <p>使用启动时固定绑定；读取前核对当前运行、快照、准确来源和数据摘要。缺失或失效时停止。</p>
      <p>读取不会创建来源运行、调用AI、改状态、发送消息或扩大授权。</p>
    </section>
  );
}
