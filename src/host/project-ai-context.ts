import { digest } from '../shared/utils';
export function updatesActiveDraft(active: string | undefined, tool: string, draftId: string) {
  return tool !== 'flowark_authoring_get' || !active || active === draftId;
}
/** Lossless audit stays in Store. This is an explicit, deterministic model-context projection. */
export function projectAIContext(history: { kind: string; value: unknown }[]) {
  const documents: Record<string, unknown> = {}, schemaDefinitions: Record<string, unknown> = {};
  const currentDrafts: Record<string, any> = {};
  let referenceDraft: any,activeUpdate=-1;
  const draftView=(value:any)=>{const {source,...state}=value;return state;};
  for(const [index,item] of history.entries()){const v=item.value as any;
    if(item.kind==='initial-project-context'||item.kind==='tool'&&v?.name==='flowark_project_context'){
      const current=Object.values(currentDrafts)[0],r=v?.result;
      if(r?.currentAuthoring&&(!current||current.projectRevision!==r.revision&&current.assembledRevision!==r.revision)){
        for(const id of Object.keys(currentDrafts))delete currentDrafts[id];currentDrafts[r.currentAuthoring.draftId]=draftView(r.currentAuthoring);activeUpdate=index;
      }
    }
    if(item.kind==='tool'&&v?.name?.startsWith('flowark_authoring_')&&v.result?.plan){
    if(updatesActiveDraft(Object.keys(currentDrafts)[0],v.name,v.result.draftId)){for(const id of Object.keys(currentDrafts))delete currentDrafts[id];currentDrafts[v.result.draftId]=draftView(v.result);activeUpdate=index;}
    else referenceDraft={draftId:v.result.draftId,draftRevision:v.result.draftRevision,projectRevision:v.result.projectRevision,summary:v.result.summary,planDigest:digest(v.result.plan),note:'历史参考正文保留审计，按草稿读取；当前规划见currentDrafts'};
  }}
  const lastPlanIndex=history.findLastIndex(item=>item.kind==='model'&&(item.value as any)?.action?.tool==='flowark_authoring_plan');
  const candidatePlan=lastPlanIndex>activeUpdate?(history[lastPlanIndex].value as any)?.action?.arguments?.plan:undefined;
  const candidates = new Map<string, { source: string; sha256: string }>();
  let lastAction: any,lastSourceKey:string|undefined;
  for(const item of history){const v=item.value as any;
    if(item.kind==='model'){
      lastAction=v?.action;const action=lastAction,args=action?.arguments;
      if(action?.action==='tool'&&action.tool==='flowark_authoring_code'&&typeof args?.source==='string'){const key=args.draftId+'/'+args.entryId+'/'+args.nodeId;candidates.delete(key);candidates.set(key,{source:args.source,sha256:digest(args.source)});}
      if(action?.action==='tool'&&action.tool==='flowark_project_write'&&Array.isArray(args?.changes))for(const change of args.changes)if(typeof change?.content==='string'){const key='legacy-source/'+change.path;candidates.delete(key);candidates.set(key,{source:change.content,sha256:digest(change.content)});}
    }
    if(item.kind==='tool'&&v?.name==='flowark_authoring_get'&&typeof v.result?.source==='string'){
      const args=lastAction?.arguments,key=v.result.draftId+'/'+args?.entryId+'/'+args?.nodeId;
      lastSourceKey=key;candidates.delete(key);candidates.set(key,{source:v.result.source,sha256:digest(v.result.source)});
    }
  }
  const activeId=Object.keys(currentDrafts)[0];
  const candidateSources: Record<string, unknown> = {}; let bytes=0;
  for(const [key,value]of [...candidates].reverse()){const size=Buffer.byteLength(value.source);if((key===lastSourceKey||(activeId?key.startsWith(activeId+'/'):key.startsWith('legacy-source/')))&&bytes+size<=64*1024){candidateSources[key]=value;bytes+=size;}else candidateSources[key]={sha256:value.sha256,bytes:size,notIncluded:'历史代码保留在审计/草稿中；通过authoring_get按区块读取'};}

  const latestInitial=history.findLastIndex(h=>h.kind==='initial-project-context'||h.kind==='tool'&&(h.value as any)?.name==='flowark_project_context');
  const latestPatch=history.findLastIndex(h=>h.kind==='model'&&(h.value as any)?.action?.tool==='flowark_authoring_code_patch');
  const latestRecovery=history.findLastIndex(h=>h.kind==='project-recovery');
  const latestSelected=history.findLastIndex(h=>h.kind==='user-selected-evidence');
  const projected = history.map((item,index) => {
    if((item.kind==='initial-project-context'||item.kind==='tool'&&(item.value as any)?.name==='flowark_project_context')&&index!==latestInitial||item.kind==='project-recovery'&&index!==latestRecovery||item.kind==='user-selected-evidence'&&index!==latestSelected)return {kind:item.kind,value:{historicalDigest:digest(item.value),notIncluded:'历史现场/工程正文保留完整审计；模型使用本轮最新工程和现场证据，不重复旧快照。'}};

    if(item.kind==='model'){
      const value=structuredClone(item.value) as any,action=value?.action,args=action?.arguments;
      if(action?.tool==='flowark_authoring_plan'&&args?.plan)args.plan={sha256:digest(args.plan),note:'历史规划正文保留审计；最新候选见candidatePlan，当前有效草稿见currentDrafts'};
      if(action?.tool==='flowark_authoring_code'&&typeof args?.source==='string')args.source={candidateSource:args.draftId+'/'+args.entryId+'/'+args.nodeId,sha256:digest(args.source)};
      if(action?.tool==='flowark_authoring_code_patch'&&args?.patch&&(index!==latestPatch||args.draftId!==activeId))args.patch={baseSourceSha256:args.patch.baseSourceSha256,edits:args.patch.edits?.map((e:any)=>({oldDigest:digest(e.oldText),newDigest:digest(e.newText)})),note:'历史补丁正文保留审计；读取当前节点源码生成下一补丁'};
      if(action?.tool==='flowark_project_write'&&Array.isArray(args?.changes))for(const change of args.changes)if(typeof change?.content==='string')change.content={candidateSource:'legacy-source/'+change.path,sha256:digest(change.content)};
      return {kind:item.kind,value};
    }
    if (item.kind !== 'tool' && item.kind !== 'initial-project-context') return item;
    const value = structuredClone(item.value) as any;
    if(value?.name?.startsWith('flowark_authoring_')&&value.result?.plan){const r=value.result;value.result={...r,plan:currentDrafts[r.draftId]?{currentDraft:r.draftId}:referenceDraft?.draftId===r.draftId?{referenceDraft:r.draftId}:{historicalDraft:r.draftId},scripts:undefined,source:typeof r.source==='string'?{candidateSource:Object.keys(candidateSources).find(k=>k.startsWith(r.draftId+'/')&&(candidateSources[k] as any).source===r.source),sha256:digest(r.source),note:'源码正文只在context.candidateSources对应键的source中提供一次；按该准确原文生成补丁，不重复get。'}:undefined,historicalRevision:r.draftRevision!==currentDrafts[r.draftId]?.draftRevision,note:'当前规划见currentDrafts，历史正文保留审计，按草稿及区块读取。'};}
    if(value?.name==='flowark_project_context'&&value?.result?.currentAuthoring){const r=value.result.currentAuthoring;value.result.currentAuthoring={draftId:r.draftId,draftRevision:r.draftRevision,assembledRevision:r.assembledRevision,note:'当前活动状态见currentDrafts，公开源码已在同一工程上下文提供。'};}
    // Node schemas share recursive Node/Value definitions; send each exact definition once.
    if (value?.name === 'flowark_node_schema' && value.result?.dependencyDefinitions) {
      value.result.dependencyDefinitions = Object.fromEntries(Object.entries(value.result.dependencyDefinitions).map(([name, definition]) => {
        const ref = digest(definition); schemaDefinitions[ref] = definition; return [name, { contextDefinition: ref }];
      }));
    }
    const id = digest(value); documents[id] ??= value;
    return { kind: item.kind, value: { document: id } };
  });
  return { candidateSources, candidatePlan, currentDrafts, referenceDraft, policy: '完整审计单独保留；documents按内容摘要复用工具结果，schemaDefinitions按摘要提供原始共享定义；contextDefinition为模型上下文引用，不是工程JSON语法。candidateSources携带当前活动草稿最新源码及最近一次明确读取的参考源码各一次，草稿状态与历史参考不重复嵌入源码；历史候选仅保留摘要并明确列出未发送正文的代码，旧版本通过审计/草稿读取；没有删除或改写完整历史。', history: projected, documents, schemaDefinitions };
}
