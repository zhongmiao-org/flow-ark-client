import AIServiceBinding from './AIServiceBinding';
import AIOutputSchemaWorkspace from './AIOutputSchemaWorkspace';
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
  change: (node: Step) => void | boolean;
  changeBindings: (bindings: Bindings) => void;
}) {
  const id = useId();
  const [schemaOpen, setSchemaOpen] = useState(false);
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
    <section
      className="node-configuration ai-node-configuration"
      aria-label="结构化 AI 调用配置"
      data-value-invalid={schemaOpen ? '输出结构编辑尚未应用或取消。' : undefined}
    >
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
      <AIServiceBinding
        resource={node.binding}
        bindings={bindings}
        changeBindings={changeBindings}
      />
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
      <Button onClick={() => setSchemaOpen(true)}>编辑完整输出结构</Button>
      {schemaOpen && (
        <AIOutputSchemaWorkspace
          nodeId={node.id}
          schema={node.schema}
          close={() => setSchemaOpen(false)}
          apply={(schema) => {
            if (change({ ...node, schema }) === false)
              throw Error('当前步骤有未完成配置，输出结构未应用；请先修正后重试。');
          }}
        />
      )}
      {node.version === 2 ? (
        <>
          <label htmlFor={id + '-failure'}>请求失败时</label>
          <Select
            id={id + '-failure'}
            aria-label="AI请求失败时"
            value={node.failureMode}
            options={[
              { value: 'stop', label: '停止运行（默认）' },
              { value: 'result', label: '返回失败状态，供后续条件判断' },
            ]}
            onChange={(failureMode) => change({ ...node, failureMode })}
          />
          <p className="note">
            先判断 status = success，再读取 result.output。失败为 status = failed，只有 error，无
            result 或可用正文。
          </p>
          <p className="note">
            缺 Key、绑定、权限，取消或节点超时仍停止；不自动重试或切换模型。提醒由后续分支明确连接。
          </p>
        </>
      ) : (
        <>
          <p className="note">
            v1：通过完整格式校验后才继续，后续引用 output 中的字段；请求失败停止运行。
          </p>
          <p className="note">
            改用 v2 后成功结果位于 result.output，须同时调整后续引用；当前节点和历史不会自动升级。
          </p>
          <Button onClick={() => change({ ...node, version: 2, failureMode: 'stop' })}>
            明确改用 v2 结果格式
          </Button>
        </>
      )}
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
