import { Select, Button, Input, Collapse } from 'antd';
import { useEffect, useId, useRef, useState } from 'react';
import { activateCollapseWithSpace } from './collapseKeyboard';
import ArchiveFileList from './ArchiveFileList';
import type { Bindings, Json, Step } from '../shared/types';
import ValueField from './ValueField';
import { MappingValues, MatrixValues } from './StructuredValues';
import { resourceOperation, fileConflictPolicy } from './resource-form-model';
import { type ReferenceChoice } from './value-references';
import './node-configuration.css';
export default function ResourceNodeConfiguration({
  node,
  choices,
  change,
  bindings,
  choose,
  compact = false,
  guard = () => true,
}: {
  compact?: boolean;
  guard?: () => boolean;
  node: Step;
  choices: ReferenceChoice[];
  change: (node: Step) => void;
  bindings: Bindings;
  choose: (binding: string) => void;
}) {
  const instanceId = useId();
  const [expandedConfiguration, setExpandedConfiguration] = useState(false);
  const configurationKey = node.type + ('operation' in node ? ':' + node.operation : '');
  useEffect(() => {
    setExpandedConfiguration(false);
  }, [node.id, configurationKey]);
  const appliedBinding = node.type === 'file' || node.type === 'excel' ? node.binding : '';
  const [bindingDraft, setBindingDraft] = useState(appliedBinding);
  const [bindingError, setBindingError] = useState('');
  const bindingInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setBindingDraft(appliedBinding);
    setBindingError('');
  }, [node.id, appliedBinding]);
  const prefix = compact ? instanceId + '-' : '';
  const field = (
    key: string,
    label: string,
    value: Json,
    defaultValue: Json = '',
    text = false,
  ) => (
    <ValueField
      compactReference={compact}
      key={key}
      label={label}
      value={value}
      choices={choices}
      defaultValue={defaultValue}
      change={(next) => change({ ...node, [key]: next } as Step)}
    >
      {text && typeof value === 'string' ? (
        <>
          <label htmlFor={prefix + 'resource-' + key}>{label}</label>
          <Input
            id={prefix + 'resource-' + key}
            value={value}
            onChange={(e) => change({ ...node, [key]: e.target.value } as Step)}
          />
        </>
      ) : undefined}
    </ValueField>
  );
  const configurationInfo =
    node.type === 'http'
      ? {
          key: 'headers',
          title: '请求头',
          content: (
            <MappingValues
              protectDraft={compact}
              label="请求头"
              kind="headers"
              value={node.headers}
              choices={choices}
              change={(headers) => change({ ...node, headers })}
            />
          ),
        }
      : node.type === 'file' && node.operation === 'archive'
        ? {
            key: 'archive',
            title: '编辑归档文件清单',
            content: (
              <ArchiveFileList
                value={node.files}
                choices={choices}
                change={(files) => change({ ...node, files })}
              />
            ),
          }
        : node.type === 'excel' && node.operation === 'write'
          ? {
              key: 'matrix',
              title: '编辑行列数据',
              content: (
                <MatrixValues
                  value={node.rows}
                  choices={choices}
                  change={(rows) => change({ ...node, rows })}
                />
              ),
            }
          : node.type === 'excel' && node.operation === 'fill'
            ? {
                key: 'cells',
                title: '单元格映射',
                content: (
                  <MappingValues
                    protectDraft={compact}
                    label="单元格映射"
                    kind="cells"
                    value={node.cells}
                    choices={choices}
                    change={(cells) => change({ ...node, cells })}
                  />
                ),
              }
            : null;
  const configuration =
    configurationInfo &&
    (compact ? (
      <Collapse
        data-draft-collapse
        size="small"
        activeKey={expandedConfiguration ? [configurationInfo.key] : []}
        onChange={(keys) => setExpandedConfiguration(keys.length > 0)}
        items={[
          {
            key: configurationInfo.key,
            label: configurationInfo.title,
            onKeyDown: activateCollapseWithSpace,
            forceRender: true,
            children: configurationInfo.content,
          },
        ]}
      />
    ) : (
      configurationInfo.content
    ));
  if (node.type === 'http')
    return (
      <section
        className={'node-configuration' + (compact ? ' resource-compact' : '')}
        aria-label="HTTP 请求配置"
      >
        <header>
          <h4>HTTP 请求</h4>
        </header>
        <p>配置方法、地址、请求头和请求体；运行时才会发出请求。</p>
        <label htmlFor={prefix + 'http-method'}>请求方法</label>
        <Select<string>
          id={prefix + 'http-method'}
          value={node.method}
          onChange={(value) => {
            if (guard()) change({ ...node, method: value } as Step);
          }}
          options={[
            ...['GET', 'POST', 'PUT', 'DELETE'].map((method) => ({ value: method, label: method })),
          ]}
        />
        {field('url', '请求地址', node.url, '', true)}
        {configuration}
        {node.method !== 'GET' ? (
          field('body', '请求体', node.body, null)
        ) : (
          <p className="note">GET 不发送请求体，原请求体配置保留。</p>
        )}
      </section>
    );
  if (node.type !== 'file' && node.type !== 'excel') return null;
  const isExcel = node.type === 'excel';
  const validBinding =
    !bindingError &&
    !!node.binding.trim() &&
    !['__proto__', 'constructor', 'prototype'].includes(node.binding);
  return (
    <section
      className={'node-configuration' + (compact ? ' resource-compact' : '')}
      aria-label={isExcel ? 'Excel 配置' : '文件配置'}
    >
      <header>
        <h4>{isExcel ? '工作簿与数据' : '文件与目录'}</h4>
      </header>
      <label htmlFor={prefix + 'file-operation'}>操作</label>
      <Select<string>
        id={prefix + 'file-operation'}
        value={node.operation}
        onChange={(value) => {
          if (guard()) change(resourceOperation(node, value));
        }}
        options={[
          { value: 'read', label: '读取' },
          { value: 'write', label: '写入（可能覆盖）' },
          ...(isExcel
            ? [
                { value: 'map', label: '字段映射 · 新建工作簿' },
                { value: 'fill', label: '填充工作簿模板' },
              ]
            : [
                { value: 'create', label: '新建文本文件（不覆盖）' },
                { value: 'copy', label: '复制文件' },
                { value: 'archive', label: '归档为 ZIP' },
              ]),
        ]}
      />
      <p className="note">切换操作使用默认配置，可撤销恢复。</p>
      <div className="resource-binding-field" data-value-invalid={bindingError || undefined}>
        <label htmlFor={prefix + 'resource-binding'}>文件目录绑定</label>
        <Input
          status={!!bindingError ? 'error' : undefined}
          ref={(instance) => {
            bindingInput.current = instance?.input ?? null;
          }}
          id={prefix + 'resource-binding'}
          list={prefix + 'resource-binding-names'}
          value={bindingDraft}
          placeholder="workspace"
          aria-invalid={!!bindingError}
          aria-describedby={bindingError ? prefix + 'resource-binding-error' : undefined}
          onChange={(event) => {
            const value = event.target.value;
            setBindingDraft(value);
            const error = !value.trim()
              ? '请填写目录绑定名称，例如 workspace。'
              : ['__proto__', 'constructor', 'prototype'].includes(value)
                ? '此名称不可用于目录绑定，请使用其他名称。'
                : '';
            setBindingError(error);
            if (!error) change({ ...node, binding: value });
          }}
        />
        {bindingError && (
          <>
            <p id={prefix + 'resource-binding-error'} className="field-error" role="alert">
              {bindingError}
            </p>
            <Button
              htmlType="button"
              onClick={() => {
                setBindingDraft(appliedBinding);
                setBindingError('');
                bindingInput.current?.focus();
              }}
            >
              恢复已应用绑定
            </Button>
          </>
        )}
      </div>
      <datalist id={prefix + 'resource-binding-names'}>
        {Object.keys(bindings.files).map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <p className="path-text">{bindings.files[node.binding] || '尚未选择本机目录'}</p>
      <Button
        htmlType="button"
        disabled={!validBinding || undefined}
        aria-label="选择节点文件目录"
        onClick={() => choose(node.binding)}
      >
        选择此目录
      </Button>
      {field(
        'name',
        node.operation === 'read'
          ? '读取文件名'
          : node.operation === 'copy'
            ? '目标文件名'
            : node.operation === 'archive'
              ? '归档文件名'
              : '输出文件名',
        node.name,
        '',
        true,
      )}
      <p className="note">文件名为绑定目录内的相对路径；运行时检查目录范围。</p>
      {node.type === 'file' &&
        (node.operation === 'write' || node.operation === 'create') &&
        field('content', '写入内容', node.content)}
      {node.type === 'file' && node.operation === 'create' && (
        <>
          <label htmlFor={prefix + 'file-conflict'}>已有同名文件时</label>
          <Select<string>
            id={prefix + 'file-conflict'}
            value={node.version === 4 ? 'number' : 'error'}
            onChange={(value) => change(fileConflictPolicy(node, value))}
            options={[
              { value: 'error', label: '停止并提示，保留原文件' },
              { value: 'number', label: '新建带序号的文件，保留原文件' },
            ]}
          />
          <p className="note">
            仅接受文本，UTF-8 内容最多 10 MiB；
            {node.version === 4
              ? '同名自动加序号，不覆盖。实际文件名在结果中显示。'
              : '同名文件存在时停止，不覆盖、不自动改名。'}
          </p>
        </>
      )}
      {node.type === 'file' &&
        node.operation === 'copy' &&
        field('content', '源文件名', node.content, '', true)}
      {node.type === 'file' && node.operation === 'archive' && configuration}
      {node.type === 'excel' && node.operation === 'read' && (
        <p className="note">读取首个工作表，保留空行和原始行列位置；行内空单元格输出为 null。</p>
      )}
      {node.type === 'excel' && node.operation === 'write' && configuration}
      {node.type === 'excel' && node.operation === 'map' && (
        <p className="note">字段映射在完整编辑页配置；输出只新建，不覆盖同名文件。</p>
      )}
      {node.type === 'excel' && node.operation === 'fill' && (
        <>
          {field('templateName', '模板文件名', node.templateName, '', true)}
          <label htmlFor={prefix + 'excel-sheet'}>工作表名称</label>
          <Input
            id={prefix + 'excel-sheet'}
            value={node.sheet}
            placeholder="留空使用首个工作表"
            onChange={(e) => change({ ...node, sheet: e.target.value })}
          />
          {configuration}
          <p className="note">输出必须另存。未填写的单元格、样式和其他工作表沿用模板。</p>
        </>
      )}
    </section>
  );
}
