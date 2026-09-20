import { lstat, readdir, realpath, rm } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { digest } from '../shared/utils';

const metadata = async (path: string) =>
  lstat(path, { bigint: true }).catch((error) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
const signature = (s: NonNullable<Awaited<ReturnType<typeof metadata>>>) =>
  [s.dev, s.ino, s.mode, s.size, s.mtimeNs, s.ctimeNs].join(':');

/** Only operates on the application's per-run artifact directory, without following links. */
export class ArtifactDirectory {
  constructor(private root: string) {}
  async path(runId: string) {
    if (!/^[\w-]{1,100}$/.test(runId)) throw new Error('运行标识无效');
    const base = await realpath(this.root);
    const parent = join(base, 'artifacts'),
      path = join(parent, runId);
    for (const directory of [parent, path]) {
      const info = await metadata(directory);
      if (
        info &&
        (!info.isDirectory() || info.isSymbolicLink() || (await realpath(directory)) !== directory)
      )
        throw new Error('产物目录异常或为符号链接，已阻止清理');
    }
    return path;
  }
  async scan(runId: string) {
    const path = await this.path(runId);
    const entries: { name: string; signature: string }[] = [];
    const files: { name: string; size: number; link: boolean }[] = [];
    const visit = async (directory: string, relative: string) => {
      const before = await metadata(directory);
      if (!before) {
        if (!relative) return;
        throw new Error('产物目录在预览期间发生变化，请重新预览');
      }
      if (!before.isDirectory() || before.isSymbolicLink())
        throw new Error('产物目录发生变化，请重新预览');
      entries.push({ name: relative, signature: signature(before) });
      for (const name of (await readdir(directory)).sort()) {
        const child = join(directory, name),
          local = relative ? relative + sep + name : name;
        const info = await metadata(child);
        if (!info) throw new Error('产物在预览期间发生变化，请重新预览');
        if (info.isDirectory()) await visit(child, local);
        else {
          if (!info.isFile() && !info.isSymbolicLink())
            throw new Error('产物目录包含特殊文件，已阻止清理');
          entries.push({ name: local, signature: signature(info) });
          files.push({
            name: local,
            size: info.isFile() ? Number(info.size) : 0,
            link: info.isSymbolicLink(),
          });
        }
      }
      const after = await metadata(directory);
      if (!after || signature(after) !== signature(before))
        throw new Error('产物目录在预览期间发生变化，请重新预览');
    };
    await visit(path, '');
    return {
      path,
      files,
      signature: digest(entries),
      bytes: files.reduce((n, f) => n + f.size, 0),
    };
  }
  async remove(runId: string, expected: string) {
    const current = await this.scan(runId);
    if (current.signature !== expected) throw new Error('清理预览已过期，请重新预览');
    await rm(current.path, { recursive: true, force: true, maxRetries: 0 });
    if (await metadata(current.path)) throw new Error('产物目录仍存在，清理未完成');
  }
}
