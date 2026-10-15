import { z } from 'zod';
import {
  skill_versionref_v1,
  skill_draft_v1,
  skill_manifest_v1,
  skill_version_v1,
  skill_proposalsnapshot_v1,
} from './node-schema.generated';
import type { Bindings, Step } from './types';
export type {
  SkillVersionRef,
  SkillDraft,
  SkillManifest,
  SkillVersion,
  SkillProposalSnapshot,
  SkillProposeOutput,
} from './contracts.generated';
import type {
  SkillVersionRef,
  SkillDraft,
  SkillManifest,
  SkillVersion,
  SkillProposalSnapshot,
} from './contracts.generated';
export type SkillNode = Extract<Step, { type: 'skill' }>;
export const skillCapability = 'skill-v1';
export const skillBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;
export function skillBudget(value: unknown) {
  let count = 0;
  const visit = (v: unknown, depth: number) => {
    if (depth > 32 || ++count > 10000) throw Error('Skill内容层级或数量超限');
    if (
      v === null ||
      typeof v === 'string' ||
      typeof v === 'boolean' ||
      (typeof v === 'number' && Number.isFinite(v))
    )
      return;
    if (typeof v !== 'object') throw Error('Skill只接受JSON数据');
    if (Array.isArray(v)) {
      for (const child of v) visit(child, depth + 1);
      return;
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(v)))
      throw Error('Skill只接受普通JSON对象');
    for (const [key, child] of Object.entries(v)) {
      if (++count > 10000) throw Error('Skill内容数量超限');
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  if (skillBytes(value) > 1048576) throw Error('Skill内容超过1MiB');
}
export function assertSkillRef(v: unknown): asserts v is SkillVersionRef {
  if (!skill_versionref_v1(v)) throw Error('Skill必须选择准确的确认版本与摘要');
}
export function assertSkillDraft(v: unknown): asserts v is SkillDraft {
  skillBudget(v);
  if (!skill_draft_v1(v) || (v as SkillDraft).markdown.length > 60000)
    throw Error('Skill草稿标题、正文、数据或来源无效');
}
export function assertSkillManifest(v: unknown): asserts v is SkillManifest {
  skillBudget(v);
  if (!skill_manifest_v1(v)) throw Error('Skill确认清单无效');
  const m = v as SkillManifest;
  if (m.parent && m.parent.key !== m.key) throw Error('Skill父版本不属于当前键');
  if (new Date(m.confirmedAt).toISOString() !== m.confirmedAt) throw Error('Skill确认时间无效');
}
export function assertSkillVersion(v: unknown): asserts v is SkillVersion {
  skillBudget(v);
  if (!skill_version_v1(v)) throw Error('Skill确认版本格式无效');
  const s = v as SkillVersion;
  assertSkillDraft({ title: s.title, markdown: s.markdown, data: s.data, evidence: s.evidence });
  if (s.parent && s.parent.key !== s.ref.key) throw Error('Skill父版本键不匹配');
}
export function assertSkillProposal(v: unknown): asserts v is SkillProposalSnapshot {
  skillBudget(v);
  if (!skill_proposalsnapshot_v1(v)) throw Error('Skill草稿记录无效');
  assertSkillDraft((v as SkillProposalSnapshot).draft);
}
export const skillKey = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(v))
    throw Error('Skill键须为小写字母开头的1–64位字母、数字或连字符');
  return v;
};
export function skillBinding(bindings: Bindings, id: string) {
  const b = bindings.resources?.[id];
  if (!b?.path || !b.skill || Object.keys(b).some((k) => !['path', 'skill'].includes(k)))
    throw Error(`Skill资源「${id}」尚未选择固定确认版本`);
  assertSkillRef(b.skill);
  return { path: b.path, skill: b.skill };
}
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const skillRefSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    versionId: z.string().regex(/^sv_[a-f0-9]{32}$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const skillMethods = {
  'skill.list': z.object({}).strict(),
  'skill.inspectBinding': z
    .object({ path: z.string().min(1).max(4096), ref: skillRefSchema })
    .strict(),
  'skill.detail': z.object({ id }).strict(),
  'skill.base': z.object({ id }).strict(),
  'skill.save': z.object({ id, revision, draft: z.unknown() }).strict(),
  'skill.preview': z.object({ id, revision }).strict(),
  'skill.confirm': z
    .object({
      id,
      revision,
      token: z.string().regex(/^[a-f0-9]{64}$/),
      requestId: id,
      reviewed: z.literal(true),
    })
    .strict(),
  'skill.cancelUnstarted': z.object({ id, requestId: id, reviewed: z.literal(true) }).strict(),
  'skill.inspect': z.object({ id, requestId: id }).strict(),
  'skill.rebase': z
    .object({
      id,
      revision,
      reviewed: z.literal(true),
      head: skillRefSchema.nullable(),
      observation: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .nullable(),
      adoptExternal: z.boolean(),
    })
    .strict(),
  'skill.fork': z.object({ id }).strict(),
  'skill.relocate': z
    .object({ id, path: z.string().min(1).max(4096), reviewed: z.literal(true) })
    .strict(),
};
