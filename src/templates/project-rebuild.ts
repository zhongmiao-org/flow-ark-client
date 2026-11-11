import {canonical,jsonFile,sha256,type PackageData} from '../../contracts/package-format';
/** Conservative project-only structural compatibility; never migrates data or grants. */
export function projectRebuildCompatibility(old:PackageData,next:PackageData){
 if(old.manifest.id!==next.manifest.id)throw Error('不能将调试实例改为另一工程');
 for(const key of ['resources','actions','dependencies','sdkVersion'] as const)if(canonical(old.manifest[key])!==canonical(next.manifest[key]))throw Error('资源、动作、依赖或SDK边界变化，不能兼容重建');
 const configBefore=jsonFile(old.files,old.manifest.configurationSchema),configAfter=jsonFile(next.files,next.manifest.configurationSchema);
 if(canonical(configBefore)!==canonical(configAfter))throw Error('配置Schema变化，不能兼容重建');
 const stateBefore=jsonFile(old.files,old.manifest.stateSchema),stateAfter=jsonFile(next.files,next.manifest.stateSchema);
 let stateProperties:string[]=[];
 if(canonical(stateBefore)!==canonical(stateAfter)){
  const before=stateBefore as Record<string,unknown>,after=stateAfter as Record<string,unknown>;
  if(!before||!after||before.type!=='object'||after.type!=='object')throw Error('状态Schema仅允许对象新增可选属性');
  const {properties:beforeProperties={},...beforeRoot}=before,{properties:afterProperties={},...afterRoot}=after;
  if(canonical(beforeRoot)!==canonical(afterRoot)||!beforeProperties||Array.isArray(beforeProperties)||typeof beforeProperties!=='object'||!afterProperties||Array.isArray(afterProperties)||typeof afterProperties!=='object')throw Error('状态Schema既有根约束或required变化，不能兼容重建');
  const b=beforeProperties as Record<string,unknown>,a=afterProperties as Record<string,unknown>;
  for(const name of Object.keys(b))if(!Object.hasOwn(a,name)||canonical(b[name])!==canonical(a[name]))throw Error('状态Schema既有属性变化，不能兼容重建');
  stateProperties=Object.keys(a).filter(k=>!Object.hasOwn(b,k)).sort();
  if(!stateProperties.length||stateProperties.some(k=>Array.isArray(after.required)&&after.required.includes(k)))throw Error('状态Schema只能新增非必填属性');
 }
 if(canonical(old.manifest.entries.map(e=>e.id).sort())!==canonical(next.manifest.entries.map(e=>e.id).sort()))throw Error('入口集合变化，不能兼容重建');
 const attentionEntries:string[]=[],resultSchemas:{entryId:string;before:unknown;after:unknown;beforeSha256:string;afterSha256:string}[]=[];
 for(const e of next.manifest.entries){
  const original=old.manifest.entries.find(o=>o.id===e.id)!;
  for(const field of ['resources','actions','batching'] as const)if(canonical(original[field]??null)!==canonical(e[field]??null))throw Error('入口资源、动作或连续执行边界变化，不能兼容重建');
  if(canonical(jsonFile(old.files,original.inputSchema))!==canonical(jsonFile(next.files,e.inputSchema)))throw Error('入口输入Schema变化，不能兼容重建');
  const added=e.capabilities.filter(c=>!original.capabilities.includes(c));
  if(added.some(c=>c!=='attention')||canonical(e.capabilities.filter(c=>original.capabilities.includes(c)))!==canonical(original.capabilities))throw Error('入口能力只允许显式新增本地待办attention');
  if(added.length)attentionEntries.push(e.id);
  const before=jsonFile(old.files,original.resultSchema),after=jsonFile(next.files,e.resultSchema);
  if(canonical(before)!==canonical(after))resultSchemas.push({entryId:e.id,before,after,beforeSha256:sha256(canonical(before)),afterSha256:sha256(canonical(after))});
 }
 return {changed:!!(stateProperties.length||attentionEntries.length||resultSchemas.length),stateProperties,attentionEntries,resultSchemas,stateSchemaBeforeSha256:sha256(canonical(stateBefore)),stateSchemaAfterSha256:sha256(canonical(stateAfter))};
}
