import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import ArchiveFileList from './ArchiveFileList';
import type { Bindings, Json, Step } from '../shared/types';
import ValueField from './ValueField';
import { MappingValues, MatrixValues } from './StructuredValues';
import { resourceOperation, fileConflictPolicy } from './resource-form-model';
import { type ReferenceChoice } from './value-references';
import './node-configuration.css';
function ResourceDetails({
  compact,
  title,
  children,
}: {
  compact: boolean;
  title: string;
  children: ReactNode;
}) {
  return compact ? (
    <details>
      <summary>{title}</summary>
      {children}
    </details>
  ) : (
    children
  );
}
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
          <input
            id={prefix + 'resource-' + key}
            value={value}
            onChange={(e) => change({ ...node, [key]: e.target.value } as Step)}
          />
        </>
      ) : undefined}
    </ValueField>
  );
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
        <select
          id={prefix + 'http-method'}
          value={node.method}
          onChange={(e) => {
            if (guard()) change({ ...node, method: e.target.value } as Step);
          }}
        >
          {['GET', 'POST', 'PUT', 'DELETE'].map((method) => (
            <option key={method}>{method}</option>
          ))}
        </select>
        {field('url', '请求地址', node.url, '', true)}
        <ResourceDetails compact={compact} title="请求头">
          <MappingValues
            protectDraft={compact}
            label="请求头"
            kind="headers"
            value={node.headers}
            choices={choices}
            change={(headers) => change({ ...node, headers })}
          />
        </ResourceDetails>
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
      <select
        id={prefix + 'file-operation'}
        value={node.operation}
        onChange={(e) => {
          if (guard()) change(resourceOperation(node, e.target.value));
        }}
      >
        <option value="read">读取</option>
        <option value="write">写入（可能覆盖）</option>
        {isExcel ? (
          <>
            <option value="map">字段映射 · 新建工作簿</option>
            <option value="fill">填充工作簿模板</option>
          </>
        ) : (
          <>
            <option value="create">新建文本文件（不覆盖）</option>
            <option value="copy">复制文件</option>
            <option value="archive">归档为 ZIP</option>
          </>
        )}
      </select>
      <p className="note">切换操作使用默认配置，可撤销恢复。</p>
      <div className="resource-binding-field" data-value-invalid={bindingError || undefined}>
        <label htmlFor={prefix + 'resource-binding'}>文件目录绑定</label>
        <input
          ref={bindingInput}
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
            <button
              type="button"
              onClick={() => {
                setBindingDraft(appliedBinding);
                setBindingError('');
                bindingInput.current?.focus();
              }}
            >
              恢复已应用绑定
            </button>
          </>
        )}
      </div>
      <datalist id={prefix + 'resource-binding-names'}>
        {Object.keys(bindings.files).map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <p className="path-text">{bindings.files[node.binding] || '尚未选择本机目录'}</p>
      <button
        type="button"
        disabled={!validBinding}
        aria-label="选择节点文件目录"
        onClick={() => choose(node.binding)}
      >
        选择此目录
      </button>
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
          <select
            id={prefix + 'file-conflict'}
            value={node.version === 4 ? 'number' : 'error'}
            onChange={(e) => change(fileConflictPolicy(node, e.target.value))}
          >
            <option value="error">停止并提示，保留原文件</option>
            <option value="number">新建带序号的文件，保留原文件</option>
          </select>
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
      {node.type === 'file' && node.operation === 'archive' && (
        <ResourceDetails compact={compact} title="编辑归档文件清单">
          <ArchiveFileList
            value={node.files}
            choices={choices}
            change={(files) => change({ ...node, files })}
          />
        </ResourceDetails>
      )}
      {node.type === 'excel' && node.operation === 'read' && (
        <p className="note">读取首个工作表，保留空行和原始行列位置；行内空单元格输出为 null。</p>
      )}
      {node.type === 'excel' && node.operation === 'write' && (
        <ResourceDetails compact={compact} title="编辑行列数据">
          <MatrixValues
            value={node.rows}
            choices={choices}
            change={(rows) => change({ ...node, rows })}
          />
        </ResourceDetails>
      )}
      {node.type === 'excel' && node.operation === 'map' && (
        <p className="note">字段映射在完整编辑页配置；输出只新建，不覆盖同名文件。</p>
      )}
      {node.type === 'excel' && node.operation === 'fill' && (
        <>
          {field('templateName', '模板文件名', node.templateName, '', true)}
          <label htmlFor={prefix + 'excel-sheet'}>工作表名称</label>
          <input
            id={prefix + 'excel-sheet'}
            value={node.sheet}
            placeholder="留空使用首个工作表"
            onChange={(e) => change({ ...node, sheet: e.target.value })}
          />
          <ResourceDetails compact={compact} title="单元格映射">
            <MappingValues
              protectDraft={compact}
              label="单元格映射"
              kind="cells"
              value={node.cells}
              choices={choices}
              change={(cells) => change({ ...node, cells })}
            />
          </ResourceDetails>
          <p className="note">输出必须另存。未填写的单元格、样式和其他工作表沿用模板。</p>
        </>
      )}
    </section>
  );
}
