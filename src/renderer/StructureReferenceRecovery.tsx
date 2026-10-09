import { Button } from 'antd';
import { useContext, useState } from 'react';
import type { Flow, Step } from '../shared/types';
import { nodeReferenceValues, type ReferenceIssue } from '../shared/flow-references';
import { flatten } from './flow-editing';
import { taskStepTitle } from './task-step-presentation';
import { referenceChoices, referenceOf } from './value-references';
import { VariableNavigationContext } from './variable-navigation';
import VariablePicker from './VariablePicker';
import './structure-reference-recovery.css';

type Field = { nodeId: string; reference: string; keys: string[]; label: string };
const names: Record<string, string> = {
  value: '数据值',
  content: '文件内容',
  actual: '判断值',
  expected: '比较值',
  items: '循环集合',
  input: '脚本输入',
  body: '请求内容',
  headers: '请求头',
  url: '网址',
  path: '文件路径',
  name: '文件名',
  rows: '表格数据',
  entries: '归档文件',
  arguments: '工具参数',
};
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function fieldsFor(step: Step, reference: string): string[][] {
  const result: string[][] = [];
  const visit = (value: unknown, keys: string[]) => {
    if (referenceOf(value) === reference) {
      result.push(keys);
      return;
    }
    if (value && typeof value === 'object')
      for (const [key, child] of Object.entries(value))
        if (!forbidden.has(key)) visit(child, [...keys, key]);
  };
  visit(nodeReferenceValues(step), []);
  return result;
}
function replaceField(step: Step, field: Field, reference: string): Step {
  const next = structuredClone(step);
  let value: any = next;
  for (const key of field.keys.slice(0, -1)) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key))
      throw new Error('字段已变化，请返回重新核对引用。');
    value = value[key];
  }
  const key = field.keys.at(-1);
  if (!key || !value || referenceOf(value[key]) !== field.reference)
    throw new Error('字段已变化，请返回重新核对引用。');
  value[key] = { $ref: reference };
  return next;
}

export default function StructureReferenceRecovery({
  flow,
  issues,
  change,
  edit,
}: {
  flow: Flow;
  issues: ReferenceIssue[];
  change: (node: Step, label: string) => void;
  edit: (nodeId: string, label: string) => void;
}) {
  const navigation = useContext(VariableNavigationContext);
  const [target, setTarget] = useState<Field>();
  const nodes = flatten(flow.steps);
  const fields = [
    ...new Map(
      issues.flatMap((issue) => {
        const index = nodes.findIndex((node) => node.id === issue.nodeId);
        if (index < 0) return [];
        const node = nodes[index];
        return fieldsFor(node, issue.reference).map((keys) => {
          const label = `第 ${index + 1} 步 ${taskStepTitle(node)} · ${names[keys[0]] ?? '配置项'}${keys.length > 1 ? ' / ' + keys.slice(1).join(' / ') : ''}`;
          const field = { nodeId: node.id, reference: issue.reference, keys, label };
          return [JSON.stringify([node.id, keys]), field] as const;
        });
      }),
    ).values(),
  ];
  const node = target && nodes.find((item) => item.id === target.nodeId);
  if (!fields.length && !target) return null;
  return (
    <section className="structure-reference-recovery" aria-label="受影响的引用字段">
      <h3>先调整引用，再重试结构操作</h3>
      <p>
        删除或移动尚未应用，草稿保持原状。选择一个受影响字段查看来源；修改引用不会自动重试原操作。
      </p>
      <ul>
        {fields.map((field) => (
          <li key={JSON.stringify([field.nodeId, field.keys])}>
            <strong>{field.label}</strong>
            <code>{field.reference}</code>
            <Button
              htmlType="button"
              onClick={() => setTarget(field)}
              aria-label={`查看引用来源 · ${field.label}`}
            >
              查看引用来源
            </Button>
          </li>
        ))}
      </ul>
      {target && (
        <VariableNavigationContext.Provider
          value={navigation ? { ...navigation, source: '输入与保存状态' } : undefined}
        >
          <VariablePicker
            label={target.label}
            current={target.reference}
            choices={node ? referenceChoices(flow, node.id) : []}
            choose={(reference) => {
              if (!node) throw new Error('引用字段所在步骤已不存在，请返回重新核对。');
              if (reference === target.reference)
                throw new Error('引用未改变，原结构操作仍被阻止。请选择其他来源，或取消返回。');
              change(replaceField(node, target, reference), target.label);
            }}
            fixedLabel="去步骤填写固定值"
            fixed={() => edit(target.nodeId, target.label)}
            close={() => setTarget(undefined)}
          />
        </VariableNavigationContext.Provider>
      )}
    </section>
  );
}
