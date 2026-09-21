import yauzl from 'yauzl';
import { validateFlow } from '../core/validate';
import { materializeFlow } from '../../contracts/package-format';
import { transform } from 'esbuild';
import { stat, copyFile, mkdtemp, rm, readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  LIMITS,
  packagePath,
  validatePackage,
  type PackageData,
  type Manifest,
} from '../../contracts/package-format';
import JSZip from 'jszip';
export async function readArchive(path: string): Promise<PackageData> {
  if ((await stat(path)).size > LIMITS.archive) throw new Error('模板压缩包超过 20 MiB');
  return new Promise((resolve, reject) => {
    yauzl.open(
      path,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip) {
          reject(new Error('无法读取模板 ZIP'));
          return;
        }
        const files = new Map<string, Buffer>();
        const seen = new Set<string>();
        let total = 0,
          finished = false;
        const fail = (e: unknown) => {
          if (finished) return;
          finished = true;
          zip.close();
          reject(e);
        };
        zip.on('error', fail);
        zip.on('end', () => {
          if (finished) return;
          try {
            const pkg = validatePackage(files);
            finished = true;
            resolve(pkg);
          } catch (e) {
            fail(e);
          }
        });
        zip.on('entry', (entry) => {
          try {
            const name = packagePath(entry.fileName);
            const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
            if (
              entry.generalPurposeBitFlag & 0x41 ||
              entry.externalFileAttributes & 0x10 ||
              (mode && mode !== 0x8000) ||
              name.endsWith('/')
            )
              throw new Error('包只允许未加密普通文件');
            if (seen.has(name.toLowerCase()) || seen.size >= LIMITS.files)
              throw new Error('包文件重复或数量超限');
            seen.add(name.toLowerCase());
            if (entry.uncompressedSize > LIMITS.file) throw new Error('包文件超过大小上限');
            zip.openReadStream(entry, (err, stream) => {
              if (err || !stream) {
                fail(err || new Error('ZIP 资源不可读'));
                return;
              }
              let length = 0;
              const chunks: Buffer[] = [];
              stream.on('error', fail);
              stream.on('data', (chunk: Buffer) => {
                length += chunk.length;
                total += chunk.length;
                if (length > LIMITS.file || total > LIMITS.total) {
                  stream.destroy();
                  fail(new Error('实际解压大小超过上限'));
                  return;
                }
                chunks.push(chunk);
              });
              stream.on('end', () => {
                if (!finished) {
                  files.set(name, Buffer.concat(chunks));
                  zip.readEntry();
                }
              });
            });
          } catch (e) {
            fail(e);
          }
        });
        zip.readEntry();
      },
    );
  });
}
export async function writeArchive(pkg: PackageData, path: string) {
  validatePackage(pkg.files);
  const zip = new JSZip();
  for (const [name, content] of [...pkg.files].sort(([a], [b]) => a.localeCompare(b)))
    zip.file(name, content, { date: new Date('2000-01-01T00:00:00Z'), createFolders: false });
  const bytes = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    platform: 'UNIX',
  });
  if (bytes.length > LIMITS.archive) throw new Error('模板包超过上限');
  await writeFile(path, bytes, { mode: 0o600 });
}
export type InstalledPackage = { key: string; manifest: Manifest; installedAt: string };
export class PackageLibrary {
  private installing: Promise<unknown> = Promise.resolve();
  private pending = new Map<string, { directory: string; pkg: PackageData }>();
  constructor(
    private root: string,
    private clientVersion: string,
  ) {}
  private compatible(m: Manifest) {
    const parts = (v: string) => v.split('-')[0].split('.').map(Number);
    const a = parts(this.clientVersion),
      b = parts(m.minimumClientVersion);
    let cmp = 0;
    for (let i = 0; i < 3; i++) {
      if (a[i] !== b[i]) {
        cmp = a[i] - b[i];
        break;
      }
    }
    if (cmp < 0 || m.sdkVersion !== '1.0') throw new Error('模板要求更新的客户端或 SDK');
  }
  async inspect(path: string) {
    if (!path.toLowerCase().endsWith('.zip'))
      throw new Error('旧 JSON 模板不再支持，请导入标准模板 ZIP 包');
    await mkdir(join(this.root, '.staging'), { recursive: true });
    const directory = await mkdtemp(join(this.root, '.staging', 'import-'));
    try {
      const fixed = join(directory, 'package.zip');
      await copyFile(path, fixed);
      const pkg = await readArchive(fixed);
      this.compatible(pkg.manifest);
      for (const e of pkg.manifest.entries) {
        const flow = materializeFlow(pkg, e.id);
        validateFlow({ ...flow, requiredCapabilities: [] });
      }
      for (const p of pkg.manifest.scripts)
        await transform(pkg.files.get(p)!.toString('utf8'), { loader: 'js', format: 'esm' });
      const token = randomUUID();
      this.pending.set(token, { directory, pkg });
      return { token, manifest: pkg.manifest };
    } catch (e) {
      await rm(directory, { recursive: true, force: true });
      throw e;
    }
  }
  async cancel(token: string) {
    const p = this.pending.get(token);
    if (p) {
      this.pending.delete(token);
      await rm(p.directory, { recursive: true, force: true });
    }
  }
  install(token: string): Promise<InstalledPackage> {
    const next = this.installing.then(() => this.installOne(token));
    this.installing = next.catch(() => {});
    return next;
  }
  private async installOne(token: string): Promise<InstalledPackage> {
    const p = this.pending.get(token);
    if (!p) throw new Error('导入预览已失效');
    const m = p.pkg.manifest,
      key = m.id + '@' + m.version,
      destination = join(this.root, key);
    try {
      try {
        const old = await this.load(key);
        if (old.manifest.contentDigest !== m.contentDigest) throw new Error('同 ID/版本内容冲突');
        return { key, manifest: old.manifest, installedAt: '' };
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }
      await rename(p.directory, destination);
      return { key, manifest: m, installedAt: new Date().toISOString() };
    } finally {
      await this.cancel(token);
    }
  }
  async load(key: string): Promise<PackageData> {
    if (!/^[a-z][a-z0-9-]{0,99}@[0-9A-Za-z.-]+$/.test(key)) throw new Error('模板标识无效');
    return readArchive(join(this.root, key, 'package.zip'));
  }
  async export(key: string, target: string) {
    await this.load(key);
    await copyFile(join(this.root, key, 'package.zip'), target);
  }
  async remove(key: string) {
    await this.load(key);
    await rm(join(this.root, key), { recursive: true, force: true });
  }
  async dispose() {
    for (const token of [...this.pending.keys()]) await this.cancel(token);
  }
  async cleanStaging() {
    await mkdir(this.root, { recursive: true });
    await rm(join(this.root, '.staging'), { recursive: true, force: true });
  }
}
