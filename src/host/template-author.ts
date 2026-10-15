import { randomBytes } from 'node:crypto';
import type { Store } from './store';
import type { PackageLibrary } from '../templates/archive';
import { archiveBytes } from '../templates/archive';
import { assertSchema } from '../../contracts/package-format';
import { validateConfigurationSchema } from '../../contracts/configuration-schema';
import {
  compileAuthor,
  expandAuthorFlow,
  authorFromPackage,
  neutralFlow,
  authorInputFlow,
} from '../templates/author-compiler';
import { validateAuthorDefinition } from '../../contracts/template-authoring';
import { canonical, sha256, type PackageData } from '../../contracts/package-format';
import {
  newAuthorEntry,
  promptMarker,
  assertAuthorDraft,
  assertAuthorReceipt,
  type AuthorDefinition,
  type AuthorDraft,
  type AuthorCheckout,
  type AuthorReceipt,
} from '../shared/template-author';
import { digest, uid, now } from '../shared/utils';
import { validateFlow, walk } from '../core/validate';
import type { FlowRecord, Flow } from '../shared/types';
import { parameterSchema } from '../templates/export-boundaries';
import { resolveParameterSources } from '../shared/parameter-sources';
import type { TemplateData } from './template-data';
import { exportTarget, writeExport, readExport, type ExportTarget } from './author-export-files';
type ExportOperation = { receipt: AuthorReceipt; token: string; target?: ExportTarget };
type Preview = { id: string; revision: number; expires: number; pkg: PackageData; bytes: Buffer };
type Adoption = {
  id: string;
  revision: number;
  expires: number;
  checkoutId: string;
  flowSha: string;
  definition: AuthorDefinition;
};
export class TemplateAuthor {
  schema(value: unknown, form: boolean) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Buffer.byteLength(JSON.stringify(value)) > 2 * 1048576
    )
      throw Error('Schema须为有界对象');
    assertSchema(value);
    if (form) validateConfigurationSchema(value);
    return { valid: true };
  }
  private previews = new Map<string, Preview>();
  private adoptions = new Map<string, Adoption>();
  private pending = new Map<string, Buffer>();
  private working = new Set<string>();
  private closed = false;
  private queue: Promise<unknown> = Promise.resolve();
  private jobs = new Set<Promise<unknown>>();
  constructor(
    private store: Store,
    private library: PackageLibrary,
    private available: () => void,
    private data?: TemplateData,
  ) {
    for (const op of store.list<ExportOperation>('author-export')) {
      if (op.receipt.status === 'choosing') {
        op.receipt.status = 'cancelled';
        this.persist(op);
      } else if (op.receipt.status === 'writing') {
        op.receipt.status = 'unknown';
        op.receipt.error = '上次导出已中断，请明确核对原操作；未自动重新写出';
        this.persist(op);
      }
    }
  }
  private active() {
    if (this.closed) throw Error('模板制作服务正在退出');
    this.available();
  }
  private async serial<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.queue.catch(() => {}).then(fn);
    this.queue = job;
    this.jobs.add(job);
    try {
      return await job;
    } finally {
      this.jobs.delete(job);
    }
  }
  private draft(id: string, revision?: number) {
    const d = this.store.get<AuthorDraft>('author-draft', id);
    if (!d) throw Error('制作草稿不存在');
    assertAuthorDraft(d);
    if (revision !== undefined && d.revision !== revision)
      throw Error('制作草稿已变化，当前输入保留；请读取新修订后对照合并');
    return d;
  }
  private saveDraft(d: AuthorDraft) {
    validateAuthorDefinition(d.definition);
    assertAuthorDraft(d);
    this.store.put('author-draft', d.id, d);
    return structuredClone(d);
  }
  list() {
    return this.store.list<AuthorDraft>('author-draft').map((d) => ({
      id: d.id,
      revision: d.revision,
      name: d.definition.metadata.name,
      entries: d.definition.entries.length,
      updatedAt: d.updatedAt,
    }));
  }
  detail(id: string) {
    const draft = this.draft(id);
    return {
      draft,
      checkouts: this.store.list<AuthorCheckout>('author-checkout').filter((c) => c.draftId === id),
      exports: this.store
        .list<ExportOperation>('author-export')
        .filter((o) => o.receipt.draftId === id)
        .map((o) => o.receipt)
        .slice(-100),
    };
  }
  async create(requestId: string, key?: string) {
    return this.serial(async () => {
      this.active();
      const prior = this.store.get<{ key: string | null; id: string }>('author-create', requestId);
      if (prior) {
        if (prior.key !== (key ?? null)) throw Error('创建请求身份已用于其他来源');
        return this.draft(prior.id);
      }
      if (this.store.list('author-draft').length >= 1000) throw Error('制作草稿数量已达上限');
      const id = uid(),
        identity = 'local-' + uid();
      const definition: AuthorDefinition = key
        ? authorFromPackage(await this.library.load(key), identity)
        : {
            version: 1,
            metadata: {
              id: identity,
              name: '未命名模板',
              description: '',
              version: '1.0.0',
              author: 'local',
              source: 'local',
              minimumClientVersion: '0.3.0',
            },
            configurationSchema: { type: 'object', properties: {}, additionalProperties: false },
            stateSchema: { type: 'object', properties: {}, additionalProperties: false },
            entries: [],
            resources: [],
            actions: [],
            prompts: [],
            readme: '',
            assets: [],
            dependencies: [],
          };
      this.active();
      const d: AuthorDraft = {
        version: 1,
        id,
        revision: 1,
        definition,
        createdAt: now(),
        updatedAt: now(),
      };
      this.store.tx(() => {
        this.saveDraft(d);
        this.store.put('author-create', requestId, { key: key ?? null, id });
      });
      return d;
    });
  }
  save(id: string, revision: number, definition: AuthorDefinition) {
    this.active();
    validateAuthorDefinition(definition);
    const old = this.draft(id, revision);
    if (old.revision >= Number.MAX_SAFE_INTEGER - 2) throw Error('制作草稿修订超限');
    const d = {
      ...old,
      definition: structuredClone(definition),
      revision: old.revision + 1,
      updatedAt: now(),
    };
    this.previews.forEach((p, k) => {
      if (p.id === id) this.previews.delete(k);
    });
    return this.saveDraft(d);
  }
  checkout(id: string, revision: number, entryId: string, requestId: string) {
    this.active();
    const prior = this.store.get<AuthorCheckout>('author-checkout', requestId);
    if (prior) {
      if (prior.draftId !== id || prior.entryId !== entryId || prior.baseRevision !== revision)
        throw Error('编排副本请求已用于其他入口');
      return this.checkoutValue(prior);
    }
    const d = this.draft(id, revision),
      entry = d.definition.entries.find((e) => e.id === entryId);
    if (!entry) throw Error('制作入口不存在');
    const flow = authorInputFlow(entry, expandAuthorFlow(d.definition, entry));
    flow.id = uid();
    flow.name = (d.definition.metadata.name + ' · ' + entry.name + ' · 编排副本').slice(0, 200);
    const record: FlowRecord = {
      id: flow.id,
      flow,
      bindings: { files: {}, credentials: [] },
      updatedAt: now(),
    };
    const checkout: AuthorCheckout = {
      version: 1,
      id: requestId,
      draftId: id,
      entryId,
      baseRevision: revision,
      flowId: flow.id,
      baseFlowSha256: digest(flow),
      createdAt: now(),
    };
    this.store.tx(() => {
      this.store.put('flow', record.id, record);
      this.store.put('author-checkout', checkout.id, checkout);
      this.data?.createDebug(checkout, d);
    });
    return { checkout, record };
  }
  private checkoutValue(c: AuthorCheckout) {
    const record = this.store.get<FlowRecord>('flow', c.flowId);
    if (!record) throw Error('编排副本不存在');
    return { checkout: c, record };
  }
  origin(flowId: string) {
    const c = this.store.list<AuthorCheckout>('author-checkout').find((c) => c.flowId === flowId);
    return c ? { checkout: c, draft: this.draft(c.draftId) } : null;
  }
  source(flowId: string) {
    const r = this.store.get<FlowRecord>('flow', flowId);
    if (!r) throw Error('来源流程不存在');
    return {
      flow: neutralFlow(r.flow),
      inputSchema: parameterSchema(resolveParameterSources(r.flow)),
    };
  }
  adoption(checkoutId: string, revision: number, detach: string[]) {
    this.active();
    const c = this.store.get<AuthorCheckout>('author-checkout', checkoutId);
    if (!c) throw Error('编排副本身份不存在');
    const d = this.draft(c.draftId, revision),
      entry = d.definition.entries.find((e) => e.id === c.entryId);
    if (!entry) throw Error('制作入口已删除');
    const record = this.checkoutValue(c).record,
      flow = neutralFlow(record.flow),
      steps = walk(flow.steps),
      issues: { nodeId: string; promptId: string; reason: string }[] = [];
    for (const id of detach)
      if (!entry.promptBindings.some((b) => b.nodeId === id))
        throw Error('解除绑定目标不在本入口中');
    const bindings = entry.promptBindings.filter((b) => !detach.includes(b.nodeId));
    for (const b of bindings) {
      const n = steps.find((n) => n.id === b.nodeId),
        p = d.definition.prompts.find((p) => p.id === b.promptId);
      if (
        !n ||
        !p ||
        !['ai', 'conversation'].includes(n.type) ||
        !('instructions' in n) ||
        n.instructions !== p.body
      ) {
        issues.push({
          nodeId: b.nodeId,
          promptId: b.promptId,
          reason: '副本正文或目标与当前公共提示词不一致，请修改规程或明确解除绑定',
        });
      } else n.instructions = promptMarker(p.id);
    }
    if (issues.length)
      return {
        status: 'blocked',
        issues,
        flow: record.flow,
        base: entry.flow,
        revision: d.revision,
        entryId: entry.id,
      };
    const definition = structuredClone(d.definition),
      next = definition.entries.find((e) => e.id === entry.id)!;
    next.flow = flow as any;
    next.promptBindings = bindings;
    validateAuthorDefinition(definition);
    const token = randomBytes(32).toString('hex');
    this.adoptions.set(token, {
      id: d.id,
      revision,
      expires: Date.now() + 300000,
      checkoutId,
      flowSha: digest(record.flow),
      definition,
    });
    this.prune();
    return {
      status: 'ready',
      token,
      revision,
      flow: record.flow,
      base: entry.flow,
      definition: next.flow,
      entryId: entry.id,
      suggestedInputSchema: parameterSchema(record.flow.parameters),
      detached: detach,
    };
  }
  adopt(id: string, revision: number, token: string, requestId: string) {
    this.active();
    const prior = this.store.get<{
      id: string;
      revision: number;
      token: string;
      result: AuthorDraft;
    }>('author-adoption', requestId);
    if (prior) {
      if (prior.id !== id || prior.revision !== revision || prior.token !== token)
        throw Error('采用请求身份已用于其他内容');
      return prior.result;
    }
    const p = this.adoptions.get(token);
    if (!p || p.expires < Date.now() || p.id !== id || p.revision !== revision)
      throw Error('带回核对已失效，请重新检查');
    this.draft(id, revision);
    const c = this.store.get<AuthorCheckout>('author-checkout', p.checkoutId)!;
    if (digest(this.checkoutValue(c).record.flow) !== p.flowSha)
      throw Error('编排副本已变化，请重新核对带回');
    let result!: AuthorDraft;
    this.store.tx(() => {
      result = this.save(id, revision, p.definition);
      this.store.put('author-adoption', requestId, { id, revision, token, result });
    });
    this.adoptions.delete(token);
    return result;
  }
  private prune() {
    for (const [k, p] of this.adoptions) if (p.expires < Date.now()) this.adoptions.delete(k);
    while (this.adoptions.size > 30) this.adoptions.delete(this.adoptions.keys().next().value!);
    for (const [k, p] of this.previews) if (p.expires < Date.now()) this.previews.delete(k);
    while (
      this.previews.size > 4 ||
      [...this.previews.values()].reduce((s, p) => s + p.bytes.length, 0) > 40 * 1048576
    )
      this.previews.delete(this.previews.keys().next().value!);
  }
  private async identity(pkg: PackageData) {
    const m = pkg.manifest,
      key = m.id + '@' + m.version;
    try {
      const old = await this.library.load(key);
      if (old.manifest.contentDigest !== m.contentDigest)
        throw Error('本机已安装同标识同版本的不同内容，请修改版本或标识');
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
    for (const o of this.store.list<ExportOperation>('author-export'))
      if (
        ['choosing', 'writing', 'written', 'unknown'].includes(o.receipt.status) &&
        o.receipt.package.id === m.id &&
        o.receipt.package.version === m.version &&
        o.receipt.package.contentDigest !== m.contentDigest
      )
        throw Error('该标识和版本已用于其他导出内容，请修改版本或标识');
  }
  async preview(id: string, revision: number) {
    this.active();
    const d = this.draft(id, revision),
      pkg = await compileAuthor(d.definition),
      bytes = await archiveBytes(pkg);
    await this.identity(pkg);
    this.active();
    this.draft(id, revision);
    for (const [k, p] of this.previews) if (p.id === id) this.previews.delete(k);
    const token = randomBytes(32).toString('hex');
    this.previews.set(token, { id, revision, expires: Date.now() + 300000, pkg, bytes });
    this.prune();
    return {
      token,
      revision,
      manifest: pkg.manifest,
      archiveSha256: sha256(bytes),
      bytes: bytes.length,
      files: pkg.manifest.files,
    };
  }
  private previewValue(id: string, token: string, revision?: number) {
    const p = this.previews.get(token);
    if (
      !p ||
      p.id !== id ||
      p.expires < Date.now() ||
      (revision !== undefined && p.revision !== revision)
    )
      throw Error('导出核对已过期，请重新检查');
    this.draft(id, p.revision);
    return p;
  }
  file(id: string, token: string, path: string) {
    const p = this.previewValue(id, token),
      bytes = p.pkg.files.get(path);
    if (!bytes) throw Error('文件不在本次固定包中');
    if (bytes.length > 1048576)
      return {
        kind: 'binary',
        size: bytes.length,
        sha256: sha256(bytes),
        reason: '文件超过文本预览上限，完整内容仍包含于固定包',
      };
    try {
      return {
        kind: 'text',
        text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
        size: bytes.length,
        sha256: sha256(bytes),
      };
    } catch {
      return {
        kind: 'binary',
        size: bytes.length,
        sha256: sha256(bytes),
        reason: '二进制资源仅显示身份与大小',
      };
    }
  }
  private persist(op: ExportOperation) {
    op.receipt.updatedAt = now();
    assertAuthorReceipt(op.receipt);
    this.store.put('author-export', op.receipt.id, op);
    return structuredClone(op.receipt);
  }
  private operation(id: string, requestId: string) {
    const op = this.store.get<ExportOperation>('author-export', requestId);
    if (!op || op.receipt.draftId !== id) throw Error('导出操作不存在');
    return op;
  }
  begin(args: { id: string; revision: number; token: string; requestId: string }) {
    return this.serial(async () => {
      this.active();
      if (this.store.get('author-export-revoked', args.requestId))
        throw Error('此导出请求已撤销，请重新核对');
      const prior = this.store.get<ExportOperation>('author-export', args.requestId);
      if (prior) {
        if (
          prior.receipt.draftId !== args.id ||
          prior.receipt.revision !== args.revision ||
          prior.token !== args.token
        )
          throw Error('导出请求身份已用于其他内容');
        return { receipt: prior.receipt, choose: false };
      }
      const p = this.previewValue(args.id, args.token, args.revision);
      await this.identity(p.pkg);
      this.active();
      this.draft(args.id, args.revision);
      if (this.store.list('author-export').length >= 10000) throw Error('导出记录数量超限');
      const receipt: AuthorReceipt = {
        version: 1,
        id: args.requestId,
        draftId: args.id,
        revision: args.revision,
        status: 'choosing',
        package: {
          id: p.pkg.manifest.id,
          version: p.pkg.manifest.version,
          contentDigest: p.pkg.manifest.contentDigest,
        },
        archiveSha256: sha256(p.bytes),
        bytes: p.bytes.length,
        createdAt: now(),
        updatedAt: now(),
      };
      this.persist({ receipt, token: args.token });
      this.pending.set(args.requestId, p.bytes);
      return { receipt, choose: true };
    });
  }
  cancel(id: string, requestId: string) {
    return this.serial(async () => {
      this.active();
      const old = this.store.get<ExportOperation>('author-export', requestId);
      if (!old) {
        this.store.put('author-export-revoked', requestId, { draftId: id });
        return { cancelled: true };
      }
      const op = this.operation(id, requestId);
      if (op.receipt.status === 'choosing') {
        op.receipt.status = 'cancelled';
        this.pending.delete(requestId);
        this.persist(op);
      }
      return { cancelled: op.receipt.status === 'cancelled', receipt: op.receipt };
    });
  }
  async write(id: string, requestId: string, path: string) {
    if (this.working.has(requestId)) return this.operation(id, requestId).receipt;
    this.working.add(requestId);
    const job = this.performWrite(id, requestId, path);
    this.jobs.add(job);
    try {
      return await job;
    } finally {
      this.working.delete(requestId);
      this.jobs.delete(job);
      this.pending.delete(requestId);
    }
  }
  private async performWrite(id: string, requestId: string, path: string) {
    const op = this.operation(id, requestId);
    if (op.receipt.status !== 'choosing') return op.receipt;
    let started = false;
    try {
      this.active();
      const bytes = this.pending.get(requestId);
      if (!bytes) throw Error('导出字节已失效，请重新核对');
      this.previewValue(id, op.token, op.receipt.revision);
      const target = await exportTarget(path);
      this.active();
      this.previewValue(id, op.token, op.receipt.revision);
      if (this.operation(id, requestId).receipt.status !== 'choosing') throw Error('导出已撤销');
      op.target = target;
      op.receipt.destination = target.path;
      op.receipt.status = 'writing';
      this.persist(op);
      started = true;
      await writeExport(
        target,
        bytes,
        () => this.active(),
        (file) => {
          target.file = file;
          this.persist(op);
        },
      );
      this.active();
      op.receipt.status = 'written';
      op.receipt.completedAt = now();
      delete op.receipt.error;
      return this.persist(op);
    } catch (e) {
      if (!this.closed) {
        const current = this.operation(id, requestId);
        if (!started && current.receipt.status !== 'choosing') return current.receipt;
        op.receipt.status = started ? 'unknown' : 'failed';
        op.receipt.error = started
          ? '导出回执未确认，请核对原操作；不会自动重写'
          : e instanceof Error
            ? e.message
            : '导出未开始';
        if (!started) delete op.receipt.destination;
        return this.persist(op);
      }
      throw Error('导出服务已停止，请重开后核对原操作');
    }
  }
  async inspect(id: string, requestId: string) {
    this.active();
    const op = this.operation(id, requestId);
    if (this.working.has(requestId) || !['unknown', 'writing'].includes(op.receipt.status))
      return op.receipt;
    if (!op.target) throw Error('原导出目标记录不完整');
    const r = await readExport(op.target, op.receipt.bytes, op.receipt.archiveSha256);
    this.active();
    op.receipt.status = r.complete ? 'written' : 'failed';
    if (r.complete) {
      op.receipt.completedAt = now();
      delete op.receipt.error;
    } else op.receipt.error = r.reason;
    return this.persist(op);
  }
  async stop() {
    await Promise.race([
      Promise.allSettled([...this.jobs]),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
    this.closed = true;
    for (const op of this.store.list<ExportOperation>('author-export'))
      if (op.receipt.status === 'writing') {
        op.receipt.status = 'unknown';
        op.receipt.error = '应用退出时导出回执未确认，请核对原操作';
        this.persist(op);
      }
    this.previews.clear();
    this.adoptions.clear();
    this.pending.clear();
  }
}
