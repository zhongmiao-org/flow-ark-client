import { constants as fsConstants } from 'node:fs';
import { mkdir, lstat, open, writeFile, link, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { checkProjectScripts } from './script-check';
import { z } from 'zod';
import { projectRoot, localDirectory, snapshotProject, updateProjectFiles } from './project';
import { ProjectDiagnostic } from './configuration';
import { validateFlow } from '../core/validate';
import { emitGraph } from './graph';
import { digest } from '../shared/utils';
import type { Step } from '../shared/types';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), schema = z.record(z.string(), z.unknown());
const resource = z.object({ id, name: z.string().min(1).max(200), kind: z.enum(['file','directory','browser','ai','skill','conversation-source','run-result']), access: z.enum(['read','write','readwrite','use']), required: z.boolean().default(true) }).strict();
const action = z.object({ id, name: z.string().min(1).max(200), description: z.string().min(1).max(4000) }).strict();
export const authoringPlanSchema = z.object({
  summary: z.string().min(1).max(4000), constants: schema.default({}), defaults: schema.default({}),
  configurationSchema: schema.default({ type: 'object', properties: {}, additionalProperties: false }),
  stateSchema: schema.default({ type: 'object', properties: {}, additionalProperties: false }),
  resources: z.array(resource).max(50).default([]), actions: z.array(action).max(50).default([]),
  entries: z.array(z.object({ id, name: z.string().min(1).max(200), parameters: schema.default({}), inputSchema: schema.default({ type: 'object', properties: {}, additionalProperties: false }), resultSchema: schema.default({ type: 'object' }), capabilities: z.array(z.string().max(100)).max(100), resourceIds: z.array(id).max(50).default([]), actionIds: z.array(id).max(50).default([]), steps: z.array(schema).min(1).max(200) }).strict()).min(1).max(20),
}).strict();
type Plan = z.infer<typeof authoringPlanSchema>;
type Script = { entryId: string; nodeId: string; language: 'js'|'ts'; purpose: string; path: string; sha256?: string };
type Draft = { version: 1; id: string; projectRevision: string; plan: Plan; scripts: Script[]; createdAt: string; assembling?: boolean; assembledRevision?: string };
const key = (entryId: string, nodeId: string) => entryId + '/' + nodeId;
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
async function publish(path:string,content:string){const temp=path+'.'+randomUUID()+'.tmp';try{await writeFile(temp,content,{flag:'wx',mode:0o600});await link(temp,path);}finally{await rm(temp,{force:true});}}

async function directory(parent: string, name: string) {
  const path = join(parent, name); await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ProjectDiagnostic('authoring-private-path','草稿目录不允许符号链接'); return path;
}
async function base(root: string, create=true) {
  const path = await projectRoot(root);
  if(create)return directory(await localDirectory(path),'authoring');
  for(const p of [join(path,'.flowark'),join(path,'.flowark','authoring')]){const stat=await lstat(p);if(!stat.isDirectory()||stat.isSymbolicLink())throw new ProjectDiagnostic('authoring-private-path','草稿目录不允许符号链接');}
  return join(path,'.flowark','authoring');
}
async function read(path: string) {
  const file = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try { const stat = await file.stat(); if (!stat.isFile() || stat.size > 2*1024*1024) throw Error('草稿文件超过范围'); return await file.readFile('utf8'); } finally { await file.close(); }
}
async function load(root: string, draftId: string) {
  z.string().uuid().parse(draftId); const dir = join(await base(root,false), draftId);const info=await lstat(dir);if(!info.isDirectory()||info.isSymbolicLink())throw new ProjectDiagnostic('authoring-private-path','草稿目录不允许符号链接');
  for(const child of ['edges','sources']){const stat=await lstat(join(dir,child));if(!stat.isDirectory()||stat.isSymbolicLink())throw new ProjectDiagnostic('authoring-private-path','草稿目录不允许符号链接');}
  let draft = JSON.parse(await read(join(dir, 'base.json'))) as Draft;
  const seen = new Set<string>();
  for (let i=0;i<256;i++) {
    if(draft.id!==draftId||draft.version!==1||!(/^[a-f0-9]{64}$/).test(draft.projectRevision))throw Error('草稿身份无效');
    authoringPlanSchema.parse(draft.plan);const expected=checkPlan(draft.plan);
    if(expected.length!==draft.scripts.length||expected.some((s,i)=>key(s.entryId,s.nodeId)!==key(draft.scripts[i].entryId,draft.scripts[i].nodeId)||s.path!==draft.scripts[i].path||s.language!==draft.scripts[i].language||draft.scripts[i].sha256!==undefined&&!(/^[a-f0-9]{64}$/).test(draft.scripts[i].sha256!)))throw Error('草稿代码来源无效');
    const revision=digest(draft); if (seen.has(revision)) throw Error('草稿修订环'); seen.add(revision);
    let edge: { parent: string; draft: Draft };
    try { edge = JSON.parse(await read(join(dir, 'edges', revision+'.json'))); }
    catch (error: any) { if (error.code === 'ENOENT') return { dir, draft, revision }; throw error; }
    if (edge.parent!==revision || edge.draft.id!==draftId || edge.draft.projectRevision!==draft.projectRevision) throw Error('草稿修订来源不一致');
    draft=edge.draft;
  }
  throw new ProjectDiagnostic('authoring-history-limit','本草稿已达256次修订，请保留记录后规划新草稿');
}
async function advance(root: string, draftId: string, revision: string, change: (d: Draft)=>Draft) {
  const current=await load(root,draftId); if(current.revision!==revision) throw new ProjectDiagnostic('authoring-conflict','草稿已变化，请读取新修订，不覆盖已有代码');
  const draft=change(structuredClone(current.draft)); const edge=join(current.dir,'edges',revision+'.json');
  try { await publish(edge,json({parent:revision,draft})); }
  catch(error:any){if(error.code==='EEXIST')throw new ProjectDiagnostic('authoring-conflict','草稿被另一作者更新，当前代码未覆盖');throw error;}
  return {dir:current.dir,draft,revision:digest(draft)};
}
function nodeList(entryId: string, input: Record<string,unknown>[], scripts: Script[], validating: boolean): Step[] {
  return input.map(raw=>{
    const node:any=structuredClone(raw); node.version ??= 1;
    if(node.type==='script') {
      if(node.code!==undefined || node.script!==undefined) throw new ProjectDiagnostic('authoring-inline-code','规划只声明脚本用途；代码请提交authoring_code',undefined,entryId+'.'+node.id);
      const language=node.language??'ts', purpose=node.purpose;
      if(!['js','ts'].includes(language)||typeof purpose!=='string'||!purpose.trim()) throw new ProjectDiagnostic('authoring-script-purpose','script规划需要language及purpose',undefined,entryId+'.'+node.id);
      scripts.push({entryId,nodeId:node.id,language,purpose,path:'scripts/'+entryId+'/'+node.id+'.'+language});
      delete node.purpose; node.language=language; node.input??={}; node.dependencies??=[];
      if(validating) node.code='export default async () => { throw Error("authoring draft not executable"); };';
    }
    if(node.type==='condition'){node.then=nodeList(entryId,node.then??[],scripts,validating);node.else=nodeList(entryId,node.else??[],scripts,validating);}
    if(node.type==='loop')node.body=nodeList(entryId,node.body??[],scripts,validating);
    return node as Step;
  });
}
function checkPlan(plan: Plan) {
  const scripts:Script[]=[], resourceIds=new Set(plan.resources.map(r=>r.id)), actionIds=new Set(plan.actions.map(a=>a.id));
  if(resourceIds.size!==plan.resources.length||actionIds.size!==plan.actions.length||new Set(plan.entries.map(e=>e.id)).size!==plan.entries.length)throw new ProjectDiagnostic('authoring-duplicate','入口、资源或动作ID重复');
  for(const e of plan.entries){
    if(e.resourceIds.some(id=>!resourceIds.has(id))||e.actionIds.some(id=>!actionIds.has(id)))throw new ProjectDiagnostic('authoring-entry-scope','入口引用未声明资源或动作',undefined,e.id);
    const nodes=nodeList(e.id,e.steps,scripts,true);
    validateFlow({formatVersion:'1.0',id:e.id,name:e.name,description:'',parameters:e.parameters as any,requiredCapabilities:e.capabilities,steps:nodes});
  }
  if(scripts.length>100 || new Set(scripts.map(s=>key(s.entryId,s.nodeId))).size!==scripts.length)throw new ProjectDiagnostic('authoring-script-limit','脚本数量超过100或区块ID重复');
  if(plan.entries.length*4+scripts.length+5>99)throw new ProjectDiagnostic('authoring-file-limit','本次组装超过单批100文件范围，请拆分入口');
  return scripts;
}
function view(draft:Draft,revision:string){return {draftId:draft.id,draftRevision:revision,projectRevision:draft.projectRevision,stage:draft.assembledRevision?'assembled':draft.assembling?'assembling':draft.scripts.every(s=>s.sha256)?'ready-to-assemble':'coding',summary:draft.plan.summary,plan:draft.plan,scripts:draft.scripts.map(s=>({...s,ready:!!s.sha256})),assembledRevision:draft.assembledRevision,publicFilesWritten:!!draft.assembledRevision};}
export async function planAuthoring(root:string, revision:string, raw:unknown, previousDraftId?:string){
  const snapshot=await snapshotProject(root);if(snapshot.revision!==revision)throw new ProjectDiagnostic('project-conflict','工程已修改，请读取新修订再规划');
  const plan=authoringPlanSchema.parse(raw);if(Buffer.byteLength(json(plan))>256*1024)throw new ProjectDiagnostic('authoring-plan-size','规划超过256KiB，请拆分入口');
  const scripts=checkPlan(plan), draft:Draft={version:1,id:randomUUID(),projectRevision:revision,plan,scripts,createdAt:new Date().toISOString()};
  const dir=await directory(await base(root),draft.id);await directory(dir,'edges');await directory(dir,'sources');
  if(previousDraftId){const previous=await load(root,previousDraftId);
    const flatten=(steps:any[]):any[]=>steps.flatMap(n=>[n,...flatten(n.then??[]),...flatten(n.else??[]),...flatten(n.body??[])]);
    for(const script of draft.scripts){const old=previous.draft.scripts.find(s=>s.entryId===script.entryId&&s.nodeId===script.nodeId&&s.language===script.language&&s.sha256);
      const before=previous.draft.plan.entries.find(e=>e.id===script.entryId),after=draft.plan.entries.find(e=>e.id===script.entryId);
      if(!old||!before||!after||digest(flatten(before.steps).find(n=>n.id===script.nodeId))!==digest(flatten(after.steps).find(n=>n.id===script.nodeId)))continue;
      const source=await read(join(previous.dir,'sources',old.sha256+'.source'));if(digest(source)!==old.sha256)throw new ProjectDiagnostic('authoring-source-changed','旧草稿代码摘要变化',script.path,script.nodeId);
      await publish(join(dir,'sources',old.sha256+'.source'),source);script.sha256=old.sha256;
    }
  }
  await publish(join(dir,'base.json'),json(draft));
  return view(draft,digest(draft));
}
export async function getAuthoring(root:string,draftId:string,entryId?:string,nodeId?:string){
  const {dir,draft,revision}=await load(root,draftId);const result:any=view(draft,revision);
  if(entryId!==undefined||nodeId!==undefined){const script=draft.scripts.find(s=>s.entryId===entryId&&s.nodeId===nodeId);if(!script)throw new ProjectDiagnostic('authoring-script','脚本区块不存在');if(script.sha256){result.source=await read(join(dir,'sources',script.sha256+'.source'));if(digest(result.source)!==script.sha256)throw Error('草稿代码摘要变化');}}
  return result;
}
export async function codeAuthoring(root:string,draftId:string,revision:string,entryId:string,nodeId:string,source:string){
  const current=await load(root,draftId);if(current.revision!==revision)throw new ProjectDiagnostic('authoring-conflict','草稿已变化，请先读取');
  if(current.draft.assembledRevision||current.draft.assembling)throw new ProjectDiagnostic('authoring-assembled','草稿已组装，后续修改请规划新修订');
  const script=current.draft.scripts.find(s=>s.entryId===entryId&&s.nodeId===nodeId);if(!script)throw new ProjectDiagnostic('authoring-script','脚本区块不存在',undefined,entryId+'.'+nodeId);
  if(!source.trim()||Buffer.byteLength(source)>256*1024)throw new ProjectDiagnostic('authoring-code-size','节点代码须为不超过256KiB的完整模块',script.path,nodeId);
  try{const result=await build({stdin:{contents:source,loader:script.language,sourcefile:script.path},format:'esm',target:'es2022',write:false,metafile:true,logLevel:'silent'});if(!Object.values(result.metafile!.outputs).some(o=>o.exports.includes('default')))throw new ProjectDiagnostic('authoring-default-export','脚本需要default export async函数',script.path,nodeId);}
  catch(error:any){if(error instanceof ProjectDiagnostic)throw error;return {valid:false,draftId,draftRevision:revision,entryId,nodeId,diagnostics:(error.errors??[]).map((e:any)=>({code:'script-syntax',message:e.text,file:script.path,field:nodeId,line:e.location?.line,column:e.location?e.location.column+1:undefined})),publicFilesWritten:false};}
  const typeIssues=await checkProjectScripts(new Map([[script.path,source]]),[{path:script.path,entryId,nodeId}]);
  if(typeIssues.length)return {valid:false,draftId,draftRevision:revision,entryId,nodeId,diagnostics:typeIssues,publicFilesWritten:false};
  const sha256=digest(source);if(script.sha256===sha256)return {...view(current.draft,current.revision),valid:true,unchanged:true,checked:'syntax and SDK types',publicFilesWritten:false};
  const path=join(current.dir,'sources',sha256+'.source');
  try{await publish(path,source);}catch(error:any){if(error.code!=='EEXIST'||await read(path)!==source)throw error;}
  const next=await advance(root,draftId,revision,d=>({...d,scripts:d.scripts.map(s=>s.entryId===entryId&&s.nodeId===nodeId?{...s,sha256}:s)}));
  return {...view(next.draft,next.revision),valid:true,checked:'syntax, installed SDK types and default export function; full project imports checked at assembly; runtime permissions remain host-validated',publicFilesWritten:false};
}
export async function assembleAuthoring(root:string,draftId:string,revision:string){
  let current=await load(root,draftId);if(current.revision!==revision)throw new ProjectDiagnostic('authoring-conflict','草稿已变化，请读取新修订');
  if(current.draft.assembledRevision)return {...view(current.draft,current.revision),alreadyAssembled:true};
  const draft=current.draft;const snapshot=await snapshotProject(root);
  const missing=draft.scripts.filter(s=>!s.sha256);if(missing.length)throw new ProjectDiagnostic('authoring-missing-code','尚有脚本未实现：'+missing.map(s=>key(s.entryId,s.nodeId)).join(','));
  const files:Record<string,string>={},m=structuredClone(snapshot.manifest);m.entries=[];m.resources=draft.plan.resources;m.actions=draft.plan.actions.map(a=>({...a,default:'deny'}));m.prompts=[];m.promptBindings={};m.environment=[];
  for(const e of draft.plan.entries){
    const ignored:Script[]=[],steps=nodeList(e.id,e.steps,ignored,false),graph=emitGraph(steps),bindings:Record<string,unknown>={};
    for(const [id,node]of Object.entries(graph.nodes)){const script=draft.scripts.find(s=>s.entryId===e.id&&s.nodeId===id);bindings[id]={node,...script?{script:script.path}:{}};}
    files['flows/'+e.id+'.mmd']=graph.mermaid;files['nodes/'+e.id+'.json']=json(bindings);files['schemas/inputs/'+e.id+'.json']=json(e.inputSchema);files['schemas/results/'+e.id+'.json']=json(e.resultSchema);
    m.entries.push({id:e.id,name:e.name,graph:'flows/'+e.id+'.mmd',nodes:'nodes/'+e.id+'.json',inputSchema:'schemas/inputs/'+e.id+'.json',resultSchema:'schemas/results/'+e.id+'.json',parameters:e.parameters,capabilities:e.capabilities,resourceIds:e.resourceIds,actionIds:e.actionIds,schedulable:false});m.promptBindings[e.id]=[];
  }
  for(const s of draft.scripts){files[s.path]=await read(join(current.dir,'sources',s.sha256+'.source'));if(digest(files[s.path])!==s.sha256)throw new ProjectDiagnostic('authoring-source-changed','草稿代码摘要变化',s.path,s.nodeId);}
  files['schemas/configuration.json']=json(draft.plan.configurationSchema);files['schemas/state.json']=json(draft.plan.stateSchema);files['config/constants.json']=json(draft.plan.constants);files['config/defaults.json']=json(draft.plan.defaults);
  files['README.md']='# '+m.metadata.name+'\n\n'+draft.plan.summary+'\n\n此工程由内置开发Skill与分阶段工具生成。配置本人资源后核对运行。API Key产生的费用由用户自行承担。静态编译不代表业务验收通过。\n';
  m.publicFiles=Object.keys(files).sort();files['flowark.project.json']=json(m);
  if(Object.keys(files).length>100)throw new ProjectDiagnostic('authoring-file-limit','组装超过单批100文件，请拆分工程');
  const matches = snapshot.files.size===Object.keys(files).length&&Object.entries(files).every(([path,content])=>snapshot.files.get(path)?.equals(Buffer.from(content)));
  if(snapshot.revision!==draft.projectRevision&&!matches)throw new ProjectDiagnostic('project-conflict','规划后工程发生变化，草稿保留；未覆盖源文件');
  if(!current.draft.assembling)current=await advance(root,draftId,current.revision,d=>({...d,assembling:true}));
  let result:any;
  try{result=matches?{revision:snapshot.revision}:await updateProjectFiles(root,draft.projectRevision,Object.entries(files).map(([path,content])=>({path,content})));}
  catch(error){
    const observed=await snapshotProject(root).catch(()=>undefined);
    if(observed?.revision===draft.projectRevision)current=await advance(root,draftId,current.revision,d=>({...d,assembling:false}));
    return {...view(current.draft,current.revision),valid:false,publicFilesWritten:false,diagnostics:[error instanceof ProjectDiagnostic?error.toJSON():{code:'authoring-compile',message:error instanceof Error?error.message:'工程编译失败'}],next:observed?'修正对应脚本后重新组装':'先通过正式工程事务工具核对恢复，未执行流程'};
  }

  const final=await advance(root,draftId,current.revision,d=>({...d,assembling:false,assembledRevision:result.revision}));return {...view(final.draft,final.revision),project:result,valid:true,scriptsExecuted:false};
}
