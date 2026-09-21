/** Normative package validation, pinned with the 0.8.0 contracts. No application imports. */
import { createHash } from 'node:crypto';
import Ajv from 'ajv/dist/2020.js';
import schema from './p1.schema.json';
import {validateConfigurationSchema} from './configuration-schema';
export const LIMITS = { archive: 20*1024*1024, total: 100*1024*1024, file: 10*1024*1024, files: 512 };
export type Entry = { id:string; name:string; flow:string; inputSchema:string; resultSchema:string; schedulable:boolean; capabilities:string[]; resources:string[]; actions:string[] };
export type Manifest = { packageFormat:'2.0'; id:string; name:string; description:string; version:string; author:string; source:string; minimumClientVersion:string; sdkVersion:'1.0'; configurationSchema:string; stateSchema:string; entries:Entry[]; resources:{id:string;name:string;kind:'file'|'directory'|'browser'|'ai';access:'read'|'write'|'readwrite'|'use';required:boolean}[]; actions:{id:string;name:string;description:string;default:'deny'}[]; files:{path:string;size:number;sha256:string}[]; scripts:string[]; dependencies:{name:string;version:string;license:string}[];contentDigest:string };
export type PackageData = { manifest:Manifest; files:Map<string,Buffer> };
export function canonical(value:any):string {
 if (value === undefined) throw new Error('摘要不能包含 undefined');
 return JSON.stringify(value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])) : Array.isArray(value) ? value.map(v=>JSON.parse(canonical(v))) : value);
}
export const sha256 = (value:string|Uint8Array) => createHash('sha256').update(value).digest('hex');
export function manifestDigest(manifest:any) { const {contentDigest,...body}=manifest; return sha256(canonical(body)); }
export function packagePath(path:string):string {
 if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,239}$/.test(path) || path.split('/').some(p=>!p||p==='.'||p==='..') || /(^|\/)node_modules(\/|$)/i.test(path) || /\.(node|exe|dll|dylib|so|app|dmg)$/i.test(path)) throw new Error('包路径不允许：'+path);
 return path;
}
function unique(values:string[], label:string) { if(new Set(values).size!==values.length) throw new Error(label+'重复'); }
export function assertSchema(value:any) {
 const visit=(v:any,depth=0)=>{ if(depth>40) throw new Error('Schema 层级过深'); if(!v||typeof v!=='object')return; for(const [key,item] of Object.entries(v)) { if((key==='$ref' || key==='$dynamicRef') && (typeof item!=='string'||!item.startsWith('#/'))) throw new Error('Schema 禁止外部引用'); if(key==='$id')throw new Error('业务 Schema 不允许自定义 $id'); visit(item,depth+1); } };
 visit(value); new Ajv({strict:false,allErrors:true}).compile(value);
}
export function validateData(definition:any,value:any) {
 assertSchema(definition); const ajv=new Ajv({strict:false,allErrors:true}); const validate=ajv.compile(definition); if(!validate(value))throw new Error('Schema 校验失败：'+ajv.errorsText(validate.errors)); return value;
}
export function jsonFile(files:Map<string,Buffer>,path:string):any {
 packagePath(path); const b=files.get(path); if(!b)throw new Error('缺少资源：'+path); return JSON.parse(b.toString('utf8'));
}
export function validatePackage(files:Map<string,Buffer>):PackageData {
 if(files.size>LIMITS.files)throw new Error('包文件数超过上限');
 let total=0;const names=new Set<string>();
 for(const [path,bytes]of files){packagePath(path);if(!/^(manifest\.json|README\.md|(flows|schemas|scripts|prompts|assets)\/.+)$/.test(path))throw new Error('包根目录资源不允许：'+path);if(names.has(path.toLowerCase()))throw new Error('包路径大小写冲突'); names.add(path.toLowerCase()); if(bytes.length>LIMITS.file)throw new Error('包文件大小超过上限');total+=bytes.length;}
 if(total>LIMITS.total)throw new Error('包展开大小超过上限');
 const manifest=jsonFile(files,'manifest.json') as Manifest;
 const ajv=new Ajv({strict:false,allErrors:true});ajv.addSchema(schema);const validate=ajv.getSchema(schema.$id+'#/$defs/TemplateArchiveManifest')!;
 if(!validate(manifest))throw new Error('模板清单无效：'+ajv.errorsText(validate.errors));
 if(!manifest.entries.length)throw new Error('模板至少需要一个入口');
 unique(manifest.entries.map(e=>e.id),'入口');unique(manifest.resources.map(r=>r.id),'资源');unique(manifest.actions.map(a=>a.id),'动作');unique(manifest.files.map(f=>f.path),'清单文件');unique(manifest.scripts,'脚本');
 if(manifest.files.length!==files.size-1 || manifest.files.some(f=>f.path==='manifest.json'))throw new Error('未声明文件或清单自引用');
 for(const f of manifest.files){packagePath(f.path);const b=files.get(f.path);if(!b||b.length!==f.size||sha256(b)!==f.sha256)throw new Error('资源完整性不匹配：'+f.path);}
 if(manifestDigest(manifest)!==manifest.contentDigest)throw new Error('模板摘要不匹配');
 const schemaPaths=[manifest.configurationSchema,manifest.stateSchema,...manifest.entries.flatMap(e=>[e.inputSchema,e.resultSchema])];
 for(const p of schemaPaths){if(!p.startsWith('schemas/'))throw new Error('Schema 必须位于 schemas/');assertSchema(jsonFile(files,p));}
 for(const p of files.keys())if(p.startsWith('scripts/')&&!manifest.scripts.includes(p))throw new Error('脚本未由清单声明');
 validateConfigurationSchema(jsonFile(files,manifest.configurationSchema));
 for(const e of manifest.entries)validateConfigurationSchema(jsonFile(files,e.inputSchema));
 for(const p of manifest.scripts){if(!p.startsWith('scripts/')||!p.endsWith('.js')||!files.has(p))throw new Error('脚本资源无效');}
 for(const r of manifest.resources)if(['browser','ai'].includes(r.kind)?r.access!=='use':r.access==='use')throw new Error('浏览器和 AI 资源需声明 use');
 for(const entry of manifest.entries){
  unique(entry.resources,'入口资源');unique(entry.actions,'入口动作');unique(entry.capabilities,'入口能力');
  for(const id of entry.resources)if(!manifest.resources.some(r=>r.id===id))throw new Error('入口引用未知资源');
  for(const id of entry.actions)if(!manifest.actions.some(a=>a.id===id))throw new Error('入口引用未知动作');
  if(!entry.flow.startsWith('flows/'))throw new Error('入口流程必须位于 flows/');
  const flow=jsonFile(files,entry.flow);const fv=ajv.getSchema(schema.$id+'#/$defs/FlowDefinition')!;
  if(!fv(flow))throw new Error('入口流程无效：'+ajv.errorsText(fv.errors));
  for(const cap of flow.requiredCapabilities)if(!entry.capabilities.includes(cap))throw new Error('流程能力未由入口声明：'+cap);
  let count=0;const ids=new Set<string>();
  const walk=(steps:any[],depth=0)=>{if(depth>16)throw new Error('流程过深');for(const n of steps){if(++count>1000||ids.has(n.id))throw new Error('流程节点重复或过多');ids.add(n.id);if(n.type==='script'){
   if(n.dependencies.length)throw new Error('正式包脚本必须在开发阶段静态打包');
   const p=n.code.startsWith('@package:')?n.code.slice(9):null;
   if(!p||!manifest.scripts.includes(p))throw new Error('脚本必须引用清单中的 @package:scripts/ 资源');
  }if(n.type==='condition'){walk(n.then,depth+1);walk(n.else,depth+1);}if(n.type==='loop')walk(n.body,depth+1);}};walk(flow.steps);
 }
 return {manifest,files};
}
export function materializeFlow(pkg:PackageData,entryId:string):any {
 const entry=pkg.manifest.entries.find(e=>e.id===entryId);if(!entry)throw new Error('入口不存在');
 const flow=jsonFile(pkg.files,entry.flow);
 const walk=(nodes:any[])=>{for(const n of nodes){if(n.type==='script'){n.code=pkg.files.get(n.code.slice(9))!.toString('utf8');n.language='js';}if(n.type==='condition'){walk(n.then);walk(n.else);}if(n.type==='loop')walk(n.body);}};walk(flow.steps);return flow;
}
