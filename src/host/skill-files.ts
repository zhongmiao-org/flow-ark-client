import { constants } from 'node:fs';
import { open, realpath, lstat, mkdir, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { canonical, digest } from '../shared/utils';
import {
  assertSkillRef,
  assertSkillDraft,
  assertSkillVersion,
  assertSkillManifest,
  skillKey,
  type SkillVersionRef,
  type SkillVersion,
  type SkillDraft,
  type SkillManifest,
} from '../shared/skill';
export const byteDigest = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
export type Workspace = { path: string; dev: string; ino: string };
export class SkillFileError extends Error {}
const fail = (message: string): never => {
  throw new SkillFileError(message);
};
const same = (a: { dev: bigint; ino: bigint }, b: { dev: string; ino: string }) =>
  String(a.dev) === b.dev && String(a.ino) === b.ino;
export async function workspace(path: string): Promise<Workspace> {
  try {
    const actual = await realpath(path),
      s = await lstat(path, { bigint: true });
    if (!s.isDirectory() || s.isSymbolicLink()) fail('Skill工作区须为普通目录，不能使用链接');
    return { path: actual, dev: String(s.dev), ino: String(s.ino) };
  } catch (e) {
    if (e instanceof SkillFileError) throw e;
    return fail('Skill工作区不可读取，请重新选择目录');
  }
}
async function rootCheck(w: Workspace) {
  const current = await workspace(w.path);
  if (current.path !== w.path || current.dev !== w.dev || current.ino !== w.ino)
    fail('Skill工作区身份已变化');
}
async function chain(w: Workspace, key: string, versionId?: string, create = false) {
  await rootCheck(w);
  skillKey(key);
  const rows: { path: string; dev: string; ino: string }[] = [];
  for (const part of ['flowark-skills', key, ...(versionId ? [versionId] : [])]) {
    const path = join(rows.at(-1)?.path ?? w.path, part);
    if (create)
      try {
        await mkdir(path, { mode: 0o700 });
      } catch (e: any) {
        if (e.code !== 'EEXIST') throw e;
      }
    const s = await lstat(path, { bigint: true });
    if (!s.isDirectory() || s.isSymbolicLink()) fail('Skill版本路径不是普通目录');
    rows.push({ path, dev: String(s.dev), ino: String(s.ino) });
  }
  const check = async () => {
    await rootCheck(w);
    for (const r of rows) {
      const s = await lstat(r.path, { bigint: true });
      if (!s.isDirectory() || s.isSymbolicLink() || !same(s, r)) fail('Skill版本目录已变化');
    }
  };
  await check();
  return { path: rows.at(-1)!.path, check, rows };
}
async function bounded(path: string) {
  const h = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await h.stat({ bigint: true });
    if (!before.isFile() || before.size > 1048576n) fail('Skill文件须为1MiB以内普通文件');
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let size = 0;
    while (size < buffer.length) {
      const r = await h.read(buffer, size, buffer.length - size, size);
      if (!r.bytesRead) break;
      size += r.bytesRead;
    }
    const after = await h.stat({ bigint: true }),
      current = await lstat(path, { bigint: true });
    if (
      !current.isFile() ||
      current.isSymbolicLink() ||
      !same(current, { dev: String(before.dev), ino: String(before.ino) }) ||
      size !== Number(before.size) ||
      ['size', 'mtimeNs', 'ctimeNs'].some((k) => (before as any)[k] !== (after as any)[k])
    )
      fail('读取期间Skill文件已变化');
    return buffer.subarray(0, size);
  } finally {
    await h.close();
  }
}
function decode(b: Buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return fail('Skill文件不是有效UTF-8文本');
  }
}
function payload(markdown: Buffer, data: Buffer, title: string): SkillDraft {
  const parsed = JSON.parse(decode(data));
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.keys(parsed).sort().join(',') !== 'data,evidence'
  )
    fail('Skill结构化文件字段无效');
  const draft = { title, markdown: decode(markdown), data: parsed.data, evidence: parsed.evidence };
  assertSkillDraft(draft);
  return draft;
}
export async function readSkillFiles(w: Workspace, ref: SkillVersionRef): Promise<SkillVersion> {
  try {
    assertSkillRef(ref);
    const c = await chain(w, ref.key, ref.versionId);
    const bytes = await Promise.all(
      ['SKILL.md', 'data.json', 'manifest.json'].map((p) => bounded(join(c.path, p))),
    );
    await c.check();
    const manifest = JSON.parse(decode(bytes[2]));
    assertSkillManifest(manifest);
    if (
      manifest.key !== ref.key ||
      manifest.versionId !== ref.versionId ||
      digest(manifest) !== ref.sha256
    )
      fail('Skill清单与所选确认版本摘要不匹配');
    for (let i = 0; i < 2; i++) {
      const f = manifest.files.find((f) => f.path === ['SKILL.md', 'data.json'][i])!;
      if (f.byteLength !== bytes[i].length || f.sha256 !== byteDigest(bytes[i]))
        fail('Skill内容已被外部修改');
    }
    const draft = payload(bytes[0], bytes[1], manifest.title);
    const result = {
      version: 1 as const,
      ref,
      parent: manifest.parent,
      confirmedAt: manifest.confirmedAt,
      ...draft,
    };
    assertSkillVersion(result);
    return result;
  } catch (e) {
    if (e instanceof SkillFileError) throw e;
    return fail('Skill版本不可读取或格式无效；原历史快照保留');
  }
}
export async function observeSkill(w: Workspace, ref: SkillVersionRef) {
  await rootCheck(w);
  const observations: unknown[] = [];
  let draft: SkillDraft | undefined;
  try {
    const c = await chain(w, ref.key, ref.versionId);
    const b: Buffer[] = [];
    for (const name of ['SKILL.md', 'data.json', 'manifest.json']) {
      try {
        const bytes = await bounded(join(c.path, name));
        b.push(bytes);
        observations.push({ name, sha256: byteDigest(bytes), size: bytes.length });
      } catch (e: any) {
        b.push(Buffer.alloc(0));
        observations.push({
          name,
          error:
            e instanceof SkillFileError
              ? e.message
              : ['ENOENT', 'EACCES', 'EPERM', 'ELOOP'].includes(e.code)
                ? e.code
                : 'unreadable',
        });
      }
    }
    await c.check();
    try {
      const m = JSON.parse(decode(b[2]));
      assertSkillManifest(m);
      if (m.key === ref.key && m.versionId === ref.versionId) draft = payload(b[0], b[1], m.title);
    } catch {}
  } catch (e: any) {
    observations.push({ directory: e instanceof SkillFileError ? e.message : 'unreadable' });
  }
  return { fingerprint: digest(observations), draft };
}
async function syncDirectory(path: string) {
  const h = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await h.sync();
  } finally {
    await h.close();
  }
}
export async function writeSkillFiles(
  w: Workspace,
  manifest: SkillManifest,
  draft: SkillDraft,
  check: () => void,
) {
  assertSkillDraft(draft);
  assertSkillManifest(manifest);
  const parent = await chain(w, manifest.key, undefined, true);
  check();
  await parent.check();
  const destination = join(parent.path, manifest.versionId);
  await mkdir(destination, { mode: 0o700 });
  const c = await chain(w, manifest.key, manifest.versionId);
  const write = async (name: string, bytes: Buffer) => {
    check();
    await c.check();
    const h = await open(
      join(c.path, name),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await h.writeFile(bytes);
      await h.sync();
    } finally {
      await h.close();
    }
    await c.check();
    check();
  };
  await write('SKILL.md', Buffer.from(draft.markdown));
  await write('data.json', Buffer.from(canonical({ data: draft.data, evidence: draft.evidence })));
  const temp = '.manifest-' + manifest.operationId + '.tmp';
  await write(temp, Buffer.from(canonical(manifest)));
  check();
  await c.check();
  await link(join(c.path, temp), join(c.path, 'manifest.json'));
  await unlink(join(c.path, temp));
  for (const r of [...c.rows].reverse()) await syncDirectory(r.path);
  await syncDirectory(w.path);
  await c.check();
  check();
  const ref = { key: manifest.key, versionId: manifest.versionId, sha256: digest(manifest) };
  return readSkillFiles(w, ref);
}
