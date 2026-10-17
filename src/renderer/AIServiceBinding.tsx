import { Alert, Button, Input, Select } from 'antd';
import { useEffect, useId, useState } from 'react';
import type { Bindings } from '../shared/types';
export default function AIServiceBinding({
  resource,
  bindings,
  changeBindings,
}: {
  resource: string;
  bindings: Bindings;
  changeBindings: (value: Bindings) => void;
}) {
  const id = useId();
  const logicalValid = /^[a-z][a-z0-9-]{0,99}$/.test(resource);
  const binding = bindings.resources?.[resource] ?? {};
  const [modelConfiguration, setModelConfiguration] = useState<{
    provider: string;
    model: string;
    configured: boolean;
  }>();
  useEffect(() => {
    let live = true;
    setModelConfiguration(undefined);
    if (binding.provider)
      window.flowark
        .request('ai.configuration.get', { provider: binding.provider })
        .then((value) => {
          if (live) setModelConfiguration(value);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [binding.provider]);
  const patchBinding = (value: { provider?: 'deepseek' | 'openai-codex'; model?: string }) =>
    changeBindings({ ...bindings, resources: { ...bindings.resources, [resource]: value } });
  return (
    <>
      <fieldset disabled={!!bindings.template || !logicalValid} className="ai-node-binding">
        <legend>本机服务绑定</legend>
        <label htmlFor={id + '-provider'}>供应商</label>
        <Select
          id={id + '-provider'}
          aria-label="AI 节点供应商"
          value={binding.provider ?? ''}
          disabled={!!bindings.template || !logicalValid}
          options={[
            { value: '', label: '尚未绑定' },
            { value: 'deepseek', label: 'DeepSeek' },
            { value: 'openai-codex', label: 'OpenAI' },
          ]}
          onChange={(provider) =>
            patchBinding(
              provider ? { provider: provider as 'deepseek' | 'openai-codex', model: '' } : {},
            )
          }
        />
        <label htmlFor={id + '-model'}>模型 ID</label>
        <Input
          id={id + '-model'}
          value={binding.model ?? ''}
          maxLength={100}
          placeholder="显式填写模型 ID"
          onChange={(event) =>
            patchBinding({ provider: binding.provider, model: event.target.value })
          }
        />
        <Button
          disabled={!!bindings.template || !binding.provider || !modelConfiguration?.configured}
          onClick={() =>
            patchBinding({ provider: binding.provider, model: modelConfiguration!.model })
          }
        >
          采用本地已保存模型
        </Button>
      </fieldset>
      <p className="note">
        {bindings.template ? '模板资源请在实例配置中修改。' : '切换供应商后请重新选择模型。'} Key
        只在本地设置的 AI 服务中管理，不随 ZIP 导出，也不授权脚本读取。
      </p>
      {binding.provider && modelConfiguration && !modelConfiguration.configured && (
        <Alert type="warning" title="该服务尚未配置用户自己的 Key，运行前会阻止调用。" />
      )}
    </>
  );
}
