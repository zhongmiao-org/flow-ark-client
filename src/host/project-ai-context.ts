import { digest } from '../shared/utils';
export function updatesActiveDraft(active: string | undefined, tool: string, draftId: string) {
  return tool !== 'flowark_authoring_get' || !active || active === draftId;
}
/** Lossless audit stays in Store. This is an explicit, deterministic model-context projection. */
export function projectAIContext(history: { kind: string; value: unknown }[]) {
  const documents: Record<string, unknown> = {}, schemaDefinitions: Record<string, unknown> = {};
  const currentDrafts: Record<string, any> = {};
  let referenceDraft: any;
  for(const item of history){const v=item.value as any;if(item.kind==='tool'&&v?.name?.startsWith('flowark_authoring_')&&v.result?.plan){
    if(updatesActiveDraft(Object.keys(currentDrafts)[0],v.name,v.result.draftId)){for(const id of Object.keys(currentDrafts))delete currentDrafts[id];currentDrafts[v.result.draftId]=v.result;}
    else referenceDraft=v.result;
  }}
  const lastPlan = [...history].reverse().find(item => item.kind === 'model' && (item.value as any)?.action?.tool === 'flowark_authoring_plan')?.value as any;
  const candidatePlan = lastPlan?.action?.arguments?.plan;
  const candidates = new Map<string, { source: string; sha256: string }>();
  let lastAction: any;
  for(const item of history){const v=item.value as any;if(item.kind==='model')lastAction=v?.action;
    if(item.kind==='tool'&&v?.name==='flowark_authoring_get'&&typeof v.result?.source==='string'){
      const args=lastAction?.arguments,key=v.result.draftId+'/'+args?.entryId+'/'+args?.nodeId;
      candidates.delete(key);candidates.set(key,{source:v.result.source,sha256:digest(v.result.source)});
    }
  }
  for(const item of history){const value=item.value as any,action=value?.action;if(item.kind!=='model'||action?.action!=='tool')continue;const args=action.arguments;
    if(action.tool==='flowark_authoring_code'&&typeof args?.source==='string'){const key=args.draftId+'/'+args.entryId+'/'+args.nodeId;candidates.delete(key);candidates.set(key,{source:args.source,sha256:digest(args.source)});}
    if(action.tool==='flowark_project_write'&&Array.isArray(args?.changes))for(const change of args.changes)if(typeof change?.content==='string'){const key='legacy-source/'+change.path;candidates.delete(key);candidates.set(key,{source:change.content,sha256:digest(change.content)});}
  }
  const candidateSources: Record<string, unknown> = {}; let bytes=0;
  for(const [key,value]of [...candidates].reverse()){const size=Buffer.byteLength(value.source);if(bytes+size<=64*1024){candidateSources[key]=value;bytes+=size;}else candidateSources[key]={sha256:value.sha256,bytes:size,notIncluded:'历史代码保留在审计/草稿中；通过authoring_get按区块读取'};}

  const projected = history.map(item => {
    if(item.kind==='model'){
      const value=structuredClone(item.value) as any,action=value?.action,args=action?.arguments;
      if(action?.tool==='flowark_authoring_plan'&&args?.plan)args.plan={sha256:digest(args.plan),note:'历史规划正文保留审计；最新候选见candidatePlan，当前有效草稿见currentDrafts'};
      if(action?.tool==='flowark_authoring_code'&&typeof args?.source==='string')args.source={candidateSource:args.draftId+'/'+args.entryId+'/'+args.nodeId,sha256:digest(args.source)};
      if(action?.tool==='flowark_project_write'&&Array.isArray(args?.changes))for(const change of args.changes)if(typeof change?.content==='string')change.content={candidateSource:'legacy-source/'+change.path,sha256:digest(change.content)};
      return {kind:item.kind,value};
    }
    if (item.kind !== 'tool' && item.kind !== 'initial-project-context') return item;
    const value = structuredClone(item.value) as any;
    if(value?.name?.startsWith('flowark_authoring_')&&value.result?.plan){const r=value.result;value.result={...r,plan:currentDrafts[r.draftId]?{currentDraft:r.draftId}:referenceDraft?.draftId===r.draftId?{referenceDraft:r.draftId}:{historicalDraft:r.draftId},scripts:undefined,source:undefined,historicalRevision:r.draftRevision!==currentDrafts[r.draftId]?.draftRevision,note:'当前规划见currentDrafts，历史正文保留审计，按草稿及区块读取。'};}
    // Node schemas share recursive Node/Value definitions; send each exact definition once.
    if (value?.name === 'flowark_node_schema' && value.result?.dependencyDefinitions) {
      value.result.dependencyDefinitions = Object.fromEntries(Object.entries(value.result.dependencyDefinitions).map(([name, definition]) => {
        const ref = digest(definition); schemaDefinitions[ref] = definition; return [name, { contextDefinition: ref }];
      }));
    }
    const id = digest(value); documents[id] ??= value;
    return { kind: item.kind, value: { document: id } };
  });
  return { candidateSources, candidatePlan, currentDrafts, referenceDraft, policy: '完整审计单独保留；documents按内容摘要复用工具结果，schemaDefinitions按摘要提供原始共享定义；contextDefinition为模型上下文引用，不是工程JSON语法。candidateSources仅携带各区块最新候选并明确列出未发送正文的代码，旧版本通过审计/草稿读取；没有删除或改写完整历史。', history: projected, documents, schemaDefinitions };
}
