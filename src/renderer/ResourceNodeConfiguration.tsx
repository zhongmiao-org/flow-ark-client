import { useEffect, useState } from 'react';
import type { Bindings, Json, Step } from '../shared/types';
import ValueField from './ValueField';
import { MappingValues, MatrixValues } from './StructuredValues';
import { resourceOperation } from './resource-form-model';
import { type ReferenceChoice } from './value-references';
export default function ResourceNodeConfiguration({
  node,
  choices,
  change,
  bindings,
  choose,
}: {
  node: Step;
  choices: ReferenceChoice[];
  change: (node: Step) => void;
  bindings: Bindings;
  choose: (binding: string) => void;
}) {
  const field = (
    key: string,
    label: string,
    value: Json,
    defaultValue: Json = '',
    text = false,
  ) => (
    <ValueField
      key={key}
      label={label}
      value={value}
      choices={choices}
      defaultValue={defaultValue}
      change={(next) => change({ ...node, [key]: next } as Step)}
    >
      {text && typeof value === 'string' ? (
        <>
          <label htmlFor={'resource-' + key}>{label}</label>
          <input
            id={'resource-' + key}
            value={value}
            onChange={(e) => change({ ...node, [key]: e.target.value } as Step)}
          />
        </>
      ) : undefined}
    </ValueField>
  );
  if (node.type === 'http')
    return (
      <section aria-label="HTTP 请求配置">
        <label htmlFor="http-method">请求方法</label>
        <select
          id="http-method"
          value={node.method}
          onChange={(e) => change({ ...node, method: e.target.value } as Step)}
        >
          {['GET', 'POST', 'PUT', 'DELETE'].map((method) => (
            <option key={method}>{method}</option>
          ))}
        </select>
        {field('url', '请求地址', node.url, '', true)}
        <MappingValues
          label="请求头"
          kind="headers"
          value={node.headers}
          choices={choices}
          change={(headers) => change({ ...node, headers })}
        />
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
    !!node.binding.trim() && !['__proto__', 'constructor', 'prototype'].includes(node.binding);
  return (
    <section aria-label={isExcel ? 'Excel 配置' : '文件配置'}>
      <label htmlFor="file-operation">操作</label>
      <select
        id="file-operation"
        value={node.operation}
        onChange={(e) => change(resourceOperation(node, e.target.value))}
      >
        <option value="read">读取</option>
        <option value="write">写入</option>
        {isExcel ? (
          <option value="fill">填充工作簿模板</option>
        ) : (
          <>
            <option value="copy">复制文件</option>
            <option value="archive">归档为 ZIP</option>
          </>
        )}
      </select>
      <p className="note">切换操作使用默认配置，可撤销恢复。</p>
      <label htmlFor="resource-binding">文件目录绑定</label>
      <input
        id="resource-binding"
        list="resource-binding-names"
        value={node.binding}
        placeholder="workspace"
        onChange={(e) => change({ ...node, binding: e.target.value })}
      />
      <datalist id="resource-binding-names">
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
        node.operation === 'write' &&
        field('content', '写入内容', node.content)}
      {node.type === 'file' &&
        node.operation === 'copy' &&
        field('content', '源文件名', node.content, '', true)}
      {node.type === 'file' && node.operation === 'archive' && (
        <ValueField
          label="归档文件列表"
          value={node.files}
          choices={choices}
          defaultValue={[]}
          change={(files) => change({ ...node, files })}
        >
          {Array.isArray(node.files) && node.files.every((f) => typeof f === 'string') ? (
            <>
              <label htmlFor="archive-files">归档文件列表</label>
              <FileListInput
                files={node.files as string[]}
                change={(files) => change({ ...node, files })}
              />
              <p className="note">空行忽略。明确选择 1～200 个文件，合计不超过 100 MiB。</p>
            </>
          ) : undefined}
        </ValueField>
      )}
      {node.type === 'excel' && node.operation === 'read' && (
        <p className="note">读取首个工作表，保留空行和原始行列位置；行内空单元格输出为 null。</p>
      )}
      {node.type === 'excel' && node.operation === 'write' && (
        <MatrixValues
          value={node.rows}
          choices={choices}
          change={(rows) => change({ ...node, rows })}
        />
      )}
      {node.type === 'excel' && node.operation === 'fill' && (
        <>
          {field('templateName', '模板文件名', node.templateName, '', true)}
          <label htmlFor="excel-sheet">工作表名称</label>
          <input
            id="excel-sheet"
            value={node.sheet}
            placeholder="留空使用首个工作表"
            onChange={(e) => change({ ...node, sheet: e.target.value })}
          />
          <MappingValues
            label="单元格映射"
            kind="cells"
            value={node.cells}
            choices={choices}
            change={(cells) => change({ ...node, cells })}
          />
          <p className="note">输出必须另存。未填写的单元格、样式和其他工作表沿用模板。</p>
        </>
      )}
    </section>
  );
}

function FileListInput({ files, change }: { files: string[]; change: (files: string[]) => void }) {
  const [text, setText] = useState(files.join('\n'));
  const parse = (value: string) => value.split('\n').filter(Boolean);
  useEffect(() => {
    if (JSON.stringify(parse(text)) !== JSON.stringify(files)) setText(files.join('\n'));
  }, [JSON.stringify(files)]);
  return (
    <textarea
      id="archive-files"
      value={text}
      placeholder="每行一个相对文件名"
      onChange={(e) => {
        setText(e.target.value);
        change(parse(e.target.value));
      }}
    />
  );
}
