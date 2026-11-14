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
export type PlatformRoute={status:'matched'|'generic'|'question'|'unsupported';platform?:'feishu';skill?:PlatformAuthoringSkill;message:string};
/** Preserve the dialogue audit, but route only the explicitly prioritized custom requirement. */
export function platformRequirementText(text:string) {
  const marker='\n自定义修正（优先）：',at=text.lastIndexOf(marker);
  return at<0?text:text.slice(at+marker.length).split('\n先核对修正内容，不批准旧方案的代码生成或组装。')[0];
}
const feishuPattern=/飞书|feishu|lark/i;
const bitablePattern=/多维表格|bitable/i;
const otherPlatformPattern=/钉钉|企业微信|微信|企微|notion|airtable|google\s*sheets|腾讯文档|石墨|语雀|trello|金山文档|wps/i;
/** Shared by routing and continuation: explicit platform changes cannot inherit generic/local mode. */
export function hasPlatformIntent(text:string) {
  text=platformRequirementText(text);
  return feishuPattern.test(text)||bitablePattern.test(text)||otherPlatformPattern.test(text)||
    /平台|^(?:改用|换到|切换到|改到)|[改换](?:为|成|用|到).{0,20}(?:表格|文档)/i.test(text);
}
function matchedPlatformSkill(catalog:PlatformSkillEntry[]):PlatformRoute {
  const e=catalog.find(e=>e.id==='feishu-bitable');if(!e)throw Error('内置平台 Skill 缺失');
  const skill=parsePlatformAuthoringSkill(readFileSync(join(resourceRoot,e.id,'SKILL.md'),'utf8'),'builtin:'+e.id);
  return {status:'matched',skill,message:`已匹配内置平台 Skill：${e.summary} · ${e.version} · SHA-256 ${e.sha256}。可在对话中纠正平台；对象和操作细节仍须核对。`};
}
/** Local routing never opens credentials or invokes a model. Ambiguity stops before execution. */
export function routePlatformSkill(text:string,previous?:PlatformAuthoringSkill):PlatformRoute {
  const catalog=builtinPlatformSkills();
  text=platformRequirementText(text).trim();
  const question=(message='请确认具体平台与视图：是否为飞书多维表格？也可以自定义说明其他平台与操作对象。',platform?:'feishu'):PlatformRoute=>({status:'question',message,...(platform?{platform}:{})});
  const unsupported=():PlatformRoute=>({status:'unsupported',message:'当前内置目录尚未支持该平台或视图。请纠正平台，或明确改为通用本地任务；不会套用飞书多维表格 Skill。'});
  const generic=():PlatformRoute=>({status:'generic',message:'已选择通用本地任务，不使用平台 Skill；不得套用未支持站点操作规则。'});
  // These are the local UI's submitted choices, never its unsubmitted preselection.
  const chosen=/^选择：([^。]+)。/.exec(text)?.[1];
  if(chosen==='其他平台或视图')return unsupported();
  if(chosen==='通用本地任务')return generic();
  if(/^(?:(?:改为|改成|切换为|选择)\s*)?通用本地任务(?:[，。；\s]|$)|(?:不用|不使用|不要使用)平台\s*Skill/i.test(text))return generic();
  const feishu=feishuPattern.test(text),bitable=bitablePattern.test(text),other=otherPlatformPattern.test(text);
  const negated=/(?:不是|并非|非|不再(?:使用|用)?|不要(?:使用|用)?|不用|先别用|别用)[，、\s]*(?:飞书|feishu|lark|多维表格|bitable)/i.test(text)||
    /(?:飞书|feishu|lark)(?:的)?(?:多维表格|bitable)[，、\s]*(?:先别用|不要用|不用|不再用|先别使用|不要使用|不再使用)/i.test(text);
  if(negated)return other?unsupported():question('已收到不使用飞书多维表格的修正。请说明新的平台和视图；不会沿用原 Skill。');
  if(other)return feishu?question('需求同时提到多个平台，请明确本次处理的平台和视图；不会自动套用其中一份 Skill。'):unsupported();
  const otherView=/飞书(?:的)?(?:电子表格|普通表格|文档|聊天)/i.test(text);
  if(otherView)return bitable?question('需求同时提到飞书多维表格与其他视图，请明确本次操作对象。'):unsupported();
  // A current declaration outweighs old-platform names mentioned elsewhere in the same answer.
  const declaration=[...text.matchAll(/(?:平台(?:是|为|用|改为|改成|换成|切换到|[：:])|^(?:改用|换到|切换到|改到))[：:\s]*([^，。；\n]+)/g)].at(-1)?.[1];
  if(declaration&&!(feishuPattern.test(declaration)&&bitablePattern.test(declaration)))return feishuPattern.test(declaration)?question('已明确平台为飞书，请确认是多维表格、电子表格还是其他视图。','feishu'):question('平台声明尚不能唯一匹配内置 Skill，请确认平台和视图；不会沿用旧匹配。');
  if(feishu&&bitable)return matchedPlatformSkill(catalog);
  // Mentioning the already selected platform during ordinary follow-up is not
  // a request to choose its view again. Explicit changes/negations above still win.
  if(feishu&&!declaration&&previous?.id==='feishu-bitable'&&previous.sourceName==='builtin:feishu-bitable')return matchedPlatformSkill(catalog);
  if(hasPlatformIntent(text))return feishu?question('已明确平台为飞书，请确认是多维表格、电子表格还是其他视图。','feishu'):question();
  if(previous&&previous.sourceName==='builtin:'+previous.id){
    const e=catalog.find(e=>e.id===previous.id);if(e){const skill=parsePlatformAuthoringSkill(readFileSync(join(resourceRoot,e.id,'SKILL.md'),'utf8'),'builtin:'+e.id);return {status:'matched',skill,message:`沿用内置平台 Skill：${e.summary} · ${e.version} · SHA-256 ${e.sha256}`};}
  }
  return question('请补充任务所在平台和对象；当前内置支持飞书多维表格，其他平台可自定义说明，本地文件任务可选择通用本地任务。');
}
