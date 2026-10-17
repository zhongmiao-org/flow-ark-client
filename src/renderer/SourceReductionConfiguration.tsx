import { Alert, Input, InputNumber } from 'antd';
import { useState } from 'react';
import type { Bindings, Step } from '../shared/types';
import { assertAISchema } from '../shared/ai-node';
import type { ReductionNode } from '../shared/source-reduction';
import type { ReferenceChoice } from './value-references';
import AIServiceBinding from './AIServiceBinding';
import AuthorSchemaEditor from './AuthorSchemaEditor';
import ValueField from './ValueField';
import { Field } from './TemplateConfiguration';
import { schemaDefaults } from '../shared/template-config';
import { Button } from 'antd';
import { referenceOf } from './value-references';
import './ai-node.css';
import './template-author.css';
export default function SourceReductionConfiguration({
  node,
  bindings,
  choices,
  change,
  changeBindings,
}: {
  node: ReductionNode;
  bindings: Bindings;
  choices: ReferenceChoice[];
  change: (node: Step) => void;
  changeBindings: (value: Bindings) => void;
}) {
  const [pending, setPending] = useState(false);
  let error = '';
  try {
    assertAISchema(node.schema);
  } catch (e) {
    error = (e as Error).message;
  }
  const validResource = (s: string) => /^[a-z][a-z0-9-]{0,99}$/.test(s);
  const valid =
    validResource(node.binding) && validResource(node.aiBinding) && node.binding !== node.aiBinding;
  return (
    <section
      className="node-configuration ai-node-configuration"
      aria-label="分批整理来源配置"
      data-value-invalid={pending || !valid || !!error ? 'true' : undefined}
    >
      <h4>分批整理来源</h4>
      <p>
        固定本人确认的完整来源，使用本人的 API Key
        分批整理，保存草稿与下一位置。更改来源、规则、字段或初始数据会建立新任务。
      </p>
      <label>
        来源逻辑资源
        <Input
          aria-label="整理来源逻辑资源"
          value={node.binding}
          status={validResource(node.binding) ? undefined : 'error'}
          onChange={(e) => change({ ...node, binding: e.target.value })}
        />
      </label>
      <p>在“参数与资源”选择已确认来源；公开模板只保留逻辑资源名。</p>
      <label>
        AI逻辑资源
        <Input
          aria-label="整理AI逻辑资源"
          value={node.aiBinding}
          status={validResource(node.aiBinding) ? undefined : 'error'}
          onChange={(e) => change({ ...node, aiBinding: e.target.value })}
        />
      </label>
      {!valid && (
        <Alert
          type="error"
          title="来源和AI资源须使用不同的小写字母、数字或连字符名称，最多100字符。"
        />
      )}
      <AIServiceBinding
        resource={node.aiBinding}
        bindings={bindings}
        changeBindings={changeBindings}
      />
      <label>
        本批最多请求次数
        <InputNumber
          aria-label="本批最多请求次数"
          min={1}
          max={16}
          precision={0}
          value={node.maxRequests}
          onChange={(v) => v !== null && change({ ...node, maxRequests: v })}
        />
      </label>
      <p>达到上限后保存并释放运行槽。请求次数不等于精确Token或费用上限；未知结果不自动重试。</p>
      <ValueField
        label="初始数据"
        value={node.seed}
        choices={choices}
        defaultValue={{}}
        change={(seed) => change({ ...node, seed })}
      >
        <Field
          schema={node.schema}
          value={referenceOf(node.seed) ? {} : node.seed}
          label="初始数据"
          change={(seed: any) => change({ ...node, seed })}
        />
      </ValueField>
      <Button onClick={() => change({ ...node, seed: schemaDefaults(node.schema) })}>
        按结果字段初始化空数据
      </Button>
      <label>
        模板整理规则
        <Input.TextArea
          aria-label="模板整理规则"
          rows={5}
          maxLength={100000}
          value={node.instructions}
          onChange={(e) => change({ ...node, instructions: e.target.value })}
        />
      </label>
      <h4>结果字段</h4>
      <AuthorSchemaEditor
        schema={node.schema}
        change={(schema) => change({ ...node, schema })}
        disabled={false}
        pending={setPending}
        label="整理结果字段"
        form={false}
        rootObject
      />
      {error && <Alert type="error" title={error} />}
      <p>
        仅完整且符合字段结构的响应才提交进度。完成后仍须进入后续草稿核对和本人确认，才能保存 Skill。
      </p>
    </section>
  );
}
