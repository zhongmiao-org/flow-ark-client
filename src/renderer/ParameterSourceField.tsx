import { Button, Input } from 'antd';
import { useEffect, useId, useState } from 'react';
import type { Flow, Json } from '../shared/types';
import {
  parameterSourcePath,
  resolveParameterSources,
  withParameterSources,
} from '../shared/parameter-sources';
import VariablePicker from './VariablePicker';
import { referenceKey, type ReferenceChoice } from './value-references';

function choicesFor(flow: Flow, target: string): ReferenceChoice[] {
  let values = flow.parameters;
  try {
    values = resolveParameterSources(flow);
  } catch {
    /* Keep candidate roots available for repair. */
  }
  const choices: ReferenceChoice[] = [];
  const expand = (value: Json, path: string, label: string, depth = 0, budget = { left: 100 }) => {
    choices.push({
      path,
      label,
      group: '流程参数',
      hint: '使用运行开始前解析的参数值；不读取步骤输出。',
    });
    if (depth >= 4 || !value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (!referenceKey(key) || /\s/.test(key) || budget.left-- <= 0) continue;
      expand(child, path + '.' + key, label + ' / ' + key, depth + 1, budget);
    }
  };
  for (const [key, value] of Object.entries(values)) {
    if (key !== target && referenceKey(key) && !/\s/.test(key)) expand(value, 'params.' + key, key);
  }
  return choices;
}

/** A semantic editor for the independent parameter source, preserving invalid local text. */
export default function ParameterSourceField({
  flow,
  name,
  change,
  incomplete,
}: {
  flow: Flow;
  name: string;
  change: (flow: Flow) => void;
  incomplete: (key: string, value: boolean) => void;
}) {
  const saved = flow.parameterSources?.[name]?.$ref ?? '';
  const [text, setText] = useState(saved);
  const [failure, setFailure] = useState('');
  const [open, setOpen] = useState(false);
  const id = useId();
  let effective: Json | undefined;
  let semanticError = '';
  try {
    effective = resolveParameterSources(flow)[name];
  } catch (reason) {
    semanticError = reason instanceof Error ? reason.message : '来源不可用';
  }
  const error = failure || semanticError;
  const pending = text !== saved;
  useEffect(() => {
    setText(saved);
    setFailure('');
  }, [saved]);
  useEffect(() => {
    incomplete('source:' + name, pending || !!error);
    return () => incomplete('source:' + name, false);
  }, [pending, error, name, incomplete]);
  const apply = (path: string) => {
    if (path) parameterSourcePath(path);
    const sources = { ...flow.parameterSources };
    if (path) sources[name] = { $ref: path };
    else delete sources[name];
    const next = withParameterSources(flow, sources);
    resolveParameterSources(next);
    change(next);
    setText(path);
    setFailure('');
  };
  return (
    <div
      className="parameter-source-field"
      data-value-invalid={pending || error ? '参数来源尚未完成' : undefined}
    >
      <label htmlFor={id}>来源表达式</label>
      <Input
        id={id}
        aria-label={'参数 ' + name + ' 来源表达式'}
        value={text}
        placeholder="留空使用固定值，例如 params.profile.title"
        status={error ? 'error' : undefined}
        aria-invalid={!!error}
        aria-describedby={id + '-hint'}
        onChange={(event) => {
          const path = event.target.value;
          setText(path);
          try {
            apply(path);
          } catch (reason) {
            setFailure(reason instanceof Error ? reason.message : '来源不可用');
          }
        }}
      />
      <div className="parameter-source-actions">
        <Button onClick={() => setOpen(true)} aria-label={'选择参数 ' + name + ' 的来源变量'}>
          选择变量
        </Button>
        <Button
          disabled={!text}
          onClick={() => {
            try {
              apply('');
            } catch (reason) {
              setFailure(reason instanceof Error ? reason.message : '无法清空来源');
            }
          }}
        >
          清空来源
        </Button>
      </div>
      <p
        id={id + '-hint'}
        className={error ? 'field-error' : 'note'}
        role={error ? 'alert' : undefined}
      >
        {error ||
          (saved
            ? '草稿预览：' +
              JSON.stringify(effective)?.slice(0, 240) +
              ' · 尚未运行。清空来源后使用上方固定值。'
            : '未设置来源，运行使用上方固定值。只支持其他流程参数及其子路径。')}
      </p>
      {open && (
        <VariablePicker
          parameterSource
          label={'参数 ' + name + ' 的来源表达式'}
          choices={choicesFor(flow, name)}
          current={saved || undefined}
          choose={(path) => {
            apply(path);
            setOpen(false);
          }}
          fixed={() => {
            apply('');
            setOpen(false);
          }}
          fixedLabel="清空来源，使用固定值"
          close={() => setOpen(false)}
        />
      )}
    </div>
  );
}
