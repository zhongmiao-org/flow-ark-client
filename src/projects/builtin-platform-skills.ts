import Ajv from 'ajv/dist/2020.js';
import catalogSchema from '../../contracts/platform-skill-catalog-v1.schema.json';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkedPlatformSkill, parsePlatformAuthoringSkill, type PlatformAuthoringSkill } from './platform-authoring-skill';
export type PlatformSkillEntry = {id:string;version:string;sha256:string;summary:string;platform:string;views:string[];operations:string[];requiredCapabilities:string[];verifiedBoundary:string};
const resourceRoot = typeof __dirname === 'string' ? join(__dirname,'skills') : fileURLToPath(new URL('../../resources/skills/',import.meta.url));
export function builtinPlatformSkills():PlatformSkillEntry[] {
  const entries:PlatformSkillEntry[]=JSON.parse(readFileSync(join(resourceRoot,'platform-catalog.json'),'utf8'));
  if(!new Ajv({strict:false}).validate(catalogSchema,entries))throw Error('内置平台 Skill 目录不符合契约');
  if(!Array.isArray(entries)||entries.length>20||new Set(entries.map(e=>e.id)).size!==entries.length)throw Error('内置平台 Skill 目录无效');
  for(const e of entries){
    if(!/^[a-z][a-z0-9-]{0,63}$/.test(e.id)||!e.summary||!e.platform||!e.verifiedBoundary||![e.views,e.operations,e.requiredCapabilities].every(v=>Array.isArray(v)&&v.length&&v.every(x=>typeof x==='string'&&x.length)))throw Error('内置平台 Skill 元数据无效');
    const s=parsePlatformAuthoringSkill(readFileSync(join(resourceRoot,e.id,'SKILL.md'),'utf8'),'builtin:'+e.id);
    checkedPlatformSkill({...s,id:e.id,version:e.version,sha256:e.sha256});
  }
  return entries;
}
export type PlatformRoute={status:'matched'|'generic'|'question'|'unsupported';skill?:PlatformAuthoringSkill;message:string};
/** Preserve the dialogue audit, but route only the explicitly prioritized custom requirement. */
export function platformRequirementText(text:string) {
  const marker='\n自定义修正（优先）：',at=text.lastIndexOf(marker);
  return at<0?text:text.slice(at+marker.length).split('\n先核对修正内容，不批准旧方案的代码生成或组装。')[0];
}
/** Local routing never opens credentials or invokes a model. Latest explicit platform wins. */
export function routePlatformSkill(text:string,previous?:PlatformAuthoringSkill):PlatformRoute {
  const catalog=builtinPlatformSkills();
  text=platformRequirementText(text);
  const negated=/(?:不是|不再使用|不要使用|并非)[，、\s]*(?:飞书|feishu|lark)/i.test(text);
  text=text.replace(/(?:不是|不再使用|不要使用|并非)[，、\s]*(?:飞书|feishu|lark)[，、\s]*(?:多维表格|bitable)/gi,'');
  if(/其他平台或视图|(?:平台|改用|改为|换成)[：:\s]*[A-Za-z][A-Za-z0-9_-]+/i.test(text)&&!/feishu|lark|bitable/i.test(text))return {status:'unsupported',message:'该平台尚无匹配的内置 Skill，请自定义说明平台或选择通用本地任务。'};
  const feishu=/飞书|feishu|lark/i.test(text),bitable=/多维表格|bitable/i.test(text);
  if((feishu&&bitable&&!/钉钉|企业微信|腾讯文档|notion|airtable/i.test(text))||(/^选择：飞书多维表格/.test(text))){
    const e=catalog.find(e=>e.id==='feishu-bitable');if(!e)throw Error('内置平台 Skill 缺失');
    const skill=parsePlatformAuthoringSkill(readFileSync(join(resourceRoot,e.id,'SKILL.md'),'utf8'),'builtin:'+e.id);
    return {status:'matched',skill,message:`已匹配内置平台 Skill：${e.summary} · ${e.version} · SHA-256 ${e.sha256}。可在对话中纠正平台；对象和操作细节仍须核对。`};
  }
  if(/通用本地任务|不使用平台\s*Skill/i.test(text))return {status:'generic',message:'已选择通用本地任务，不使用平台 Skill；不得套用未支持站点操作规则。'};
  if(/钉钉|企业微信|微信|企微|notion|airtable|google\s*sheets|腾讯文档|飞书电子表格|飞书文档|飞书聊天/i.test(text)||(feishu&&/电子表格|普通表格|文档|聊天/.test(text)))return {status:'unsupported',message:'当前内置目录尚未支持该平台或视图。请纠正平台，或明确改为通用本地任务；不会套用飞书多维表格 Skill。'};
  if(negated||feishu||bitable||/更换平台|纠正平台|改用平台|平台(?:是|为|改为|改成|换成|[：:])|平台[改换]|[改换](?:用|为|成).{0,20}(?:平台|表格|文档)|石墨|语雀/.test(text))return {status:'question',message:'请确认具体平台与视图：是否为飞书多维表格？也可以自定义说明其他平台与操作对象。'};
  if(previous&&previous.sourceName==='builtin:'+previous.id){
    const e=catalog.find(e=>e.id===previous.id);if(e){const skill=parsePlatformAuthoringSkill(readFileSync(join(resourceRoot,e.id,'SKILL.md'),'utf8'),'builtin:'+e.id);return {status:'matched',skill,message:`沿用内置平台 Skill：${e.summary} · ${e.version} · SHA-256 ${e.sha256}`};}
  }
  return {status:'question',message:'请补充任务所在平台和对象；当前内置支持飞书多维表格，其他平台可自定义说明，本地文件任务可选择通用本地任务。'};
}
