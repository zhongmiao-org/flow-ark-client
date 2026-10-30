import { lstat, readdir, realpath, unlink, rmdir, open, statfs } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setImmediate } from 'node:timers/promises';
import { debugLocations, setDebugLocation, checkedDirectory } from './debug-files.mjs';
import type {
  CacheItem,
  CacheScan,
  CachePreview,
  CacheResult,
  CacheCategory,
} from '../shared/cache-management';
import { digest, errorText } from '../shared/utils';
import { Store } from './store';

const inside = (p: string, root: string) => p === root || p.startsWith(root + sep);
const stat = (p: string) => lstat(p, { bigint: true });
type Metadata = Awaited<ReturnType<typeof stat>>;
const identity = (s: Metadata) => `${s.dev}:${s.ino}`;
const signature = (s: Metadata) =>
  [identity(s), s.mode, s.size, s.mtimeNs, s.ctimeNs, s.nlink].join(':');
type Entry = {
  path: string;
  signature: string;
  identity: string;
  dir: boolean;
  link: boolean;
  bytes: number;
  allocated: number;
};
type Scanned = {
  item: CacheItem;
  entries: Entry[];
  signature: string;
  root: string;
  ownerPid?: number;
};
const category = (name: string): CacheCategory =>
  /\.log$/.test(name)
    ? 'log'
    : /profile|sample|\.trace|\.heapsnapshot/.test(name)
      ? 'profile'
      : /copy|test|smoke|preview/.test(name)
        ? 'test-copy'
        : 'unverified';
const exists = async (p: string) =>
  stat(p).catch((e) => {
    if (e.code === 'ENOENT') return undefined;
    throw e;
  });
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code !== 'ESRCH';
  }
};

/** Explicit maintenance only. Never traverses symlinks or recursively removes a mutable tree. */
export class CacheManagement {
  private scans = new Map<string, { scan: CacheScan; entries: Map<string, Scanned> }>();
  private previews = new Map<
    string,
    { value: CachePreview; entries: Scanned[]; expires: number }
  >();
  private clearing = false;
  private referenceCache?: { revision: string; paths: string[]; hashes: Set<string> };
  get compilationLocked() {
    return this.clearing;
  }
  private scanning = false;
  constructor(
    private dataPath: string,
    private store: Store,
    private busy: () => boolean,
    private inMemoryReferences: () => string[] = () => [],
  ) {
    for (const r of store.list<CacheResult>('cache-cleanup'))
      if (r.state === 'pending') store.put('cache-cleanup', r.id, { ...r, state: 'interrupted' });
  }
  locations() {
    return debugLocations();
  }
  async location(path: string) {
    const next = resolve(path);
    const refs = await this.references();
    if (refs.paths.some((p) => inside(next, p) || inside(p, next)))
      throw new Error('此位置与受保护业务目录重叠，请选择专用的调试目录');
    this.scans.clear();
    this.previews.clear();
    return setDebugLocation(next);
  }
  private async references() {
    const generation = this.store.cacheReferenceRevision;
    let cached = this.referenceCache;
    if (!cached || cached.revision !== generation) {
      const paths = new Set<string>([this.dataPath]),
        hashes = new Set<string>();
      const visit = (value: unknown) => {
        if (typeof value === 'string') {
          if (/^[a-f0-9]{64}$/.test(value)) hashes.add(value);
          else if (value.startsWith('/') && value.length < 4096 && !value.includes('\n'))
            paths.add(resolve(value));
        } else if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') Object.values(value).forEach(visit);
      };
      let count = 0;
      for (const record of this.store.cacheReferenceDocuments()) {
        visit(record);
        if (++count % 200 === 0) await setImmediate();
      }
      if (generation !== this.store.cacheReferenceRevision)
        throw new Error('引用在核对期间发生变化，请重新扫描');
      cached = { revision: generation, paths: [...paths], hashes };
      this.referenceCache = cached;
    }
    // Re-resolve live filesystem aliases even when the protected document set
    // is unchanged; a moved binding must not reuse its previous real path.
    const paths = new Set([...cached.paths, ...this.inMemoryReferences()]),
      hashes = cached.hashes;
    for (const p of [...paths]) {
      try {
        paths.add(await realpath(p));
      } catch {
        /* Keep the configured path protected even while absent. */
      }
    }
    // A generic OS temporary root is a capability scope, not proof that every
    // unrelated diagnostic child belongs to a business record. Exact file and
    // more specific directory references remain protected; other old children
    // still require explicit source/purpose review before they can be selected.
    const temporaryRoots = new Set<string>();
    for (const p of ['/private/tmp', tmpdir()]) {
      try {
        temporaryRoots.add(await realpath(p));
      } catch {}
    }
    if (generation !== this.store.cacheReferenceRevision)
      throw new Error('引用在核对期间发生变化，请重新扫描');
    return { paths: [...paths].filter((p) => !temporaryRoots.has(p)), hashes };
  }
  private async usage(): Promise<{ paths: string[]; error?: string }> {
    if (process.platform !== 'darwin')
      return { paths: [], error: '当前系统无法完整核对活动文件占用，已阻止清理' };
    try {
      const { stdout } = await promisify(execFile)(
        '/usr/sbin/lsof',
        ['-nP', '-Fpn', '-a', '-u', String(process.getuid!()), '-S', '2'],
        { timeout: 15000, maxBuffer: 32 * 1024 * 1024 },
      );
      return {
        paths: stdout
          .split('\n')
          .filter((l) => l.startsWith('n/'))
          .map((l) => l.slice(1).replace(/ \(deleted\)$/, '')),
      };
    } catch (e: any) {
      return { paths: [], error: '无法核对活动占用：' + errorText(e).slice(0, 200) };
    }
  }
  private async tree(path: string): Promise<Entry[]> {
    const entries: Entry[] = [];
    const visit = async (p: string) => {
      if (entries.length >= 50000) throw new Error('目录超过 50000 项，请分批整理后重新扫描');
      const s = await stat(p);
      if (process.getuid && s.uid !== BigInt(process.getuid())) throw new Error('文件属于其他用户');
      if (!s.isFile() && !s.isDirectory() && !s.isSymbolicLink())
        throw new Error('包含特殊文件，不能清理');
      const entry: Entry = {
        path: p,
        signature: signature(s),
        identity: identity(s),
        dir: s.isDirectory(),
        link: s.isSymbolicLink(),
        bytes: s.isFile() ? Number(s.size) : 0,
        allocated: s.isFile() && s.nlink === 1n ? Number(s.blocks) * 512 : 0,
      };
      entries.push(entry);
      if (entry.dir) {
        if ((await realpath(p)) !== p) throw new Error('目录经过符号链接，已阻止清理');
        for (const name of (await readdir(p)).sort()) await visit(join(p, name));
        if (signature(await stat(p)) !== entry.signature)
          throw new Error('扫描期间目录发生变化，请重新扫描');
      }
      if (entries.length % 200 === 0) await setImmediate();
    };
    await visit(path);
    return entries;
  }
  private protected(
    path: string,
    refs: Awaited<ReturnType<CacheManagement['references']>>,
    compiled: boolean,
  ) {
    // Compiled cache is inside dataPath, but only hash-addressed, unreferenced files qualify.
    if (compiled)
      return (
        !/^[a-f0-9]{64}\.mjs$/.test(basename(path)) ||
        refs.hashes.has(basename(path, '.mjs')) ||
        refs.paths.some((p) => p === path)
      );
    return refs.paths.some((p) => inside(path, p) || inside(p, path));
  }
  async scan(): Promise<CacheScan> {
    if (this.scanning || this.clearing) throw new Error('正在扫描或清理，请稍后');
    this.scanning = true;
    try {
      const locations = this.locations(),
        warnings: string[] = [],
        roots = new Set<string>();
      const candidates = new Map<string, { root: string; compiled: boolean }>();
      const refs = await this.references(),
        usage = await this.usage();
      const busy = this.busy();
      if (usage.error) warnings.push(usage.error);
      for (const input of [
        ...locations.roots,
        '/private/tmp',
        tmpdir(),
        join(this.dataPath, 'compiled'),
        resolve('test-results'),
      ]) {
        try {
          const root = await realpath(input);
          if (roots.has(root)) continue;
          roots.add(root);
          const managed = locations.roots.includes(input),
            compiled = input === join(this.dataPath, 'compiled');
          if ((await stat(root)).isDirectory())
            for (const name of await readdir(root)) {
              if (name.startsWith('.') && !compiled) continue;
              if (
                !managed &&
                !compiled &&
                root !== resolve('test-results') &&
                !/^(?:flowark[-_]|template-ui-)/i.test(name)
              )
                continue;
              candidates.set(join(root, name), { root, compiled });
            }
        } catch (e: any) {
          if (e.code !== 'ENOENT') warnings.push(`${input}：${errorText(e)}`);
        }
      }
      const entries = new Map<string, Scanned>();
      for (const [path, origin] of candidates) {
        const id = digest(path);
        const item: CacheItem = {
          id,
          path,
          category: origin.compiled ? 'compiled' : category(basename(path)),
          purpose: '未登记来源与用途',
          status: 'unverified',
          reason: '待确认；请先核对来源与用途',
          files: 0,
          bytes: 0,
          allocatedBytes: 0,
        };
        let list: Entry[] = [],
          ownerPid: number | undefined;
        let registeredSource = false;
        try {
          const rootStat = await stat(path);
          if (rootStat.isSymbolicLink()) throw new Error('根项目是符号链接，已阻止清理');
          if (
            this.protected(path, refs, origin.compiled) ||
            (!origin.compiled && /backup|备份|\.zip$|正式|formal|bridge/i.test(basename(path)))
          ) {
            item.status = 'protected';
            item.reason = '受保护的业务引用、备份、导出文件或固定快照';
          } else if (origin.compiled) {
            item.status = 'ready';
            item.purpose = '没有固定快照引用的编译残留';
            item.reason = '将于执行前重新核对引用';
          } else {
            const adopted = this.store.get<{
              identity: string;
              signature: string;
              purpose: string;
              category: CacheCategory;
            }>('cache-registration', id);
            let registered: any;
            if (rootStat.isDirectory()) {
              const metadata = join(path, '.flowark-debug.json'),
                ms = await exists(metadata);
              if (ms) {
                const handle = await open(metadata, constants.O_RDONLY | constants.O_NOFOLLOW);
                try {
                  if ((await handle.stat()).size > 16384) throw new Error('登记文件异常');
                  registered = JSON.parse(await handle.readFile('utf8'));
                } finally {
                  await handle.close();
                }
              }
            }
            if (
              registered?.version === 1 &&
              registered.path === path &&
              registered.identity === identity(rootStat) &&
              typeof registered.purpose === 'string' &&
              Number.isSafeInteger(registered.ownerPid)
            ) {
              registeredSource = true;
              ownerPid = registered.status === 'active' ? registered.ownerPid : undefined;
              item.category = ['temporary', 'log', 'profile', 'test-copy'].includes(
                registered.category,
              )
                ? registered.category
                : 'temporary';
              item.purpose = registered.purpose;
              item.status = 'ready';
              item.reason = '用途已登记；执行前复核占用';
              if (ownerPid && alive(ownerPid)) {
                item.status = 'active';
                item.reason = '登记的所属进程仍活动';
              }
            } else if (adopted?.identity === identity(rootStat)) {
              item.purpose = adopted.purpose;
              item.category = adopted.category;
              item.status = 'ready';
              item.reason = '已由使用者核对来源和用途';
            }
          }
          list = await this.tree(path);
          if (
            item.status === 'unverified' &&
            list.some((e) => /\.zip$|backup|备份/i.test(basename(e.path)))
          ) {
            item.status = 'protected';
            item.reason = '未登记目录中含有导出文件或备份，不能作为缓存清理';
          }
          if (item.status === 'ready' && !registeredSource && !origin.compiled) {
            const adopted = this.store.get<{ signature: string }>('cache-registration', id);
            if (adopted?.signature !== digest(list)) {
              item.status = 'unverified';
              item.reason = '已登记项目内容有变化，请重新核对用途';
            }
          }
          item.files = list.filter((e) => !e.dir).length;
          item.bytes = list.reduce((n, e) => n + e.bytes, 0);
          item.allocatedBytes = list.reduce((n, e) => n + e.allocated, 0);
          if (item.status !== 'protected') {
            if (usage.paths.some((p) => inside(p, path))) {
              item.status = 'active';
              item.reason = '文件或目录仍被进程占用';
            } else if (usage.error) {
              item.status = 'blocked';
              item.reason = usage.error;
            } else if (origin.compiled && busy) {
              item.status = 'active';
              item.reason = '运行或调试仍活动，暂不清理编译缓存';
            }
          }
        } catch (e) {
          item.status = 'blocked';
          item.reason = errorText(e);
        }
        entries.set(id, {
          item,
          entries: list,
          signature: digest(list),
          root: origin.root,
          ownerPid,
        });
      }
      const scan: CacheScan = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        root: locations.current,
        roots: [...roots],
        items: [...entries.values()].map((e) => e.item),
        warnings,
      };
      this.scans.clear();
      this.previews.clear();
      this.scans.set(scan.id, { scan, entries });
      return scan;
    } finally {
      this.scanning = false;
    }
  }
  async adopt(
    scanId: string,
    id: string,
    purpose: string,
    category: CacheCategory,
    reviewed: boolean,
  ) {
    const entry = this.scans.get(scanId)?.entries.get(id);
    if (!reviewed || !entry || entry.item.status !== 'unverified' || !entry.entries.length)
      throw new Error('请重新扫描并核对待确认项目');
    if (digest(await this.tree(entry.item.path)) !== entry.signature)
      throw new Error('项目在扫描后发生变化，请重新扫描并核对');
    this.store.put('cache-registration', id, {
      identity: entry.entries[0].identity,
      signature: entry.signature,
      purpose,
      category,
    });
    this.previews.clear();
    return true;
  }
  async preview(scanId: string, ids: string[]): Promise<CachePreview> {
    const scan = this.scans.get(scanId);
    if (!scan || Date.now() - Date.parse(scan.scan.createdAt) > 10 * 60 * 1000)
      throw new Error('扫描已过期，请重新扫描');
    const entries = [...new Set(ids)].map((id) => scan.entries.get(id));
    if (!entries.length || entries.some((e) => !e || e.item.status !== 'ready'))
      throw new Error('所选项目包含活动、受保护或未核对项目');
    const known = entries as Scanned[];
    for (const e of known)
      if (digest(await this.tree(e.item.path)) !== e.signature)
        throw new Error('清单在扫描后发生变化，请重新扫描');
    const value: CachePreview = {
      token: randomUUID(),
      items: known.map((e) => e.item),
      bytes: known.reduce((n, e) => n + e.item.allocatedBytes, 0),
      files: known.flatMap((e) =>
        e.entries
          .filter((f) => !f.dir)
          .map((f) => ({ path: f.path, bytes: f.bytes, link: f.link })),
      ),
    };
    this.previews.set(value.token, { value, entries: known, expires: Date.now() + 10 * 60 * 1000 });
    return value;
  }
  async clear(token: string, reviewed: boolean): Promise<CacheResult> {
    if (!reviewed) throw new Error('请先核对准确清单');
    const prior = this.store.get<CacheResult>('cache-cleanup', token);
    if (prior) return prior;
    if (this.clearing || this.scanning) throw new Error('正在扫描或清理，请稍后');
    const preview = this.previews.get(token);
    if (!preview || preview.expires < Date.now()) throw new Error('清理预览已过期，请重新扫描');
    this.clearing = true;
    const result: CacheResult = { id: token, state: 'pending', results: [] };
    try {
      this.store.put('cache-cleanup', token, result);
      let refs = await this.references(),
        referenceRevision = this.store.cacheReferenceRevision;
      for (const entry of preview.entries) {
        if (referenceRevision !== this.store.cacheReferenceRevision) {
          refs = await this.references();
          referenceRevision = this.store.cacheReferenceRevision;
        }
        const usage = await this.usage();
        const row: CacheResult['results'][number] = {
          id: entry.item.id,
          path: entry.item.path,
          status: 'skipped',
          reason: '',
          releasedBytes: 0,
        };
        result.results.push(row);
        try {
          const volumeBefore = await statfs(entry.root);
          const compiled = entry.item.category === 'compiled';
          if (usage.error) throw new Error(usage.error);
          if (
            (compiled && this.busy()) ||
            (entry.ownerPid && alive(entry.ownerPid)) ||
            usage.paths.some((p) => inside(p, row.path))
          )
            throw new Error('仍有活动占用，已跳过');
          if (this.protected(row.path, refs, compiled))
            throw new Error('项目已有受保护引用，已跳过');
          if (
            (await realpath(entry.root)) !== entry.root ||
            (await realpath(dirname(row.path))) !== entry.root
          )
            throw new Error('项目父目录或路径已变化，已跳过');
          const current = await this.tree(row.path);
          if (digest(current) !== entry.signature)
            throw new Error('项目身份或内容已变化，请重新扫描');
          row.status = 'failed';
          for (const f of [...current].reverse()) {
            if ((await realpath(dirname(f.path))) !== dirname(f.path))
              throw new Error('父目录已变化，停止清理');
            const s = await stat(f.path);
            if (
              identity(s) !== f.identity ||
              (!f.dir && signature(s) !== f.signature) ||
              s.isSymbolicLink() !== f.link
            )
              throw new Error('文件身份已变化，停止清理');
            if (f.dir) await rmdir(f.path);
            else {
              await unlink(f.path);
              row.releasedBytes += f.allocated;
              this.store.put('cache-cleanup', token, result);
            }
          }
          row.status = 'success';
          row.reason = '清理完成';
          const volumeAfter = await statfs(entry.root);
          row.availableBytesChange =
            volumeAfter.bavail * volumeAfter.bsize - volumeBefore.bavail * volumeBefore.bsize;
        } catch (e) {
          row.reason = errorText(e);
        }
        this.store.put('cache-cleanup', token, result);
        for (const saved of this.scans.values()) {
          const attempted = saved.entries.get(row.id);
          if (attempted) {
            attempted.item.status = 'blocked';
            attempted.item.reason = '此项目已执行清理，请重新扫描核对剩余文件';
          }
        }
      }
      result.state = 'completed';
      this.store.put('cache-cleanup', token, result);
      this.previews.delete(token);
      return result;
    } finally {
      this.clearing = false;
    }
  }
  status() {
    return this.store.list<CacheResult>('cache-cleanup').slice(-10).reverse();
  }
  reveal(scanId: string, id: string) {
    const entry = this.scans.get(scanId)?.entries.get(id);
    if (!entry) throw new Error('扫描已过期，请重新扫描');
    return entry.item.path;
  }
  rootPath() {
    return checkedDirectory(this.locations().current, true);
  }
}
