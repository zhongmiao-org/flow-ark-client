import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Button, Card, Checkbox, Collapse, Input, Space, Tag } from 'antd';
import MarkdownBody from './MarkdownBody';
import AuthoringPlanSummary from './AuthoringPlanSummary';
import { emitGraph } from '../projects/graph';

export default function ProjectAiConversation({ tasks, message, change, send, review, detail, cancel, busy, ready, settings, cost }: {
  tasks: any[]; message: string; change: (text: string) => void; send: (current?: any) => void;
  review: (task: any, operation: 'generate' | 'assemble', nodes: string[]) => void;
  detail: (task: any) => void; cancel: (task: any) => void; busy: boolean; ready: boolean; settings: ReactNode; cost: ReactNode;
}) {
  const ordered=useMemo(()=>[...tasks].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)),[tasks]);
  const current=ordered.find(t=>t.assisted),scripts=current?.authoring?.scripts??[];
  const [selected,setSelected]=useState<string[]>([]);
  useEffect(()=>{setSelected(scripts.filter((s:any)=>!s.ready).slice(0,1).map((s:any)=>s.entryId+'/'+s.nodeId));},[current?.review?.stamp]);
  const diagrams=useMemo(()=>{try{return (current?.authoring?.plan?.entries??[]).map((e:any)=>({id:e.id,name:e.name,source:emitGraph(e.steps).mermaid}));}catch{return [];}},[current?.authoring?.plan]);
  const running=tasks.some(t=>t.state==='running');
  return <Space direction="vertical" style={{width:'100%'}} size="middle">
    <p>先一起确认字段和步骤，再生成你选择的节点。可以直接说“这个字段对应手机号”“先不要发送”，不必填写代码或工具指令。</p>
    <div className="task-plan-conversation" aria-label="工程开发对话" aria-live="polite">
      {!current&&<article className="ai-step-assistant"><h3>FlowArk</h3><p>描述要处理的文件、目标和完成条件。我会先给你看方案，等你确认。</p></article>}
      {(current?.dialogue??[]).map((item:any,index:number)=><article key={index} className={item.role==='user'?'ai-step-user':'ai-step-assistant'}><h3>{item.role==='user'?'你':'FlowArk'}</h3><MarkdownBody text={item.text}/></article>)}
    </div>
    {current&&<Alert type={current.state==='failed'?'error':current.review?'info':current.state==='complete'?'success':'info'} message={current.message.startsWith('AI 输出JSON无效')?'本次回复未通过格式检查，尚未采用；可以补充说明后再试。':current.message} description={<span>本批 {current.requests}/{current.maxRequests} 次请求 · {running?'正在处理':'已停下，等待你的下一步'}</span>}/>}
    {current?.diagnostics?.length>0&&<Collapse items={[{key:'diagnostics',label:'有节点需要调整 · 查看检查问题',children:<ul>{current.diagnostics.map((d:any,i:number)=><li key={i}>{[d.file,d.entryId,d.nodeId].filter(Boolean).join(' · ')}：{d.message}</li>)}</ul>}]}/>}
    {current?.authoring?.plan&&<Card title={current.review?.kind==='nodes'?'节点检查结果':'待确认的字段与节点方案'}>
      <AuthoringPlanSummary value={current.authoring}/>
      {current.authoring.plan.entries.map((e:any)=>{const fields=Object.entries(e.inputSchema?.properties??{});return fields.length?<section key={e.id} aria-label={e.name+'输入字段'}><h4>{e.name} · 输入字段</h4><ul>{fields.map(([key,raw])=>{const f=raw as any;return <li key={key}><strong>{f.title??key}</strong>：{f.description??f.type??'请确认用途'}{e.inputSchema.required?.includes(key)?'（必填）':''}</li>;})}</ul></section>:null;})}
      {diagrams.map((d:any)=><section key={d.id} aria-label={d.name+'流程预览'}><h4>{d.name}</h4><MarkdownBody text={'```mermaid\n'+d.source+'```'}/></section>)}
      <p>流程图只展示方案，不会自动修改文件或执行操作。字段或步骤不对时，在下方直接说明。</p>
      {current.review&&<>
        {scripts.length>0&&<Checkbox.Group value={selected} onChange={v=>setSelected(v as string[])}><Space direction="vertical">{scripts.map((s:any)=><Checkbox key={s.entryId+'/'+s.nodeId} value={s.entryId+'/'+s.nodeId}>{s.purpose||s.nodeId} <Tag>{s.ready?'已有代码，可选择修改':'待生成'}</Tag></Checkbox>)}</Space></Checkbox.Group>}
        <Space wrap style={{marginTop:16}}>
          <Button type="primary" disabled={busy||running||!ready||!selected.length||!!current.authoring.assembledRevision} onClick={()=>review(current,'generate',selected)}>确认方案并生成所选节点</Button>
          <Button disabled={busy||running||scripts.some((s:any)=>!s.ready)} onClick={()=>review(current,'assemble',[])}>确认节点，组装并检查</Button>
        </Space>
        <p>组装与静态检查在本机完成，不调用模型。运行、资源和外发另行核对。</p>
      </>}
    </Card>}
    <Input.TextArea aria-label="回复或修改工程方案" rows={3} value={message} onChange={e=>change(e.target.value)} placeholder="例如：联系电话对应手机号列；后两列不写入。请先展示字段映射和节点图。"/>
    {cost}
    <Space><Button type="primary" disabled={busy||running||!ready||!message.trim()} onClick={()=>send(current)}>{current?'发送补充或修改':'发送需求，讨论方案'}</Button>{running&&<Button disabled={busy} onClick={()=>cancel(tasks.find(t=>t.state==='running'))}>停止本次回复</Button>}</Space>
    <Collapse items={[{key:'settings',label:'AI 服务与本批预算',children:settings},{key:'history',label:`历史与详细审计 · ${ordered.length} 批（全部保留）`,children:<Space direction="vertical" style={{width:'100%'}}>{ordered.map(t=><Card size="small" key={t.id} title={new Date(t.at).toLocaleString()}><p>{t.message}</p><p>{t.requests}/{t.maxRequests} 次请求</p><Button onClick={()=>detail(t)}>查看完整开发记录</Button></Card>)}</Space>}]}/>
  </Space>;
}
