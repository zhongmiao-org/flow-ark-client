import { useEffect, useId, useState } from 'react';
import { Button, Input, InputNumber, Select } from 'antd';
import type { Bindings } from '../shared/types';
import type { Step } from '../shared/types';
type ConversationNode = Extract<Step, { type: 'conversation' }>;
import type { ReferenceChoice } from './value-references';
import ValueField from './ValueField';
import './ai-node.css';
export default function ConversationNodeConfiguration({
  node,
  bindings,
  choices,
  change,
  changeBindings,
}: {
  node: ConversationNode;
  bindings: Bindings;
  choices: ReferenceChoice[];
  change: (node: ConversationNode) => void;
  changeBindings: (b: Bindings) => void;
}) {
  const id = useId();
  const configuredLimit = node.version === 2 ? node.historyWindow : node.maxRequests;
  const max = node.version === 2 ? 24 : 50;
  const [limit, setLimit] = useState<number | null>(configuredLimit);
  useEffect(() => setLimit(configuredLimit), [configuredLimit]);
  const binding = bindings.resources?.[node.binding] ?? {};
  const [configuration, setConfiguration] = useState<{ configured: boolean; model: string }>();
  useEffect(() => {
    let live = true;
    setConfiguration(undefined);
    if (binding.provider)
      void window.flowark
        .request('ai.configuration.get', { provider: binding.provider })
        .then((v) => {
          if (live) setConfiguration(v);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [binding.provider]);
  const patchBinding = (b: NonNullable<Bindings['resources']>[string]) =>
    changeBindings({ ...bindings, resources: { ...bindings.resources, [node.binding]: b } });
  return (
    <section className="node-configuration ai-node-configuration" aria-label="持久引导会话配置">
      <h4>{node.version === 2 ? '持续会话' : '持久引导会话 v1'}</h4>
      <p>
        创建或读取会话后结束本批，等待用户不占运行槽。首次创建不调用模型；在待办核对自己的 Key
        费用后发送。
      </p>
      <div data-value-invalid={!/^[a-z][a-z0-9-]{0,99}$/.test(node.binding) ? 'true' : undefined}>
        <label htmlFor={id + '-binding'}>逻辑 AI 资源名</label>
        <Input
          id={id + '-binding'}
          value={node.binding}
          onChange={(e) => change({ ...node, binding: e.target.value })}
        />
      </div>
      <fieldset className="ai-node-binding" disabled={!!bindings.template}>
        <legend>本机服务绑定</legend>
        <label>
          供应商
          <Select
            disabled={!!bindings.template}
            aria-label="会话供应商"
            value={binding.provider}
            options={[
              { value: 'deepseek', label: 'DeepSeek' },
              { value: 'openai-codex', label: 'OpenAI' },
            ]}
            onChange={(provider) => patchBinding({ provider, model: '' })}
          />
        </label>
        <label>
          模型 ID
          <Input
            disabled={!!bindings.template}
            aria-label="会话模型 ID"
            value={binding.model ?? ''}
            onChange={(e) => patchBinding({ ...binding, model: e.target.value })}
          />
        </label>
        <Button
          disabled={!!bindings.template || !configuration?.configured}
          onClick={() => patchBinding({ ...binding, model: configuration!.model })}
        >
          采用本地已保存模型
        </Button>
      </fieldset>
      <p>
        {bindings.template ? '模板资源在实例配置中选择。' : '切换供应商后请明确选择模型。'} Key
        仅由本地设置保护存储，不进入会话或 ZIP。
      </p>
      <label>
        会话标题
        <Input
          value={node.title}
          maxLength={200}
          onChange={(e) => change({ ...node, title: e.target.value })}
        />
      </label>
      <ValueField
        label="会话键"
        value={node.key}
        choices={choices}
        change={(key) => change({ ...node, key })}
      />
      <label>
        引导指令
        <Input.TextArea
          value={node.instructions}
          autoSize={{ minRows: 4, maxRows: 12 }}
          onChange={(e) => change({ ...node, instructions: e.target.value })}
        />
      </label>
      <ValueField
        label="会话上下文"
        value={node.input}
        choices={choices}
        jsonDefault={{}}
        change={(input) => change({ ...node, input })}
      />
      <label
        data-value-invalid={
          limit === null || limit < 1 || limit > max || !Number.isInteger(limit)
            ? 'true'
            : undefined
        }
      >
        {node.version === 2 ? '每轮历史窗口（完整问答，非总次数）' : '最多模型请求（包含手动重试）'}
        <InputNumber
          min={1}
          max={max}
          precision={0}
          value={limit}
          onChange={(value) => {
            setLimit(value);
            if (value !== null && Number.isInteger(value) && value >= 1 && value <= max)
              change(
                node.version === 2
                  ? { ...node, historyWindow: value }
                  : { ...node, maxRequests: value },
              );
          }}
        />
      </label>
      <p>
        {node.version === 2
          ? '访谈无总轮次上限。同一实例和会话键关联持续档案；资料、指令、模型变化先核对后采用。新补充使当前输出回到 pending，资料待核对为 context-review。'
          : '后续用 status 条件判断：confirmed 才能读取 transcript；其他状态应结束本批。'}{' '}
        确认对话不替代 Skill 确认或发送授权。
      </p>
    </section>
  );
}
