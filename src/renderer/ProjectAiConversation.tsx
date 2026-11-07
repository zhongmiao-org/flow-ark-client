import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Button, Card, Checkbox, Collapse, Input, Radio, Space, Tag } from 'antd';
import MarkdownBody from './MarkdownBody';
import AuthoringPlanSummary from './AuthoringPlanSummary';
import { emitGraph } from '../projects/graph';

export default function ProjectAiConversation({ tasks, message, change, send, review, detail, cancel, busy, ready, settings, cost }: {
  tasks: any[]; message: string; change: (text: string) => void; send: (current?: any, answer?: string) => void;
  review: (task: any, operation: 'generate' | 'assemble' | 'pause', nodes: string[]) => void;
  detail: (task: any) => void; cancel: (task: any) => void; busy: boolean; ready: boolean; settings: ReactNode; cost: ReactNode;
}) {
  const ordered=useMemo(()=>[...tasks].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)),[tasks]);
  const current=ordered.find(t=>t.assisted),scripts=current?.authoring?.scripts??[];
  const [selected,setSelected]=useState<string[]>([]);
  const [choice,setChoice]=useState('');
  useEffect(()=>{setSelected(scripts.filter((s:any)=>!s.ready).slice(0,1).map((s:any)=>s.entryId+'/'+s.nodeId));},[current?.review?.stamp]);
  const diagrams=useMemo(()=>{try{return (current?.authoring?.plan?.entries??[]).map((e:any)=>({id:e.id,name:e.name,source:emitGraph(e.steps).mermaid}));}catch{return [];}},[current?.authoring?.plan]);
  const running=tasks.some(t=>t.state==='running');
  const options=useMemo(()=>{
    if(current?.review){
      const result:any[]=[];
      if(!scripts.some((s:any)=>!s.ready))result.push({id:'assemble',operation:'assemble',label:'确认节点，组装并检查',description:'在本机组装和静态检查，不调用模型，也不运行流程。',recommended:true});
      if(scripts.length&&!current.authoring.assembledRevision)result.push({id:'generate',operation:'generate',label:current.paidRetryRequired?'重试生成所选节点':'按当前方案生成所选节点',description:'仅生成你勾选的节点；本批完成或检查失败后停止。会使用已核对的模型预算。',recommended:result.length===0});
      result.push({id:'revise',operation:'revise',label:'调整字段或节点',description:'在下方写明改动，AI先更新方案，重新确认后才生成。'});
      result.push({id:'pause',operation:'pause',label:'先保留方案，稍后继续',description:'保留当前草稿和对话，不调用模型，不运行。'});
      return result;
    }
    if(current?.choices?.length>=3)return current.choices;
    return current?[{id:'continue',label:'继续完善当前方案',description:'沿用已确认事实，补齐当前步骤。',recommended:true},{id:'revise',label:'修改字段或节点',description:'结合下方自定义输入重新讨论方案。'},{id:'explain',label:'先说明方案再决定',description:'解释字段来源和步骤作用，暂不生成代码。'}]:[{id:'new',label:'从需求规划流程',description:'先明确输入、目标和完成条件。',recommended:true},{id:'existing',label:'修改当前工程',description:'保留已有节点和资料，只讨论需要改变的部分。'},{id:'understand',label:'先了解字段和节点',description:'先解释方案与选择，再决定如何实现。'}];
  },[current,scripts]);
  useEffect(()=>{setChoice(options.find((o:any)=>o.recommended)?.id??options[0]?.id??'');},[current?.id,current?.state,current?.review?.stamp]);
  const chosen=options.find((o:any)=>o.id===choice),custom=message.trim();
  const local=!!current?.review&&!custom&&['assemble','pause'].includes(chosen?.operation);
  const blocked=busy||running||!chosen||(!local&&!ready)||(!current&&!custom)||(chosen?.operation==='revise'&&!custom)||(!custom&&chosen?.operation==='generate'&&!selected.length);
  const submit=()=>{
    if(!chosen)return;
    if(current?.review&&!custom&&['generate','assemble','pause'].includes(chosen.operation)){review(current,chosen.operation,selected);return;}
    send(current,'选择：'+chosen.label+'。'+chosen.description+(custom?'\n自定义修正（优先）：'+custom+'\n先核对修正内容，不批准旧方案的代码生成或组装。':''));
  };
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
        <p>组装与静态检查在本机完成，不调用模型。运行、资源和外发另行核对。</p>
      </>}
    </Card>}
    <Card size="small" title="请选择下一步，也可以自定义修正">
      <Radio.Group aria-label="方案选项" value={choice} onChange={e=>setChoice(e.target.value)} style={{width:'100%'}} disabled={busy||running}>
        <Space direction="vertical" style={{width:'100%'}}>{options.map((o:any)=><Radio key={o.id} value={o.id} style={{padding:'8px 0',whiteSpace:'normal'}}><Space direction="vertical" size={2}><strong>{o.label}{o.recommended?'（推荐）':''}</strong><span>{o.description}</span></Space></Radio>)}</Space>
      </Radio.Group>
      <p>预选不等于提交。填写自定义内容会先讨论修正，不执行旧方案。</p>
      <Input.TextArea aria-label="自定义回答或修正" rows={3} value={message} onChange={e=>change(e.target.value)} placeholder="例如：联系电话对应手机号列；后两列不写入。也可以提出其他方案。"/>
    </Card>
    {cost}
    <Space><Button type="primary" disabled={blocked} onClick={submit}>{local?'提交选择（不调用模型）':current?.paidRetryRequired?'确认费用并提交重试':'提交回答'}</Button>{running&&<Button disabled={busy} onClick={()=>cancel(tasks.find(t=>t.state==='running'))}>停止本次回复</Button>}</Space>
    <Collapse items={[{key:'settings',label:'AI 服务与本批预算',children:settings},{key:'history',label:`历史与详细审计 · ${ordered.length} 批（全部保留）`,children:<Space direction="vertical" style={{width:'100%'}}>{ordered.map(t=><Card size="small" key={t.id} title={new Date(t.at).toLocaleString()}><p>{t.message}</p><p>{t.requests}/{t.maxRequests} 次请求</p><Button onClick={()=>detail(t)}>查看完整开发记录</Button></Card>)}</Space>}]}/>
  </Space>;
}
