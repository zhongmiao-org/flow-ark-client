import {
  ConversationArchiveScan,
  conversationArchiveRoot,
  conversationArchiveRecordHash,
  validateConversationArchiveRecord,
  validateConversationArchiveManifest,
  conversationArchiveRef,
  validateConversationArchiveRef,
  conversationArchiveFirstCursor,
  conversationArchivePageHash,
  validateConversationArchiveCursor,
  validateConversationArchivePage,
} from '../../contracts/conversation-archive';
import type { Store } from './store';
import {
  assertArchiveView,
  type ArchiveOperation,
  type ArchiveView,
  type ArchiveEvent,
  type ConversationArchiveCapture as Capture,
  type ConversationArchiveRecord as Row,
  type ConversationArchiveCursor as Cursor,
  type ConversationArchiveManifest as Manifest,
  type ConversationArchiveRef as Ref,
} from '../shared/conversation-archive';
import type { ConversationSnapshot } from '../shared/conversation';
import type {
  ConversationContext,
  ConversationContextRef,
  ConversationThreadEntry,
} from '../shared/conversation-thread';
import { digest, now, uid, redactedErrorText } from '../shared/utils';

const kinds = {
  operation: 'conversation-archive-operation',
  latest: 'conversation-archive-latest',
  request: 'conversation-archive-request',
  active: 'conversation-archive-active',
  row: 'conversation-archive-row',
  context: 'conversation-archive-context',
  index: 'conversation-archive-request-index',
  manifest: 'conversation-archive-manifest',
  confirmation: 'conversation-archive-confirmation',
};
type Saved = { operation: ArchiveOperation; prepareHash: string };
type Job = { abort: boolean; done: Promise<void> };
const key = (...parts: (string | number)[]) => digest(parts);
const same = (a: unknown, b: unknown) => digest(a) === digest(b);
export class ConversationArchives {
  private jobs = new Map<string, Job>();
  private grants = new Map<
    string,
    { id: string; revision: number; headRevision: number; hash: string; expires: number }
  >();
  constructor(
    private store: Store,
    private deps: {
      available: () => void;
      capture: (id: string, revision?: number) => Capture;
      headRevision: (id: string) => number;
      current: (manifest: Manifest) => void;
      origin: (id: string) => ConversationSnapshot | null;
      context: (id: string, ref: ConversationContextRef) => ConversationContext;
      entry: (id: string, ordinal: number) => ConversationThreadEntry;
      publish: (event: ArchiveEvent) => Promise<unknown>;
    },
  ) {
    const active = store.list<{ id: string }>(kinds.active);
    if (active.length > 1) throw Error('完整来源准备索引异常，未自动继续');
    for (const item of active) {
      const s = this.get(item.id);
      if (s.operation.state === 'preparing') {
        s.operation.state = 'cancelled';
        s.operation.error = '上次准备已中断；进度保留，未自动继续或调用模型。';
        this.write(s, () => store.remove(kinds.active, item.id));
      } else store.remove(kinds.active, item.id);
    }
  }
  private get(operationId: string, sessionId?: string, revision?: number): Saved {
    const s = this.store.get<Saved>(kinds.operation, operationId);
    if (!s || (sessionId && s.operation.sessionId !== sessionId))
      throw Error('完整来源操作不存在或不属于此会话');
    assertArchiveView({
      operation: s.operation,
      headRevision: s.operation.capture.revision,
      current: false,
      currentError: '',
      source:
        s.operation.state === 'confirmed' ? conversationArchiveRef(s.operation.manifest) : null,
    });
    if (revision !== undefined && s.operation.revision !== revision)
      throw Error('来源准备状态已变化，请重新读取');
    return s;
  }
  private view(s: Saved): ArchiveView {
    const o = s.operation,
      headRevision = this.deps.headRevision(o.sessionId);
    let current = false,
      currentError = '';
    try {
      if (o.manifest) this.deps.current(o.manifest);
      else {
        const c = this.deps.capture(o.sessionId),
          strip = (v: Capture) => ({
            ...v,
            revision: 0,
            origin: v.origin ? { ...v.origin, label: '' } : null,
          });
        if (c.revision < o.capture.revision || !same(strip(c), strip(o.capture)))
          throw Error('访谈或资料已变化；本次固定范围保留，可另行准备新来源。');
      }
      current = true;
    } catch (e) {
      currentError = redactedErrorText(e).slice(0, 2000);
    }
    const v: ArchiveView = {
      operation: structuredClone(o),
      headRevision,
      current,
      currentError,
      source: o.state === 'confirmed' ? conversationArchiveRef(o.manifest) : null,
    };
    assertArchiveView(v);
    return v;
  }
  detail(id: string, operationId: string) {
    return this.view(this.get(operationId, id));
  }
  latest(id: string) {
    this.deps.headRevision(id);
    const found = this.store.get<{ id: string }>(kinds.latest, id);
    return found ? this.detail(id, found.id) : null;
  }
  receipt(id: string, requestId: string) {
    this.deps.headRevision(id);
    const r = this.store.get<{ id: string }>(kinds.request, key(id, requestId));
    return r ? this.detail(id, r.id) : null;
  }
  private emit(s: Saved) {
    try {
      const snapshot = this.view(s),
        o = snapshot.operation;
      void this.deps
        .publish({
          kind: 'conversation.archive.snapshot',
          sessionId: o.sessionId,
          archiveId: o.id,
          sequence: o.revision,
          eventId: `archive:${o.id}:${o.revision}`,
          snapshot,
        })
        .catch(() => {});
    } catch {
      /* A readable operation remains durable when its source is temporarily unavailable. */
    }
  }
  private write(s: Saved, extra: () => void = () => {}) {
    if (s.operation.revision >= Number.MAX_SAFE_INTEGER)
      throw Error('来源准备修订达到可表示范围，记录保留');
    s.operation.revision++;
    s.operation.updatedAt = now();
    this.store.tx(() => {
      extra();
      this.store.put(kinds.operation, s.operation.id, s);
    });
    this.emit(s);
  }
  prepare(id: string, revision: number, requestId: string) {
    const requestKey = key(id, requestId),
      prepareHash = digest({ id, revision });
    const old = this.store.get<{ id: string; hash: string }>(kinds.request, requestKey);
    if (old) {
      if (old.hash !== prepareHash) throw Error('准备请求身份已使用，未更换来源');
      return this.detail(id, old.id);
    }
    this.deps.available();
    if (this.jobs.size) throw Error('另一个来源仍在准备或回收，请稍后重新读取');
    const capture = this.deps.capture(id, revision),
      origin = this.deps.origin(id);
    const totalRequests = capture.historyCount + (origin?.attempts.length ?? 0);
    if (!Number.isSafeInteger(totalRequests) || totalRequests < 1)
      throw Error('完整来源请求计数无效');
    const s: Saved = {
      prepareHash,
      operation: {
        version: 1,
        id: uid(),
        sessionId: id,
        requestId,
        revision: 1,
        capture,
        state: 'preparing',
        recordCount: 0,
        requestCount: 0,
        verifiedRecords: 0,
        totalRequests,
        manifest: null,
        confirmedAt: null,
        error: '',
        createdAt: now(),
        updatedAt: now(),
      },
    };
    this.store.tx(() => {
      this.store.put(kinds.operation, s.operation.id, s);
      this.store.put(kinds.request, requestKey, { id: s.operation.id, hash: prepareHash });
      this.store.put(kinds.latest, id, { id: s.operation.id });
      this.store.put(kinds.active, s.operation.id, { id: s.operation.id });
    });
    this.start(s.operation.id);
    return this.view(s);
  }
  private start(operationId: string) {
    const job: Job = { abort: false, done: Promise.resolve() };
    this.jobs.set(operationId, job);
    job.done = this.build(operationId, job).finally(() => this.jobs.delete(operationId));
  }
  private row(operationId: string, ordinal: number): Row {
    const r = this.store.get<Row>(kinds.row, key(operationId, ordinal));
    validateConversationArchiveRecord(r);
    if (!r || r.archiveId !== operationId || r.ordinal !== ordinal)
      throw Error('来源记录身份或位置不一致');
    return r;
  }
  private async build(operationId: string, job: Job) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      let s = this.get(operationId),
        o = s.operation;
      let verified = 0,
        requests = 0,
        previousHash = conversationArchiveRoot(operationId, o.capture),
        position = 0;
      // On resume, an old index row is visible only after its record has been verified again.
      const index = {
        get: (id: string) => {
          const v = this.store.get<{ ordinal: number; ref: ConversationContextRef }>(
            kinds.context,
            key(operationId, id),
          );
          return v && v.ordinal <= verified ? v.ref : undefined;
        },
        put: (ref: ConversationContextRef) => {
          const k = key(operationId, ref.id),
            old = this.store.get(kinds.context, k),
            v = { ordinal: position, ref };
          if (old && !same(old, v)) throw Error('来源资料索引与已保存前缀不一致');
          if (!old) this.store.put(kinds.context, k, v);
        },
        hasRequest: (id: string) => {
          const v = this.store.get<{ ordinal: number }>(kinds.index, key(operationId, id));
          return !!v && v.ordinal <= verified;
        },
        putRequest: (id: string) => {
          const k = key(operationId, id),
            old = this.store.get(kinds.index, k),
            v = { ordinal: position };
          if (old && !same(old, v)) throw Error('来源请求索引与已保存前缀不一致');
          if (!old) this.store.put(kinds.index, k, v);
        },
      };
      const scan = new ConversationArchiveScan(operationId, o.capture, index);
      const copy = async (payload: Row['payload']) => {
        if (job.abort) throw Error('本机来源准备已取消');
        s = this.get(operationId);
        o = s.operation;
        if (o.state !== 'preparing') throw Error('来源准备已停止');
        position = verified + 1;
        const r: Row = {
          version: 1,
          archiveId: operationId,
          ordinal: position,
          previousHash,
          sha256: '',
          payload,
        };
        r.sha256 = conversationArchiveRecordHash(r);
        if (payload.kind === 'origin') requests += payload.snapshot.attempts.length;
        if (payload.kind === 'history') requests++;
        o.recordCount = Math.max(o.recordCount, position);
        o.requestCount = Math.max(o.requestCount, requests);
        o.verifiedRecords = position;
        this.write(s, () => {
          scan.append(r);
          const old = this.store.get<Row>(kinds.row, key(operationId, position));
          if (old) {
            validateConversationArchiveRecord(old);
            if (old.sha256 !== r.sha256) throw Error('已保存来源记录变化，未覆盖');
          } else this.store.put(kinds.row, key(operationId, position), r);
        });
        verified = position;
        previousHash = r.sha256;
        if (verified % 8 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
      };
      const origin = this.deps.origin(o.sessionId);
      if (o.capture.origin) {
        if (!origin) throw Error('固定原访谈缺失，未省略来源');
        await copy({ kind: 'origin', snapshot: origin });
      } else if (origin) throw Error('原访谈身份已变化');
      await copy({ kind: 'context', context: this.deps.context(o.sessionId, o.capture.context) });
      for (let ordinal = 1; ordinal <= o.capture.historyCount; ordinal++) {
        const entry = this.deps.entry(o.sessionId, ordinal);
        if (!index.get(entry.context.id))
          await copy({ kind: 'context', context: this.deps.context(o.sessionId, entry.context) });
        await copy({ kind: 'history', entry });
      }
      if (job.abort) throw Error('本机来源准备已取消');
      s = this.get(operationId);
      o = s.operation;
      const manifest = scan.manifest(o.createdAt) as Manifest;
      if (manifest.requestCount !== o.totalRequests) throw Error('完整来源实际请求数不一致');
      o.manifest = manifest;
      o.state = 'review';
      o.error = '';
      this.write(s, () => this.store.remove(kinds.active, operationId));
    } catch (e) {
      try {
        const s = this.get(operationId);
        if (s.operation.state === 'preparing') {
          s.operation.state = job.abort ? 'cancelled' : 'failed';
          s.operation.manifest = null;
          s.operation.error = job.abort
            ? '准备已停止，进度保留；继续时先核对已保存前缀。'
            : redactedErrorText(e).slice(0, 2000);
          this.write(s, () => this.store.remove(kinds.active, operationId));
        }
      } catch {
        /* Storage fault preserves the last durable state and blocks further writes. */
      }
    }
  }
  cancel(id: string, operationId: string, revision: number) {
    const s = this.get(operationId, id),
      o = s.operation;
    if (revision > o.revision) throw Error('来源操作修订无效');
    if (o.state === 'confirmed') throw Error('已确认来源保持只读，不取消原结果');
    if (o.state === 'cancelled' || o.state === 'failed') return this.view(s);
    const job = this.jobs.get(operationId);
    if (job) job.abort = true;
    o.state = 'cancelled';
    o.manifest = null;
    o.error = '准备已停止，进度保留；未调用模型。';
    this.write(s, () => this.store.remove(kinds.active, operationId));
    return this.view(s);
  }
  resume(id: string, operationId: string, revision: number) {
    this.deps.available();
    if (this.jobs.has(operationId)) return this.detail(id, operationId);
    if (this.jobs.size) throw Error('另一个来源仍在准备或回收');
    const s = this.get(operationId, id, revision);
    if (!['cancelled', 'failed'].includes(s.operation.state)) return this.view(s);
    s.operation.state = 'preparing';
    s.operation.error = '';
    s.operation.verifiedRecords = 0;
    this.write(s, () => this.store.put(kinds.active, operationId, { id: operationId }));
    this.start(operationId);
    return this.view(s);
  }
  page(id: string, operationId: string, cursor: Cursor | null) {
    const s = this.get(operationId, id),
      m = s.operation.manifest;
    if (!m || !['review', 'confirmed'].includes(s.operation.state))
      throw Error('来源尚未准备完整，请先查看进度');
    validateConversationArchiveManifest(m);
    const c = cursor ?? (conversationArchiveFirstCursor(m) as Cursor);
    const previous = c.nextOrdinal === 1 ? null : this.row(operationId, c.nextOrdinal - 1);
    validateConversationArchiveCursor(c, m, previous);
    let rows: Row[] = [],
      result: any;
    for (let ordinal = c.nextOrdinal; ordinal <= m.recordCount && rows.length < 20; ordinal++) {
      const row = this.row(operationId, ordinal),
        next =
          ordinal === m.recordCount
            ? null
            : { source: c.source, nextOrdinal: ordinal + 1, previousHash: row.sha256 };
      const page = { version: 1, cursor: c, records: [...rows, row], next, sha256: '' };
      try {
        page.sha256 = conversationArchivePageHash(page);
      } catch (e) {
        if (rows.length && e instanceof Error && /字节预算|层级或数量超限/.test(e.message)) break;
        throw e;
      }
      rows = page.records;
      result = page;
    }
    if (!result) throw Error('来源页无法在预算内读取，未跳过记录');
    validateConversationArchivePage(result, m, previous);
    return result;
  }
  preview(id: string, operationId: string, revision: number) {
    this.deps.available();
    const s = this.get(operationId, id, revision);
    if (s.operation.state !== 'review' || !s.operation.manifest) throw Error('请先准备完整来源');
    this.deps.current(s.operation.manifest);
    const token = digest(uid() + uid()),
      expires = Date.now() + 300000,
      hash = s.operation.manifest.sha256;
    for (const [key, v] of this.grants)
      if (v.expires <= Date.now() || v.id === operationId) this.grants.delete(key);
    if (this.grants.size >= 32) throw Error('待核对来源过多，请先完成已有操作');
    this.grants.set(token, {
      id: operationId,
      revision,
      headRevision: this.deps.headRevision(id),
      hash,
      expires,
    });
    return {
      operation: this.view(s),
      token,
      sha256: hash,
      expiresAt: new Date(expires).toISOString(),
    };
  }
  confirm(
    id: string,
    operationId: string,
    revision: number,
    requestId: string,
    hash: string,
    token: string,
  ) {
    const k = key(id, operationId, requestId),
      inputHash = digest({ revision, hash });
    const old = this.store.get<{ inputHash: string }>(kinds.confirmation, k);
    if (old) {
      if (old.inputHash !== inputHash) throw Error('确认请求身份已使用');
      return this.detail(id, operationId);
    }
    this.deps.available();
    const s = this.get(operationId, id),
      o = s.operation;
    if (o.state === 'confirmed' && o.manifest?.sha256 === hash) return this.view(s);
    const grant = this.grants.get(token);
    if (
      !grant ||
      grant.id !== operationId ||
      grant.revision !== revision ||
      grant.hash !== hash ||
      grant.expires <= Date.now() ||
      o.revision !== revision ||
      o.state !== 'review' ||
      o.manifest?.sha256 !== hash
    )
      throw Error('来源核对已变化或过期，请重新读取；未确认新结果');
    const manifest = o.manifest;
    validateConversationArchiveManifest(manifest);
    o.state = 'confirmed';
    o.confirmedAt = now();
    this.write(s, () => {
      if (this.deps.headRevision(id) !== grant.headRevision)
        throw Error('访谈修订已变化，请重新核对来源');
      this.deps.current(manifest);
      const last = this.row(operationId, manifest.recordCount);
      if (last.sha256 !== manifest.tailHash) throw Error('固定终点记录缺失或变化');
      this.store.put(kinds.manifest, operationId, manifest);
      this.store.put(kinds.confirmation, k, { inputHash });
    });
    this.grants.delete(token);
    return this.view(s);
  }
  readSource(ref: Ref) {
    const m = this.store.get<Manifest>(kinds.manifest, ref.archiveId);
    validateConversationArchiveRef(ref, m);
    return structuredClone(m!);
  }
  sourceInfo(ref: Ref) {
    const manifest = this.readSource(ref),
      s = this.get(manifest.id, manifest.capture.sessionId);
    if (
      s.operation.state !== 'confirmed' ||
      s.operation.manifest?.sha256 !== manifest.sha256 ||
      !s.operation.confirmedAt
    )
      throw Error('完整来源尚未确认登记');
    return { manifest, confirmedAt: s.operation.confirmedAt };
  }
  sourceRecord(ref: Ref, ordinal: number) {
    const m = this.readSource(ref);
    if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > m.recordCount)
      throw Error('来源记录位置无效');
    const r = this.row(m.id, ordinal);
    if (
      r.previousHash !== (ordinal === 1 ? m.rootHash : this.row(m.id, ordinal - 1).sha256) ||
      (ordinal === m.recordCount && r.sha256 !== m.tailHash)
    )
      throw Error('来源记录与固定清单不符');
    return structuredClone(r);
  }
  async stop() {
    const jobs = [...this.jobs.entries()];
    for (const [id, job] of jobs) {
      job.abort = true;
      try {
        const s = this.get(id);
        this.cancel(s.operation.sessionId, id, s.operation.revision);
      } catch {
        /* durable progress remains */
      }
    }
    await Promise.all(jobs.map(([, job]) => job.done));
  }
}
