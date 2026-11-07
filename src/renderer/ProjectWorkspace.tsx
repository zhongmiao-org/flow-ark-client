import ProjectAiConversation from './ProjectAiConversation';
import DesktopAutomationPanel from './DesktopAutomationPanel';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Alert, Button, Card, Select, Space, Tabs, Tag, Modal, Typography, Input, InputNumber, Checkbox } from 'antd';
import type { Step } from '../shared/types';
import { compileGraph, emitGraph } from '../projects/graph';
import { buildDiagram } from './flow-diagram';
import DiagramCanvas from './DiagramCanvas';
import JsonTreeEditor from './JsonTreeEditor';
import ProjectSourceEditor, { type ProjectIssue } from './ProjectSourceEditor';
const api = (method: string, args: unknown = {}): Promise<any> => window.flowark.request(method, args);
type Info = { id: string; root: string; revision: string; metadata: { name: string }; entries: { id: string; name: string }[]; files: { path: string; size: number }[] };
export default function ProjectWorkspace({ back, configure, navigation, initialTask }: { initialTask?: string; back: () => void; configure: (detail: any) => void; navigation: MutableRefObject<((next: () => void) => void) | undefined> }) {
  const [info, setInfo] = useState<Info>(), [entryId, setEntryId] = useState(''), [selected, setSelected] = useState('');
  const [files, setFiles] = useState<Record<string, string>>({}), [edits, setEdits] = useState<Record<string, string>>({});
  const [desktopScope, setDesktopScope] = useState('');
  const [entry, setEntry] = useState<any>(), [file, setFile] = useState(''), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [conflict, setConflict] = useState(false), [pendingField, setPendingField] = useState(false);
  const [ai, setAi] = useState<any>(), [aiProvider, setAiProvider] = useState('deepseek'), [baseUrl, setBaseUrl] = useState('');
  const [protocol, setProtocol] = useState('chat-completions'), [model, setModel] = useState(''), [credentialId, setCredentialId] = useState('');
  const [keyValue, setKeyValue] = useState(''), [task, setTask] = useState('');
  const [evidenceRuns,setEvidenceRuns]=useState<any[]>([]),[evidenceRun,setEvidenceRun]=useState('');
  const [tab, setTab] = useState('blocks');
  const [issues, setIssues] = useState<ProjectIssue[]>([]);
  const [focusRequest, setFocusRequest] = useState<{ file: string; field?: string; request: number }>();
  const [recentProjects, setRecentProjects] = useState<{ id: string; root: string }[]>([]);
  useEffect(() => { void api('project.list').then(setRecentProjects).catch(e => setError(e.message)); }, []);
  const [newName, setNewName] = useState('我的流程工程');
  const localKeyId = useRef('local-' + crypto.randomUUID());
  const state = useRef({ info, edits, busy }); state.current = { info, edits, busy };
  const dirty = Object.keys(edits).length > 0;
  const perform = async (fn: () => Promise<void>) => { if (state.current.busy) return; state.current.busy = true; setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { state.current.busy = false; setBusy(false); } };
  const read = async (p: Info, path: string) => (await api('project.read', { id: p.id, revision: p.revision, path })).content as string;
  const load = async (p: Info, id: string) => {
    const manifestText = await read(p, 'flowark.project.json'), manifest = JSON.parse(manifestText), e = manifest.entries.find((e: any) => e.id === id); if (!e) return;
    const [graph, nodes] = await Promise.all([read(p, e.graph), read(p, e.nodes)]);
    const configuration = await read(p, manifest.configurationSchema);
    setFiles({ 'flowark.project.json': manifestText, [manifest.configurationSchema]: configuration, [e.graph]: graph, [e.nodes]: nodes });
    setIssues([]);
    setEdits({}); setConflict(false); setEntry(e); setEntryId(id); setFile(e.graph); setSelected('');
  };
  const leave = (next: () => void) => {
    if (busy) return;
    if (!dirty && !pendingField && !keyValue) { next(); return; }
    Modal.confirm({ title: '保留当前工程编辑？', content: '返回编辑可应用字段并保存；放弃只丢弃当前未保存输入，不修改磁盘。', okText: '返回编辑', cancelText: '放弃并离开', onCancel: next });
  };
  navigation.current = leave;
  useEffect(() => () => { navigation.current = undefined; }, [navigation]);
  useEffect(() => {
    if (!info) return;
    const timer = setInterval(() => { if (state.current.busy) return;
      void api('project.get', { id: info.id }).then((next: Info) => { if (next.revision !== state.current.info?.revision) { setConflict(true); setNotice('磁盘工程已变化，当前输入保留；请读取磁盘版本后合并。'); } }).catch(e => setError(e.message));
    }, 5000); return () => clearInterval(timer);
  }, [info?.id]);
  useEffect(() => {
    if (!info) return;
    let live = true;
    setDesktopScope(''); setTask(initialTask ?? ''); if (initialTask) setTab('ai'); setKeyValue(''); setCredentialId(''); setBaseUrl(''); setModel('');
    const refresh = () => void api('project.ai.get', { id: info.id }).then(next => {
      if (!live) return; setAi(next);
    }).catch(e => { if (live) setError(e.message); });
    void api('project.ai.get', { id: info.id }).then(next => { if (!live) return; setAi(next); setAiProvider(next.connection.provider);
      if (next.connection.provider === 'compatible') { setBaseUrl(next.connection.baseUrl); setProtocol(next.connection.protocol); setModel(next.connection.model); setCredentialId(next.connection.credentialId); }
    }).catch(e => { if (live) setError(e.message); });
    const timer = setInterval(refresh, 3000); return () => { live = false; clearInterval(timer); };
  }, [info?.id]);
  const value = (path: string) => edits[path] ?? files[path] ?? '';
  const chooseFile = (path: string) => {
    if (files[path] !== undefined) { setFile(path); return; }
    void perform(async () => {
    if (!info) return;
    if (files[path] === undefined) { const content = await read(info, path); setFiles(old => ({ ...old, [path]: content })); }
    setFile(path);
    });
  };
  const locateSource = (path: string, field?: string) => { chooseFile(path); setTab('source'); setFocusRequest({ file: path, field, request: Date.now() }); };

  const projection = useMemo(() => {
    try { if (!entry) return { steps: [] as Step[], bindings: {} as Record<string, any>, error: '' };
      const bindings = JSON.parse(value(entry.nodes));
      return { steps: compileGraph(value(entry.graph), Object.fromEntries(Object.entries(bindings).map(([id, b]: [string, any]) => [id, b.node])), entry.graph), bindings, error: '' };
    } catch (e) { return { steps: [] as Step[], bindings: {} as Record<string, any>, error: e instanceof Error ? e.message : String(e) }; }
  }, [entry, files, edits]);
  const diagram = useMemo(() => buildDiagram(projection.steps, selected), [projection.steps, selected]);
  const changeSteps = (steps: Step[], bindings = projection.bindings) => {
    const output = emitGraph(steps), next: Record<string, any> = {};
    for (const [id, node] of Object.entries(output.nodes)) next[id] = { ...bindings[id], node };
    setEdits(old => ({ ...old, [entry.graph]: output.mermaid, [entry.nodes]: JSON.stringify(next, null, 2) + '\n' }));
  };
  const transform = (steps: Step[], action: (list: Step[], index: number) => void): boolean => {
    const index = steps.findIndex(s => s.id === selected); if (index >= 0) { action(steps, index); return true; }
    for (const n of steps) { if (n.type === 'condition' && (transform(n.then, action) || transform(n.else, action))) return true; if (n.type === 'loop' && transform(n.body, action)) return true; } return false;
  };
  const reviewDifferences = async () => {
    if (!info) return;
    const base = info, local = structuredClone(edits), next = await api('project.get', { id: info.id });
    const paths = [...new Set([...Object.keys(files), ...Object.keys(local)])];
    const disk: Record<string, string> = {};
    for (const path of paths) {
      if (!next.files.some((f: any) => f.path === path)) { disk[path] = ''; continue; }
      disk[path] = await read(next, path);
    }
    const changed = paths.filter(path => files[path] !== disk[path] || local[path] !== undefined);
    Modal.confirm({ title: '核对工程差异', width: 1200, okText: '保留当前编辑，采用新修订', cancelText: '返回编辑',
      content: <div style={{ maxHeight: '65vh', overflow: 'auto' }}><p>这里只更新编辑基准，不写入磁盘。随后保存会提交保留的本地编辑；请逐文件核对磁盘变更。</p>
        {changed.map(path => <section key={path}><h3>{path}</h3><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 12 }}>
          {[['原修订', files[path] ?? '（不存在）'], ['当前编辑', local[path] ?? files[path] ?? '（不存在）'], ['磁盘版本', disk[path] ?? '（不存在）']].map(([label, text]) => <div key={label}><strong>{label}</strong><pre tabIndex={0} style={{ maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</pre></div>)}
        </div></section>)}</div>,
      onOk: async () => {
        const latest = await api('project.get', { id: base.id });
        if (latest.revision !== next.revision) { setConflict(true); throw Error('核对期间磁盘再次变化，请重新查看差异'); }
        if (!next.entries.some((e: any) => e.id === entryId)) throw Error('当前入口已被外部移除，请保留内容后重新打开工程');
        const manifest = JSON.parse(disk['flowark.project.json']);
        setInfo(next); setFiles(disk); setEdits(local); setEntry(manifest.entries.find((e: any) => e.id === entryId)); setConflict(false);
        setNotice('已核对三方差异；当前编辑仍未保存。保存将使用已核对的磁盘修订。');
      },
    });
  };
  const reload = async () => { if (!info) return; const next: Info = await api('project.get', { id: info.id }); setInfo(next); await load(next, next.entries.some(e => e.id === entryId) ? entryId : next.entries[0]?.id ?? ''); };
  return <section className="template-workspace" style={{ padding: 24 }}>
    <Space wrap style={{ marginBottom: 20 }}><Button onClick={() => leave(back)}>返回我的流程</Button><Typography.Title level={2} style={{ margin: 0 }}>流程编辑器</Typography.Title>
      <Button disabled={busy} onClick={() => leave(() => void perform(async () => { const next = await api('project.choose'); if (next) { setInfo(next); await load(next, next.entries[0].id); } }))}>打开工程目录</Button>
      {info && <Tag>{info.revision.slice(0, 12)}{dirty ? ' · 未保存' : ' · 已保存'}</Tag>}</Space>
    {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}{notice && <Alert type={conflict ? 'warning' : 'info'} showIcon message={notice} style={{ marginBottom: 16 }} />}
    {!info ? <Card title="代码、区块与 Agent 共用一个工程">{initialTask && <Alert type="info" message="桌面任务需求已保留" description={initialTask + ' 请选择存放目录创建工程，然后绑定目标窗口并在 AI 开发中确认方案并生成流程。'} />}<h3>已连接工程</h3>{recentProjects.length ? recentProjects.map(p => <div key={p.id} style={{ marginBottom: 12 }}><Button disabled={busy} onClick={() => void perform(async () => { const next = await api('project.get', { id: p.id }); setInfo(next); await load(next, next.entries[0].id); })}>打开 {p.root.split(/[\\/]/).pop()}</Button><small> {p.root}</small></div>) : <p>还没有工程。可打开目录，或创建第一个工程。</p>}<p>打开包含 flowark.project.json 的目录。Mermaid 定义结构，区块绑定参数和 JS/TS；连接不运行流程。</p><p>CLI / MCP 使用安装包内启动器；Key 使用受保护凭据，不写入工程或 env。</p>
      <Space><Input aria-label="新工程名称" value={newName} onChange={e => setNewName(e.target.value)} /><Button disabled={busy || !newName.trim()} onClick={() => void perform(async () => { const next = await api('project.create', { name: newName }); if (next) { setInfo(next); await load(next, next.entries[0].id); } })}>创建工程</Button></Space>
    </Card> : <>
      <Space wrap style={{ marginBottom: 16 }}><Select aria-label="工程入口" value={entryId} style={{ minWidth: 240 }} options={info.entries.map(e => ({ value: e.id, label: e.name }))} onChange={id => leave(() => void perform(() => load(info, id)))} />
        <Button disabled={busy || !dirty || conflict || pendingField} onClick={() => void perform(async () => { const next = await api('project.write', { id: info.id, revision: info.revision, changes: Object.entries(edits).map(([path, content]) => ({ path, content })) }); const p = { ...next, id: info.id, root: info.root }; setInfo(p); await load(p, entryId); setNotice('工程已保存，界面与磁盘使用同一修订。'); })}>保存工程</Button>
        <Button disabled={busy || conflict || pendingField} onClick={() => void perform(async () => { const result = await api('project.diagnose', { id: info.id, revision: info.revision, changes: Object.entries(edits).map(([path, content]) => ({ path, content })) }); setIssues(result.diagnostics); setNotice(result.valid ? '静态检查通过，尚未运行或验收。' : '静态检查发现问题，内容未写入磁盘。'); setTab('source'); })}>检查工程</Button>
        <Button disabled={busy || dirty || conflict || pendingField} onClick={() => void perform(async () => configure(await api('project.prepare', { id: info.id, revision: info.revision }))) }>配置调试与运行</Button>
        <Button disabled={busy || dirty || conflict || pendingField} onClick={() => void perform(async () => configure(await api('project.prepare', { id: info.id, revision: info.revision, isolate: true }))) }>新建隔离调试实例</Button>
        <Button disabled={busy || dirty || conflict || pendingField} onClick={() => void perform(async () => { const r = await api('project.package', { id: info.id, revision: info.revision }); if (r) setNotice('完整ZIP已保存：' + r.sha256); })}>导出完整ZIP</Button>
        <Button disabled={busy} onClick={() => leave(() => void perform(reload))}>读取磁盘版本</Button>
        {conflict && <Button disabled={busy || pendingField} onClick={() => void perform(reviewDifferences)}>核对磁盘差异</Button>}</Space>
      <Tabs activeKey={tab} onChange={setTab} items={[{ key: 'desktop', label: '桌面窗口', children: <><p>先构建当前工程以固定实例身份，再绑定本次窗口。此操作不会运行流程。</p><Button disabled={busy || dirty || conflict || pendingField} onClick={() => void perform(async () => { const detail = await api('project.prepare', { id: info.id, revision: info.revision }); setDesktopScope(detail.instance.id); })}>准备桌面实例</Button>{desktopScope && <DesktopAutomationPanel key={desktopScope} scopeId={desktopScope} connection={ai?.connection} />}</> }, { key: 'blocks', label: '区块与参数', children: <div style={{ display: 'grid', gridTemplateColumns: 'minmax(350px, 1fr) minmax(320px, 1fr)', gap: 16 }}><Card title="流程编排">
        {projection.error ? <Alert type="error" message={projection.error} /> : <><Space wrap><Button disabled={busy} onClick={() => { const id = 'n_' + crypto.randomUUID().slice(0, 8); changeSteps([...projection.steps, { id, type: 'value', version: 1, name: '新数据步骤', value: null }]); setSelected(id); }}>新增数据步骤</Button>
          {(['上移', '下移', '移除'] as const).map((label, action) => <Button key={label} disabled={!selected || busy} onClick={() => { const steps = structuredClone(projection.steps); transform(steps, (list, i) => { if (action === 2) list.splice(i, 1); else { const j = i + (action === 0 ? -1 : 1); if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]]; } }); changeSteps(steps); if (action === 2) setSelected(''); }}>{label}</Button>)}</Space>
          <div style={{ height: 550 }}><DiagramCanvas nodes={diagram.nodes} edges={diagram.edges} selected={selected} select={setSelected} /></div></>}
      </Card><Card title={selected ? '区块绑定 · ' + selected : '选择区块编辑参数'}>{selected && <Space style={{ marginBottom: 12 }}><Button onClick={() => locateSource(entry.nodes, selected)}>定位节点源码</Button><Button onClick={() => locateSource(entry.graph, selected)}>定位编排源码</Button>{typeof projection.bindings[selected]?.script === 'string' && <Button onClick={() => locateSource(projection.bindings[selected].script)}>定位脚本</Button>}</Space>}{projection.bindings[selected] && <JsonTreeEditor key={selected} value={projection.bindings[selected]} disabled={busy} onPendingChange={setPendingField} rootLabel="区块绑定" change={next => { const steps = structuredClone(projection.steps); transform(steps, (list, i) => { list[i] = { ...list[i], ...(next as any).node }; }); changeSteps(steps, { ...projection.bindings, [selected]: next }); }} />}</Card></div> },
        { key: 'source', label: '源码与配置', children: <Card title="工程文件"><ProjectSourceEditor key={info.id} projectId={info.id} busy={busy} file={file} paths={info.files.filter(f => /\.(json|mmd|md|js|ts)$/.test(f.path) || f.path === '.env.example').map(f => f.path)} contents={files} edits={edits} choose={chooseFile} change={(path, content) => setEdits(old => { const next = { ...old }; if (content === files[path]) delete next[path]; else next[path] = content; return next; })} issues={issues} focusRequest={focusRequest} locateBlock={id => { setSelected(id); setTab('blocks'); }} /></Card> },
        { key: 'ai', label: 'AI 开发', children: <Card title="一起确认字段和流程节点">
          <ProjectAiConversation tasks={ai?.tasks??[]} message={task} change={setTask} busy={busy||dirty||pendingField||conflict} ready={true} usage={ai?.usage}
            send={(current,answer)=>void perform(async()=>{
              const text=answer??task;
              if(current) await api('project.ai.resume',{id:info.id,taskId:current.id,answer:text});
              else await api('project.ai.start',{id:info.id,task:text});
              setTask('');setAi(await api('project.ai.get',{id:info.id}));
            })}
            review={(current,operation,nodes)=>void perform(async()=>{await api('project.ai.review',{id:info.id,taskId:current.id,reviewStamp:current.review.stamp,operation,nodes});setAi(await api('project.ai.get',{id:info.id}));if(operation==='assemble')await reload();})}
            detail={current=>void perform(async()=>{const detail=await api('project.ai.detail',{id:info.id,taskId:current.id});Modal.info({title:'开发步骤与结果（只读）',width:960,content:<pre tabIndex={0} style={{maxHeight:520,overflow:'auto',whiteSpace:'pre-wrap',userSelect:'text'}}>{JSON.stringify(detail,null,2)}</pre>});})}
            cancel={current=>void perform(async()=>{await api('project.ai.cancel',{id:info.id,taskId:current.id});setAi(await api('project.ai.get',{id:info.id}));})}
            evidence={<Space direction="vertical" style={{width:'100%'}}>
              <Space wrap><Button disabled={busy} onClick={()=>void perform(async()=>{const selected=await api('project.ai.chooseWorkbook',{id:info.id});if(selected){setAi(await api('project.ai.get',{id:info.id}));setNotice('只读表头已准备；提交回答后才发送给AI，不含客户数据行。');}})}>选择 Excel 并读取表头</Button>
              <Button disabled={busy} onClick={()=>void perform(async()=>{const h=await api('project.run.history',{id:info.id});setEvidenceRuns(h.runs);})}>选择运行结果用于排错</Button></Space>
              {ai?.evidence?.workbook&&<p>已选：{ai.evidence.workbook.name} · {ai.evidence.workbook.rowCount} 行 · 表头：{ai.evidence.workbook.headers.map((h:any)=>h.header||'（无表头）').join('、')}</p>}
              {!!evidenceRuns.length&&<Space wrap><Select aria-label="用于排错的运行" style={{width:360}} value={evidenceRun||undefined} onChange={setEvidenceRun} options={evidenceRuns.map(r=>({value:r.id,label:new Date(r.createdAt).toLocaleString()+' · '+r.state+' · '+r.name}))}/><Button disabled={!evidenceRun||busy} onClick={()=>void perform(async()=>{await api('project.ai.runEvidence',{id:info.id,runId:evidenceRun});setAi(await api('project.ai.get',{id:info.id}));setNotice('运行身份、节点状态、错误和动作状态已关联，不包含完整业务输出；提交回答后才调用AI。');})}>关联所选运行</Button></Space>}
              {ai?.evidence?.run&&<p>关联 Run：{ai.evidence.run.runId} · {ai.evidence.run.state} · {ai.evidence.run.error??'没有运行错误；业务结果仍须核对'}</p>}
            </Space>}
            cost={<p>API Key 产生的费用由用户自行承担。</p>}
            settings={<Space direction="vertical" style={{width:'100%'}}>
            <Select aria-label="开发AI服务" value={aiProvider} onChange={v=>{setAiProvider(v);}} options={[{ value: 'deepseek', label: '已保存的 DeepSeek' }, { value: 'openai-codex', label: '已保存的 OpenAI Responses' }, { value: 'compatible', label: '自定义兼容接口' }]} style={{ width: 300 }} />
            {aiProvider === 'compatible' && <>
              <Input aria-label="兼容接口 Base URL" placeholder="https://example.com/v1" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
              <Select aria-label="兼容接口协议" value={protocol} onChange={setProtocol} options={[{ value: 'chat-completions', label: 'Chat Completions 兼容' }, { value: 'responses', label: 'Responses 兼容' }]} />
              <Input aria-label="兼容模型ID" placeholder="模型 ID" value={model} onChange={e => setModel(e.target.value)} />
              <Select aria-label="兼容接口Key来源" value={['deepseek', 'openai-codex'].includes(credentialId) ? credentialId : 'local'} onChange={id => { setCredentialId(id === 'local' ? '' : id); setKeyValue(''); }} options={[{ value: 'local', label: '本工程独立Key' }, { value: 'deepseek', label: '复用已保存的DeepSeek Key用于此接口' }, { value: 'openai-codex', label: '复用已保存的OpenAI Key用于此接口' }]} />
              {!['deepseek', 'openai-codex'].includes(credentialId) && <Input.Password aria-label="兼容服务 API Key" placeholder={credentialId ? 'Key 已保护保存；留空继续复用' : 'API Key，仅写入系统保护存储'} value={keyValue} onChange={e => setKeyValue(e.target.value)} autoComplete="off" />}
            </>}
            <Button disabled={busy || ai?.tasks?.some((t: any) => t.state === 'running')} onClick={() => void perform(async () => {
              let reference = credentialId;
              if (aiProvider === 'compatible' && keyValue) { localKeyId.current = 'local-' + crypto.randomUUID(); const saved = await api('credential.local.save', { id: localKeyId.current, revision: null, name: '本地工程 AI 服务', value: keyValue }); reference = saved.id; setCredentialId(reference); setKeyValue(''); }
              const connection = aiProvider === 'compatible' ? { provider: aiProvider, baseUrl, protocol, model, credentialId: reference } : { provider: aiProvider };
              setAi(await api('project.ai.save', { id: info.id, connection })); setNotice('开发服务已保存；尚未调用模型。');
            })}>保存开发服务</Button>{ai?.skill && <Tag>内置开发 Skill · {ai.skill.version}</Tag>}
            </Space>}/>
        </Card> }]} />
    </>}
  </section>;
}
