import { Alert, Button, Checkbox, Collapse, Input, Select } from 'antd';
import { useEffect, useId, useState } from 'react';
import type { Bindings, Json, Step } from '../shared/types';
import { assertAISchema } from '../shared/ai-node';
import ValueField, { LiteralValue } from './ValueField';
import type { ReferenceChoice } from './value-references';
import { activateCollapseWithSpace } from './collapseKeyboard';
import './ai-node.css';

type Node = Extract<Step, { type: 'ai' }>;
const types = [
  ['string', '文本'],
  ['number', '数字'],
  ['integer', '整数'],
  ['boolean', '布尔值'],
  ['object', '对象'],
  ['array', '数组'],
];
function OutputField({
  name,
  spec,
  required,
  names,
  update,
  remove,
}: {
  name: string;
  spec: any;
  required: boolean;
  names: string[];
  update: (name: string, spec: any, required: boolean) => void;
  remove: () => void;
}) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const valid =
    /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(draft) &&
    !['constructor', 'prototype', '__proto__'].includes(draft) &&
    (draft === name || !names.includes(draft));
  return (
    <fieldset className="ai-output-field" data-value-invalid={!valid ? 'true' : undefined}>
      <legend>输出字段 · {name}</legend>
      <label>
        字段名
        <Input
          aria-label={'输出字段名 ' + name}
          value={draft}
          status={valid ? undefined : 'error'}
          aria-invalid={!valid}
          onChange={(event) => {
            const value = event.target.value;
            setDraft(value);
            if (
              /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(value) &&
              !['constructor', 'prototype', '__proto__'].includes(value) &&
              (value === name || !names.includes(value))
            )
              update(value, spec, required);
          }}
        />
      </label>
      {!valid && (
        <p role="alert" className="field-error">
          使用唯一的英文字母开头字段名，只含字母、数字或下划线。
        </p>
      )}
      <label>
        字段类型
        <Select
          aria-label={'输出字段类型 ' + name}
          value={spec?.type ?? ''}
          options={types.map(([value, label]) => ({ value, label }))}
          onChange={(type) =>
            update(name, { type, ...(type === 'array' ? { items: {} } : {}) }, required)
          }
        />
      </label>
      <div className="ai-output-actions">
        <Checkbox checked={required} onChange={(event) => update(name, spec, event.target.checked)}>
          必需
        </Checkbox>
        <Button disabled={!valid} onClick={remove} aria-label={'移除输出字段 ' + name}>
          移除字段
        </Button>
      </div>
    </fieldset>
  );
}

export default function AINodeConfiguration({
  node,
  bindings,
  choices,
  change,
  changeBindings,
}: {
  node: Node;
  bindings: Bindings;
  choices: ReferenceChoice[];
  change: (node: Step) => void;
  changeBindings: (bindings: Bindings) => void;
}) {
  const id = useId();
  const binding = bindings.resources?.[node.binding] ?? {};
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
    changeBindings({ ...bindings, resources: { ...bindings.resources, [node.binding]: value } });
  const schema: any = node.schema;
  const properties: Record<string, any> = schema.properties ?? {};
  const names = Object.keys(properties);
  const updateField = (previous: string, name: string, spec: any, required: boolean) => {
    const props = Object.fromEntries(
      Object.entries(properties).map(([key, value]) =>
        key === previous ? [name, spec] : [key, value],
      ),
    );
    const needed = (schema.required ?? []).filter((key: string) => key !== previous);
    change({
      ...node,
      schema: { ...schema, properties: props, required: required ? [...needed, name] : needed },
    });
  };
  const logicalValid = /^[a-z][a-z0-9-]{0,99}$/.test(node.binding);
  return (
    <section className="node-configuration ai-node-configuration" aria-label="结构化 AI 调用配置">
      <header>
        <h4>结构化 AI 调用</h4>
      </header>
      <p>仅生成结构化结果。模型调用消耗你自己的 API Key 额度，不直接执行其他动作。</p>
      <div data-value-invalid={!logicalValid ? 'true' : undefined}>
        <label htmlFor={id + '-binding'}>逻辑 AI 资源名</label>
        <Input
          id={id + '-binding'}
          value={node.binding}
          aria-invalid={!logicalValid}
          status={logicalValid ? undefined : 'error'}
          onChange={(event) => change({ ...node, binding: event.target.value })}
        />
        {!logicalValid && (
          <p className="field-error">使用小写字母开头的字母、数字或连字符，最多100字符。</p>
        )}
      </div>
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
      <label htmlFor={id + '-instructions'}>指令</label>
      <Input.TextArea
        id={id + '-instructions'}
        rows={4}
        value={node.instructions}
        maxLength={100000}
        onChange={(event) => change({ ...node, instructions: event.target.value })}
      />
      <ValueField
        label="AI 输入"
        value={node.input}
        choices={choices}
        defaultValue={{}}
        change={(input) => change({ ...node, input })}
      />
      <h4>输出格式</h4>
      <p className="note">通过完整格式校验后才继续。后续步骤引用 output 中的字段。</p>
      {names.map((name, index) => (
        <OutputField
          key={index}
          name={name}
          spec={properties[name]}
          required={(schema.required ?? []).includes(name)}
          names={names}
          update={(next, spec, required) => updateField(name, next, spec, required)}
          remove={() => {
            const props = { ...properties };
            delete props[name];
            change({
              ...node,
              schema: {
                ...schema,
                properties: props,
                required: (schema.required ?? []).filter((key: string) => key !== name),
              },
            });
          }}
        />
      ))}
      <Button
        onClick={() => {
          let name = 'field',
            i = 1;
          while (Object.hasOwn(properties, name)) name = 'field' + i++;
          change({
            ...node,
            schema: {
              ...schema,
              properties: { ...properties, [name]: { type: 'string' } },
              required: [...(schema.required ?? []), name],
              additionalProperties: schema.additionalProperties ?? false,
            },
          });
        }}
      >
        添加输出字段
      </Button>
      <Collapse
        data-draft-collapse
        items={[
          {
            key: 'schema',
            label: '高级 JSON Schema',
            forceRender: true,
            onKeyDown: activateCollapseWithSpace,
            children: (
              <LiteralValue
                label="AI 输出 JSON Schema"
                value={node.schema as Json}
                change={(value) => {
                  assertAISchema(value);
                  change({ ...node, schema: value as Node['schema'] });
                }}
              />
            ),
          },
        ]}
      />
      <p className="note">
        本地 Schema
        引用保持原义。复杂嵌套格式在高级编辑中维护；取消和超时不接收迟到结果，不自动重试或换模型。
      </p>
    </section>
  );
}
