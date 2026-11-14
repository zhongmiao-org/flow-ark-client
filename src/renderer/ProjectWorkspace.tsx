import ProjectAiConversation from './ProjectAiConversation';
import DesktopAutomationPanel from './DesktopAutomationPanel';
import EntryResultView from './EntryResultView';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Alert, Button, Card, Select, Space, Tabs, Tag, Modal, Typography, Input, InputNumber, Checkbox } from 'antd';
import type { Step, Run } from '../shared/types';
import { compileGraph, emitGraph } from '../projects/graph';
import { buildDiagram } from './flow-diagram';
import DiagramCanvas from './DiagramCanvas';
import JsonTreeEditor from './JsonTreeEditor';
import ProjectSourceEditor, { type ProjectIssue } from './ProjectSourceEditor';
const api = (method: string, args: unknown = {}): Promise<any> => window.flowark.request(method, args);
type Info = { id: string; root: string; revision: string; metadata: { name: string }; entries: { id: string; name: string }[]; files: { path: string; size: number }[] };
export default function ProjectWorkspace({ back, configure, navigation, initialTask, initialProjectId, initialRunId, initialHandled }: { initialTask?: string; initialProjectId?:string; initialRunId?:string; initialHandled?:()=>void; back: () => void; configure: (detail: any) => void; navigation: MutableRefObject<((next: () => void) => void) | undefined> }) {
  const [info, setInfo] = useState<Info>(), [entryId, setEntryId] = useState(''), [selected, setSelected] = useState('');
  const [files, setFiles] = useState<Record<string, string>>({}), [edits, setEdits] = useState<Record<string, string>>({});
  const [desktopScope, setDesktopScope] = useState('');
  const [desktopBinding, setDesktopBinding] = useState<any>();
  const [conversationPrepared, setConversationPrepared] = useState<{ revision:string; instanceId:string; entryId:string }>();
  const [conversationRun, setConversationRun] = useState<Run>();
  const [conversationSubmitted, setConversationSubmitted] = useState(false);
  const [entry, setEntry] = useState<any>(), [file, setFile] = useState(''), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [conflict, setConflict] = useState(false), [pendingField, setPendingField] = useState(false);
  const [ai, setAi] = useState<any>(), [aiProvider, setAiProvider] = useState('deepseek'), [baseUrl, setBaseUrl] = useState('');
  const localAgentDevelopment = ai?.development?.mode === 'loopback-subagent';
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
  const conversationAssembled = !!info && (ai?.tasks??[]).some((t:any)=>t.authoring?.assembledRevision===info.revision);
  const conversationPreparedCurrent = !!info && conversationPrepared?.revision===info.revision;
  const conversationRequiresDesktop = useMemo(()=>{
    try { return JSON.parse(edits['flowark.project.json']??files['flowark.project.json']??'{}').entries?.find((e:any)=>e.id===conversationPrepared?.entryId)?.capabilities?.includes('desktop-automation-v1')===true; }
    catch { return true; }
  },[edits,files,conversationPrepared?.entryId]);
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
  useEffect(()=>{
    if(!initialProjectId)return;
    void perform(async()=>{
      const p=await api('project.get',{id:initialProjectId});setInfo(p);await load(p,p.entries[0]?.id??'');
      if(initialRunId){await api('project.ai.runEvidence',{id:p.id,runId:initialRunId});setTab('ai');}initialHandled?.();
    });
  },[initialProjectId,initialRunId]);
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
  useEffect(()=>{
    setConversationPrepared(undefined);setConversationSubmitted(false);
  },[info?.id,info?.revision]);
  useEffect(()=>{
    setConversationRun(undefined);
  },[info?.id]);
  useEffect(()=>{
    if(!info || !conversationRun || ['SUCCEEDED','FAILED','CANCELLED','INTERRUPTED'].includes(conversationRun.state))return;
    let live=true,reading=false;
    const refresh=async()=>{
      if(reading)return;reading=true;
      try {
        const detail=await api('project.run.status',{id:info.id,runId:conversationRun.id});
        if(!live)return;
        setConversationRun(detail.run);
        if(['SUCCEEDED','FAILED','CANCELLED','INTERRUPTED'].includes(detail.run.state)){
          await api('project.ai.runEvidence',{id:info.id,runId:detail.run.id});
          const next=await api('project.ai.get',{id:info.id});
          if(live)setAi(next);
        }
      } catch(e){if(live)setError(e instanceof Error?e.message:'运行状态暂不可读取，请核对原运行，不重复提交。');}
      finally{reading=false;}
    };
    void refresh();const timer=setInterval(()=>void refresh(),2000);
    return()=>{live=false;clearInterval(timer);};
  },[info?.id,conversationRun?.id,conversationRun?.state]);
  useEffect(() => {
    if (!info) return;
    let live = true;
    setDesktopScope(''); setDesktopBinding(undefined); setTask(initialTask ?? ''); if (initialTask||initialRunId) setTab('ai'); setKeyValue(''); setCredentialId(''); setBaseUrl(''); setModel('');
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
      <Tabs activeKey={tab} onChange={setTab} items={[{ key: 'desktop', label: '桌面窗口', children: <><p>先构建当前工程以固定实例身份，再绑定本次窗口。此操作不会运行流程。</p><Button disabled={busy || dirty || conflict || pendingField} onClick={() => void perform(async () => { const detail = await api('project.prepare', { id: info.id, revision: info.revision }); setDesktopScope(detail.instance.id); })}>准备桌面实例</Button>{tab === 'desktop' && desktopScope && <DesktopAutomationPanel key={desktopScope} scopeId={desktopScope} connection={ai?.connection} localAgentDevelopment={localAgentDevelopment} onBindingChange={setDesktopBinding} />}</> }, { key: 'blocks', label: '区块与参数', children: <div style={{ display: 'grid', gridTemplateColumns: 'minmax(350px, 1fr) minmax(320px, 1fr)', gap: 16 }}><Card title="流程编排">
        {projection.error ? <Alert type="error" message={projection.error} /> : <><Space wrap><Button disabled={busy} onClick={() => { const id = 'n_' + crypto.randomUUID().slice(0, 8); changeSteps([...projection.steps, { id, type: 'value', version: 1, name: '新数据步骤', value: null }]); setSelected(id); }}>新增数据步骤</Button>
          {(['上移', '下移', '移除'] as const).map((label, action) => <Button key={label} disabled={!selected || busy} onClick={() => { const steps = structuredClone(projection.steps); transform(steps, (list, i) => { if (action === 2) list.splice(i, 1); else { const j = i + (action === 0 ? -1 : 1); if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]]; } }); changeSteps(steps); if (action === 2) setSelected(''); }}>{label}</Button>)}</Space>
          <div style={{ height: 550 }}><DiagramCanvas nodes={diagram.nodes} edges={diagram.edges} selected={selected} select={setSelected} /></div></>}
      </Card><Card title={selected ? '区块绑定 · ' + selected : '选择区块编辑参数'}>{selected && <Space style={{ marginBottom: 12 }}><Button onClick={() => locateSource(entry.nodes, selected)}>定位节点源码</Button><Button onClick={() => locateSource(entry.graph, selected)}>定位编排源码</Button>{typeof projection.bindings[selected]?.script === 'string' && <Button onClick={() => locateSource(projection.bindings[selected].script)}>定位脚本</Button>}</Space>}{projection.bindings[selected] && <JsonTreeEditor key={selected} value={projection.bindings[selected]} disabled={busy} onPendingChange={setPendingField} rootLabel="区块绑定" change={next => { const steps = structuredClone(projection.steps); transform(steps, (list, i) => { list[i] = { ...list[i], ...(next as any).node }; }); changeSteps(steps, { ...projection.bindings, [selected]: next }); }} />}</Card></div> },
        { key: 'source', label: '源码与配置', children: <Card title="工程文件"><ProjectSourceEditor key={info.id} projectId={info.id} busy={busy} file={file} paths={info.files.filter(f => /\.(json|mmd|md|js|ts)$/.test(f.path) || f.path === '.env.example').map(f => f.path)} contents={files} edits={edits} choose={chooseFile} change={(path, content) => setEdits(old => { const next = { ...old }; if (content === files[path]) delete next[path]; else next[path] = content; return next; })} issues={issues} focusRequest={focusRequest} locateBlock={id => { setSelected(id); setTab('blocks'); }} /></Card> },
        { key: 'ai', label: 'AI 开发', children: <Card title="一起确认字段和流程节点">
          {initialTask && <Alert type="info" showIcon message="任务已进入流程开发对话" description="FlowArk 自动编写流程，你只需确认字段、步骤和外部操作。网页采用观察、鼠标和键盘操作，不调用站点 API；先试录 3 条，核验后再确认剩余范围。" style={{marginBottom:16}} />}
          <ProjectAiConversation tasks={ai?.tasks??[]} message={task} change={setTask} busy={busy||dirty||pendingField||conflict} ready={true} usage={ai?.usage} recovery={ai?.recovery}
            execution={conversationAssembled && <Card title="确认后试运行">
              <p>FlowArk 根据已确认的方案准备配置和权限，供你核对；随后按入口默认参数运行，不需要配置 RPA 节点。</p>
              <Space wrap><Button disabled={busy || dirty || conflict || pendingField || ai?.tasks?.some((t:any)=>t.state==='running') || conversationSubmitted && (!conversationRun || !['SUCCEEDED','FAILED','CANCELLED','INTERRUPTED'].includes(conversationRun.state))} onClick={()=>void perform(async()=>{
                const prepared=await api('project.prepareConversation',{id:info.id,revision:info.revision});
                if(!prepared.configured){setNotice('未确认试运行准备，尚未启动运行。');return;}
                setConversationPrepared({revision:prepared.revision,instanceId:prepared.instanceId,entryId:prepared.entryId});
                setConversationSubmitted(false);setConversationRun(undefined);setDesktopScope(prepared.instanceId);
                setDesktopBinding(await api('desktop.automation.state',{scopeId:prepared.instanceId}));
                setNotice('试运行配置已核对；请确认目标窗口，随后点击试运行。准备没有执行操作。');
              })}>核对试运行</Button>
              <Button type="primary" disabled={busy || dirty || conflict || pendingField || !conversationPreparedCurrent || conversationSubmitted || ai?.tasks?.some((t:any)=>t.state==='running') || conversationRequiresDesktop && (!desktopBinding || desktopBinding.scopeId!==conversationPrepared?.instanceId || desktopBinding.active || Date.now()>=desktopBinding.expiresAt)} onClick={()=>void perform(async()=>{
                if(!conversationPrepared || conversationPrepared.revision!==info.revision)throw Error('工程已变化，请重新核对试运行。');
                setConversationSubmitted(true);
                const outcome=await api('project.run.request',{id:info.id,entryId:conversationPrepared.entryId,requestId:crypto.randomUUID()});
                if(outcome.cancelled){setConversationSubmitted(false);setNotice('已取消本次运行核对，未创建运行。');return;}
                if(outcome.rejected){setConversationSubmitted(false);throw Error(outcome.message);}
                if(!outcome.id)throw Error('运行回执未确认，请先读取运行记录，不重复提交。');
                setConversationRun(outcome);setNotice('运行已登记；以下展示实际状态，完成结果将回到当前对话。');
                if(['SUCCEEDED','FAILED','CANCELLED','INTERRUPTED'].includes(outcome.state)){
                  await api('project.ai.runEvidence',{id:info.id,runId:outcome.id});setAi(await api('project.ai.get',{id:info.id}));
                }
              })}>试运行</Button>
              {conversationRun && !['SUCCEEDED','FAILED','CANCELLED','INTERRUPTED'].includes(conversationRun.state) && <Button disabled={busy} onClick={()=>void perform(async()=>{await api('project.run.control',{id:info.id,runId:conversationRun.id,action:'cancel'});setNotice('已提交停止请求，是否停止以实际运行状态为准。');})}>停止试运行</Button>}</Space>
              {conversationSubmitted && !conversationRun && !busy && <Alert type="warning" showIcon message="运行回执尚未确认" description="请先核对本工程运行记录；本次不自动重试或重复提交。" />}
              {conversationRun && <div aria-label="对话试运行结果"><p>本次运行：{conversationRun.name} · {conversationRun.state}</p>{conversationRun.error && <Alert type="error" showIcon message="试运行未完成" description={conversationRun.error} />}<EntryResultView run={conversationRun} /></div>}
            </Card>}
            send={(current,answer,intent)=>void perform(async()=>{
              const text=answer??task;
              if(current) await api('project.ai.resume',{id:info.id,taskId:current.id,answer:text,intent});
              else await api('project.ai.start',{id:info.id,task:text,intent});
              setTask('');setAi(await api('project.ai.get',{id:info.id}));
            })}
            review={(current,operation,nodes)=>void perform(async()=>{await api('project.ai.review',{id:info.id,taskId:current.id,reviewStamp:current.review.stamp,operation,nodes});setAi(await api('project.ai.get',{id:info.id}));if(operation==='assemble')await reload();})}
            detail={current=>void perform(async()=>{const detail=await api('project.ai.detail',{id:info.id,taskId:current.id});Modal.info({title:'开发步骤与结果（只读）',width:960,content:<pre tabIndex={0} style={{maxHeight:520,overflow:'auto',whiteSpace:'pre-wrap',userSelect:'text'}}>{JSON.stringify(detail,null,2)}</pre>});})}
            cancel={current=>void perform(async()=>{await api('project.ai.cancel',{id:info.id,taskId:current.id});setAi(await api('project.ai.get',{id:info.id}));})}
            evidence={<Space direction="vertical" style={{width:'100%'}}>
              <Space wrap><Button disabled={busy || dirty || conflict || pendingField} onClick={()=>void perform(async()=>{
                const detail=await api('project.prepare',{id:info.id,revision:info.revision});
                setDesktopScope(detail.instance.id);setDesktopBinding(await api('desktop.automation.state',{scopeId:detail.instance.id}));
                setNotice('请选择本次操作窗口；准备实例和选择窗口不会运行流程。');
              })}>选择操作窗口</Button>
              <Button disabled={busy || !desktopScope || !desktopBinding || desktopBinding.active || Date.now() >= desktopBinding.expiresAt} onClick={()=>void perform(async()=>{
                await api('project.ai.observeWindow',{id:info.id,screenshot:desktopBinding.screenshotAllowed===true});
                setAi(await api('project.ai.get',{id:info.id}));
                setNotice('已只读观察所选窗口，未点击或输入；提交回答后才发送证据给当前模型。');
              })}>读取所选窗口并准备AI证据</Button></Space>
              {tab === 'ai' && desktopScope && <DesktopAutomationPanel key={desktopScope} scopeId={desktopScope} connection={ai?.connection} localAgentDevelopment={localAgentDevelopment} onBindingChange={setDesktopBinding} />}
              {ai?.evidence?.window && <div aria-label="目标窗口只读证据"><p>目标来源：{ai.evidence.window.observation?.application} · {ai.evidence.window.observation?.title || '无标题窗口'} · {new Date(ai.evidence.window.capturedAt).toLocaleString()}</p><p>{ai.evidence.window.screenshotIncluded ? '包含已授权的窗口截图和可访问内容。' : '仅包含窗口可访问内容，未读取截图。'}此证据用于讨论字段和步骤，执行时仍需重新观察。</p>{desktopBinding && ai.evidence.window.bindingId !== desktopBinding.bindingId && <p role="status">窗口绑定已变化，请重新读取当前所选窗口。</p>}</div>}
              <Space wrap><Button disabled={busy} onClick={()=>void perform(async()=>{const selected=await api('project.ai.chooseWorkbook',{id:info.id});if(selected){setAi(await api('project.ai.get',{id:info.id}));setNotice('只读表头已准备；提交回答后才发送给AI，不含客户数据行。');}})}>选择 Excel 并读取表头</Button>
              <Button disabled={busy} onClick={()=>void perform(async()=>{const h=await api('project.run.history',{id:info.id});setEvidenceRuns(h.runs);})}>选择运行结果用于排错</Button></Space>
              {ai?.evidence?.workbook&&<><p>Excel 来源（只读表头与统计）：{ai.evidence.workbook.name} · {ai.evidence.workbook.rowCount} 行 · 源表头：{ai.evidence.workbook.headers.map((h:any)=>h.header||'（Excel 无表头）').join('、')}</p><p>此处仅为 Excel 来源证据。目标网页表头需单独读取核对，不按列数推断映射。</p></>}
              {!!evidenceRuns.length&&<Space wrap><Select aria-label="用于排错的运行" style={{width:360}} value={evidenceRun||undefined} onChange={setEvidenceRun} options={evidenceRuns.map(r=>({value:r.id,label:new Date(r.createdAt).toLocaleString()+' · '+r.state+' · '+r.name}))}/><Button disabled={!evidenceRun||busy} onClick={()=>void perform(async()=>{await api('project.ai.runEvidence',{id:info.id,runId:evidenceRun});setAi(await api('project.ai.get',{id:info.id}));setNotice('运行身份、节点状态、错误和动作状态已关联，不包含完整业务输出；提交回答后才调用AI。');})}>关联所选运行</Button></Space>}
              {ai?.evidence?.run&&<p>已选历史运行 · {ai.evidence.run.state} · {ai.evidence.run.recovery?.title??'历史证据已关联，业务结果仍须核对'}</p>}
            </Space>}
            cost={<p>{localAgentDevelopment ? '本次由本机子 agent 提供模型响应，不读取或调用你的 API Key；模拟生成与真实业务验收分别记录。' : 'API Key 产生的费用由用户自行承担。'}</p>}
            settings={<Space direction="vertical" style={{width:'100%'}}>
            <p>平台 Skill 随客户端提供；描述需求后自动匹配。平台不明确时会追问，可在对话中纠正。</p>
            <p>{ai?.platformSkill?`${ai.platformSkill.id} · ${ai.platformSkill.version} · SHA-256 ${ai.platformSkill.sha256}`:'尚未匹配平台 Skill'}</p>
            <p>固定正文用于生成与独立复核；更换后重新核对方案。个人运行 Skill 独立保留。</p>
            {localAgentDevelopment ? <Alert type="info" showIcon message="本机子 agent 开发模式" description="仅允许显式端口的本机接口，不访问真实凭据，不回退外部供应商。保存服务不会调用模型。" /> : <Select aria-label="开发AI服务" value={aiProvider} onChange={v=>{setAiProvider(v);}} options={[{ value: 'deepseek', label: '已保存的 DeepSeek' }, { value: 'openai-codex', label: '已保存的 OpenAI Responses' }, { value: 'compatible', label: '自定义兼容接口' }]} style={{ width: 300 }} />}
            {(aiProvider === 'compatible' || localAgentDevelopment) && <>
              <Input aria-label="兼容接口 Base URL" placeholder="https://example.com/v1" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
              <Select aria-label="兼容接口协议" value={protocol} onChange={setProtocol} options={[{ value: 'chat-completions', label: 'Chat Completions 兼容' }, { value: 'responses', label: 'Responses 兼容' }]} />
              <Input aria-label="兼容模型ID" placeholder="模型 ID" value={model} onChange={e => setModel(e.target.value)} />
              {!localAgentDevelopment && <><Select aria-label="兼容接口Key来源" value={['deepseek', 'openai-codex'].includes(credentialId) ? credentialId : 'local'} onChange={id => { setCredentialId(id === 'local' ? '' : id); setKeyValue(''); }} options={[{ value: 'local', label: '本工程独立Key' }, { value: 'deepseek', label: '复用已保存的DeepSeek Key用于此接口' }, { value: 'openai-codex', label: '复用已保存的OpenAI Key用于此接口' }]} />
              {!['deepseek', 'openai-codex'].includes(credentialId) && <Input.Password aria-label="兼容服务 API Key" placeholder={credentialId ? 'Key 已保护保存；留空继续复用' : 'API Key，仅写入系统保护存储'} value={keyValue} onChange={e => setKeyValue(e.target.value)} autoComplete="off" />}</>}
            </>}
            <Button disabled={busy || ai?.tasks?.some((t: any) => t.state === 'running')} onClick={() => void perform(async () => {
              let reference = localAgentDevelopment ? localKeyId.current : credentialId;
              if (!localAgentDevelopment && aiProvider === 'compatible' && keyValue) { localKeyId.current = 'local-' + crypto.randomUUID(); const saved = await api('credential.local.save', { id: localKeyId.current, revision: null, name: '本地工程 AI 服务', value: keyValue }); reference = saved.id; setCredentialId(reference); setKeyValue(''); }
              const connection = aiProvider === 'compatible' || localAgentDevelopment ? { provider: 'compatible', baseUrl, protocol, model, credentialId: reference } : { provider: aiProvider };
              setAi(await api('project.ai.save', { id: info.id, connection })); setNotice('开发服务已保存；尚未调用模型。');
            })}>保存开发服务</Button>{ai?.skill && <Tag>内置开发 Skill · {ai.skill.version}</Tag>}
            </Space>}/>
        </Card> }]} />
    </>}
  </section>;
}
