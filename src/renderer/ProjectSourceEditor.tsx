import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, List, Space, Tree, Tag } from 'antd';
import type { DataNode } from 'antd/es/tree';
import * as monaco from 'monaco-editor';
import CodeEditor, { type CodeLocation } from './CodeEditor';
import { scriptSdk } from '../projects/sdk';
import manifestSchema from '../../contracts/local-project-v1.schema.json';
import './project-source.css';

export type ProjectIssue = { code?: string; message: string; file?: string; field?: string; entryId?: string; line?: number; column?: number };
const language = (p: string) => p.endsWith('.json') ? 'json' : p.endsWith('.ts') ? 'typescript' : p.endsWith('.js') ? 'javascript' : p.endsWith('.mmd') ? 'mermaid' : p.endsWith('.md') ? 'markdown' : 'plaintext';
if (!monaco.languages.getLanguages().some(l => l.id === 'mermaid')) {
  monaco.languages.register({ id: 'mermaid', extensions: ['.mmd'] });
  monaco.languages.setMonarchTokensProvider('mermaid', { tokenizer: { root: [
    [/%%.*$/, 'comment'], [/\b(flowchart|graph|subgraph|end|TD|TB|LR)\b/, 'keyword'], [/-->|\|(?:then|else|body|next)\|/, 'operator'], [/"[^"\n]*"/, 'string'], [/[A-Za-z_][\w-]*/, 'identifier'],
  ] } });
}
function tree(paths: string[], dirty: string[]): DataNode[] {
  const root: DataNode[] = [];
  for (const path of [...paths].sort()) {
    let list = root, at = '';
    path.split('/').forEach((part, index, parts) => {
      at += (at ? '/' : '') + part;
      let node = list.find(n => n.key === at);
      if (!node) { node = { key: at, title: part + (dirty.includes(path) && index === parts.length - 1 ? ' ●' : ''), isLeaf: index === parts.length - 1 }; list.push(node); }
      if (!node.isLeaf) list = node.children ??= [];
    });
  }
  return root;
}
export default function ProjectSourceEditor({ projectId, file, paths, contents, edits, choose, change, issues, locateBlock, focusRequest, busy }:
  { projectId: string; file: string; paths: string[]; contents: Record<string, string>; edits: Record<string, string>;
    choose: (path: string) => void; change: (path: string, value: string) => void; issues: ProjectIssue[];
    busy: boolean; locateBlock: (id: string) => void; focusRequest?: { file: string; field?: string; request: number } }) {
  const base = `flowark-project://${encodeURIComponent(projectId)}/`;
  const models = useRef(new Map<string, monaco.editor.ITextModel>());
  const [markers, setMarkers] = useState<Record<string, ProjectIssue[]>>({});
  const [location, setLocation] = useState<CodeLocation>();
  const uri = (path: string) => monaco.Uri.parse(base + path.split('/').map(encodeURIComponent).join('/'));
  const all = { ...contents, ...edits };
  useEffect(() => {
    for (const [path, value] of Object.entries(all)) {
      let model = models.current.get(path);
      if (!model || model.isDisposed()) { model = monaco.editor.getModel(uri(path)) ?? monaco.editor.createModel(value, language(path), uri(path)); models.current.set(path, model); }
      else if (model.getValue() !== value) model.setValue(value);
    }
  }, [contents, edits]);
  useEffect(() => {
    const sdkUri = base + 'flowark-sdk.d.ts';
    const libs = [monaco.typescript.typescriptDefaults.addExtraLib(scriptSdk, sdkUri), monaco.typescript.javascriptDefaults.addExtraLib(scriptSdk, sdkUri)];
    let live = true;
    void import('virtual:flowark-node-types').then(({ default: types }) => {
      if (!live) return;
      for (const [path, text] of Object.entries(types)) {
        const file = base + path;
        libs.push(monaco.typescript.typescriptDefaults.addExtraLib(text, file), monaco.typescript.javascriptDefaults.addExtraLib(text, file));
      }
    }).catch(() => { if (live) setMarkers(old => ({ ...old, '__types': [{ message: '本地Node类型资料加载失败；请重新打开工程，正式校验仍使用检查工程。' }] })); });
    return () => { live = false; libs.forEach(l => l.dispose()); for (const m of models.current.values()) if (!m.isDisposed()) m.dispose(); models.current.clear(); };
  }, [projectId]);
  const schemas = useMemo(() => {
    let manifest: any, configuration: any;
    try { manifest = JSON.parse(all['flowark.project.json'] ?? ''); } catch {}
    try { configuration = JSON.parse(all['schemas/configuration.json'] ?? ''); } catch {}
    const schemas: any[] = [{ uri: base + '__manifest_schema', fileMatch: [uri('flowark.project.json').toString()], schema: manifestSchema }];
    if (configuration) schemas.push({ uri: base + '__configuration_schema', fileMatch: [uri('config/defaults.json').toString()], schema: configuration });
    for (const e of manifest?.entries ?? []) {
      try { schemas.push({ uri: base + '__input_schema/' + e.id, fileMatch: [], schema: JSON.parse(all[e.inputSchema]) }); } catch {}
    }
    return schemas;
  }, [all['flowark.project.json'], all['schemas/configuration.json']]);
  useEffect(() => {
    const defaults = monaco.json.jsonDefaults;
    const prior = defaults.diagnosticsOptions;
    defaults.setDiagnosticsOptions({ ...prior, validate: true, enableSchemaRequest: false, schemas: [...(prior.schemas ?? []).filter(s => !s.uri.startsWith(base)), ...schemas] });
    return () => defaults.setDiagnosticsOptions({ ...defaults.diagnosticsOptions, schemas: defaults.diagnosticsOptions.schemas?.filter(s => !s.uri.startsWith(base)) });
  }, [schemas, base]);
  const jump = (issue: ProjectIssue) => {
    if (!issue.file || !paths.includes(issue.file)) return;
    choose(issue.file);
    if (issue.line) setLocation({ lineNumber: issue.line, column: issue.column ?? 1, request: Date.now() });
    else if (issue.field) {
      const model = models.current.get(issue.file);
      const matches = model?.findMatches(issue.field, false, false, true, null, true) ?? [];
      if (matches.length) setLocation({ lineNumber: matches[0].range.startLineNumber, column: matches[0].range.startColumn, request: Date.now() });
      else setLocation(undefined);
    } else setLocation(undefined);
  };
  useEffect(() => { if (focusRequest?.file === file) jump({ file, field: focusRequest.field, message: '' }); }, [focusRequest, file]);
  const problems = [...issues, ...Object.values(markers).flat()];
  const blockNames = file.endsWith('.mmd') ? [...(all[file] ?? '').matchAll(/^\s*([\w-]+)\["/gm)].map(m => m[1]) : [];
  return <div className="project-source-layout">
    <aside aria-label="工程文件树"><Tree disabled={busy} blockNode defaultExpandAll selectedKeys={[file]} treeData={tree(paths, Object.keys(edits))} onSelect={(keys, info) => { if (info.node.isLeaf && keys[0]) choose(String(keys[0])); }} /></aside>
    <section className="project-source-main" aria-label="工程文件编辑">
      <Space wrap><strong>{file}</strong>{edits[file] !== undefined && <Tag>未保存</Tag>}<small>JS/TS 可从 ../flowark-sdk 导入 FlowArkContext 类型</small></Space>
      <CodeEditor label={`工程源码 ${file}`} readOnly={busy} path={uri(file).toString()} keepCurrentModel language={language(file)} height="550px" value={all[file] ?? ''} location={location} onChange={v => change(file, v)} onValidate={list => setMarkers(old => ({ ...old, [file]: list.map(m => ({ message: m.message, file, line: m.startLineNumber, column: m.startColumn })) }))} />
      {!!blockNames.length && <details><summary>定位可视化区块</summary><Space wrap>{blockNames.map(id => <Button key={id} onClick={() => locateBlock(id)}>{id}</Button>)}</Space></details>}
      <section aria-label="工程问题列表"><h3>问题列表 · {problems.length}</h3>{!problems.length ? <p>暂无诊断；完整静态校验使用“检查工程”，不执行脚本。</p> : <List dataSource={problems} renderItem={(p, i) => <List.Item key={i}><div><Button type="link" disabled={!p.file || !paths.includes(p.file)} onClick={() => jump(p)}>{p.file ?? '工程'}{p.line ? `:${p.line}:${p.column ?? 1}` : ''}</Button><span>{p.message}</span><small> {[p.entryId && '入口 ' + p.entryId, p.field && '区块/字段 ' + p.field].filter(Boolean).join(' · ')}</small></div></List.Item>} />}</section>
      <Alert type="info" message="编辑与诊断不执行源码。运行和打包采用已保存修订；磁盘冲突须另行核对。" />
    </section>
  </div>;
}
