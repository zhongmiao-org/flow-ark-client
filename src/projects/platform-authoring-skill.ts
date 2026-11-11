import { createHash } from 'node:crypto';
export const platformSkillMaxBytes = 48 * 1024;
export type PlatformAuthoringSkill = { id:string; version:string; sha256:string; content:string; sourceName:string };
/** Single Markdown snapshot only: references are text, never dependency discovery. */
export function parsePlatformAuthoringSkill(content:string, sourceName='SKILL.md'):PlatformAuthoringSkill {
  if(typeof content!=='string'||Buffer.byteLength(content,'utf8')>platformSkillMaxBytes||content.includes('\0'))throw Error('平台作者 Skill 必须是小于 48 KiB 的 UTF-8 Markdown 正文');
  if(!/^---\r?\n/.test(content))throw Error('Skill 缺少 name 和 metadata.version 元数据');
  const front=content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  const id=front?.match(/^name:\s*([a-z0-9][a-z0-9-]{0,99})\s*$/m)?.[1];
  const version=front?.match(/^metadata:\s*\r?\n(?:[ \t]+[^\r\n]+\r?\n)*?[ \t]+version:\s*([a-zA-Z0-9][a-zA-Z0-9.+-]{0,79})\s*$/m)?.[1];
  if(!id||!version||!content.slice(content.indexOf('---',3)+3).trim())throw Error('Skill 需要 name 与 metadata.version 简单标量及非空正文');
  if(/\bsk-[a-zA-Z0-9]{24,}|-----BEGIN .*PRIVATE KEY/.test(content))throw Error('请勿导入包含凭据的 Skill');
  return {id,version,sha256:createHash('sha256').update(content,'utf8').digest('hex'),content,sourceName:sourceName.slice(0,120)};
}
export function checkedPlatformSkill(value:PlatformAuthoringSkill|null|undefined) {
  if(!value)return undefined;
  const checked=parsePlatformAuthoringSkill(value.content,value.sourceName);
  if(checked.id!==value.id||checked.version!==value.version||checked.sha256!==value.sha256)throw Error('平台作者 Skill 快照摘要不符，请重新选择');
  return checked;
}
