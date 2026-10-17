/** Immutable full sources. This module never sends AI requests or confers fact/action authority. */
import Ajv from "ajv/dist/2020.js";
import schema from "./p1.schema.json";
import { canonical, sha256 } from "./package-format";
import { confirmedConversationEvidence } from "./skill-trial";
import {
  validateConversationThread,
  validateConversationContext,
  validateConversationEntry,
  conversationThreadSeed,
} from "./continuous-conversation";

export const conversationArchiveCapability = "conversation-archive-v1";
export const CONVERSATION_ARCHIVE_LIMITS = {
  objectBytes: 1024 * 1024,
  recordBytes: 1024 * 1024 + 4096,
  pageBytes: 2 * 1024 * 1024,
  pageRecords: 20,
  depth: 48,
  values: 60000,
};
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema);
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const hash = (v: unknown) => sha256(Buffer.from(canonical(v), "utf8"));
const identity = (v: any) => v && { ...v, label: "" };
const contextRef = (v: any) => ({ id: v.id, sha256: v.sha256 });
function sum(...values: number[]) {
  const value = values.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(value) || value < 0)
    throw Error("完整来源计数超出可表示范围");
  return value;
}
function budget(value: unknown, bytes: number) {
  let count = 0;
  const seen = new Set<object>();
  const unicode = (s: string) => {
    if (
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        Buffer.from(s),
      ) !== s
    )
      throw Error("完整来源含无效Unicode");
  };
  const visit = (v: any, depth: number) => {
    if (
      ++count > CONVERSATION_ARCHIVE_LIMITS.values ||
      depth > CONVERSATION_ARCHIVE_LIMITS.depth
    )
      throw Error("完整来源单个对象层级或数量超限");
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "number" && Number.isFinite(v)) return;
    if (typeof v === "string") {
      unicode(v);
      return;
    }
    if (
      !v ||
      typeof v !== "object" ||
      seen.has(v) ||
      (!Array.isArray(v) &&
        ![null, Object.prototype].includes(Object.getPrototypeOf(v)))
    )
      throw Error("完整来源只接受有限JSON");
    seen.add(v);
    if (
      Array.isArray(v) &&
      (Object.keys(v).length !== v.length ||
        Object.keys(v).some((k, i) => k !== String(i)))
    )
      throw Error("完整来源数组须连续");
    for (const [k, child] of Object.entries(v)) {
      unicode(k);
      if (["__proto__", "prototype", "constructor"].includes(k))
        throw Error("完整来源含保留键");
      visit(child, depth + 1);
    }
    seen.delete(v);
  };
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > bytes)
    throw Error("完整来源单个对象超过字节预算");
}
function shape(
  name: string,
  value: unknown,
  bytes = CONVERSATION_ARCHIVE_LIMITS.objectBytes,
): any {
  budget(value, bytes);
  const check = ajv.getSchema(schema.$id + "#/$defs/" + name)!;
  if (!check(value))
    throw Error(name + "格式无效：" + ajv.errorsText(check.errors));
  return value;
}
function digestBody(v: any) {
  const { sha256: _sha, ...body } = v;
  return hash(body);
}
export function validateConversationArchiveCapture(value: unknown): any {
  const c = shape("ConversationArchiveCapture", value);
  if (
    !c.title.trim() ||
    c.contextRevision > c.revision ||
    (!c.origin && c.historyCount === 0) ||
    (c.origin && c.origin.sessionId !== c.sessionId)
  )
    throw Error("完整来源捕获身份、修订或请求范围无效");
  if (
    !c.historyCount &&
    c.historyHash !== conversationThreadSeed(c.sessionId, c.origin)
  )
    throw Error("完整来源空历史尾摘要无效");
  return c;
}
export function conversationArchiveCapture(
  head: unknown,
  contextRevision: number,
): any {
  const s = validateConversationThread(head);
  if (s.active || s.draft || s.contextProposalId)
    throw Error("请先结束当前请求、保存或清除未发送输入并核对资料变化");
  return validateConversationArchiveCapture({
    version: 1,
    sessionId: s.id,
    title: s.title,
    revision: s.revision,
    contextRevision,
    context: structuredClone(s.context),
    origin: structuredClone(s.origin),
    historyCount: s.historyCount,
    historyHash: s.historyHash,
  });
}
export function conversationArchiveRoot(
  archiveId: string,
  capture: unknown,
): string {
  const c = validateConversationArchiveCapture(capture);
  shape("ConversationArchiveRef", {
    version: 1,
    archiveId,
    sessionId: c.sessionId,
    sha256: "0".repeat(64),
  });
  return hash({ version: 1, archiveId, capture: c });
}
export function conversationArchiveRecordHash(value: unknown): string {
  budget(value, CONVERSATION_ARCHIVE_LIMITS.recordBytes);
  return digestBody(value);
}
export function validateConversationArchiveRecord(value: unknown): any {
  const r = shape(
    "ConversationArchiveRecord",
    value,
    CONVERSATION_ARCHIVE_LIMITS.recordBytes,
  );
  if (r.sha256 !== conversationArchiveRecordHash(r))
    throw Error("完整来源记录摘要不一致");
  const p = r.payload;
  if (p.kind === "context") validateConversationContext(p.context);
  else if (p.kind === "history") validateConversationEntry(p.entry);
  else {
    const s = p.snapshot;
    budget(s, CONVERSATION_ARCHIVE_LIMITS.objectBytes);
    confirmedConversationEvidence(s);
    const used = new Set<string>(),
      users = new Set<string>();
    for (const a of s.attempts) {
      const u = s.messages.filter(
        (m: any) => m.role === "user" && m.turnId === a.turnId,
      );
      const candidates = s.messages.filter(
        (m: any) =>
          m.role === "assistant" &&
          m.turnId === a.turnId &&
          (m.requestId === a.id ||
            (!m.requestId &&
              s.attempts.filter((x: any) => x.turnId === a.turnId).length ===
                1)),
      );
      if (
        u.length !== 1 ||
        u[0].state !== "complete" ||
        !u[0].text.trim() ||
        candidates.length !== 1 ||
        used.has(candidates[0].id) ||
        (a.state === "complete"
          ? candidates[0].state !== "complete" || !candidates[0].text.trim()
          : candidates[0].state !== "partial")
      )
        throw Error("原访谈存在无法核对的请求/用户/助手对应，未猜测或丢弃记录");
      used.add(candidates[0].id);
      users.add(u[0].id);
    }
    if (used.size + users.size !== s.messages.length)
      throw Error("原访谈存在未归属消息，不能标完整来源");
  }
  return r;
}
export function conversationArchiveManifestHash(value: unknown): string {
  budget(value, CONVERSATION_ARCHIVE_LIMITS.objectBytes);
  return digestBody(value);
}
export function validateConversationArchiveManifest(value: unknown): any {
  const m = shape("ConversationArchiveManifest", value),
    c = validateConversationArchiveCapture(m.capture);
  if (
    !Number.isFinite(Date.parse(m.createdAt)) ||
    new Date(m.createdAt).toISOString() !== m.createdAt
  )
    throw Error("完整来源时间须为规范UTC时间");
  if (
    m.historyCount !== c.historyCount ||
    !!c.origin !== m.originRequestCount > 0 ||
    m.contextCount > sum(c.historyCount, 1) ||
    m.requestCount !== sum(m.originRequestCount, m.historyCount) ||
    m.recordCount !== sum(c.origin ? 1 : 0, m.contextCount, m.historyCount) ||
    m.recordCount >= Number.MAX_SAFE_INTEGER ||
    m.requestCount !== sum(m.completeCount, m.failedCount, m.cancelledCount) ||
    m.rootHash !== conversationArchiveRoot(m.id, c) ||
    m.sha256 !== conversationArchiveManifestHash(m)
  )
    throw Error("完整来源计数、根摘要或清单摘要不一致");
  return m;
}
export function conversationArchiveRef(value: unknown): any {
  const m = validateConversationArchiveManifest(value);
  return {
    version: 1,
    archiveId: m.id,
    sessionId: m.capture.sessionId,
    sha256: m.sha256,
  };
}
export function validateConversationArchiveRef(
  value: unknown,
  manifest: unknown,
): any {
  const r = shape("ConversationArchiveRef", value);
  if (!same(r, conversationArchiveRef(manifest)))
    throw Error("完整来源引用与固定清单不一致");
  return r;
}
export function conversationArchiveFirstCursor(manifest: unknown): any {
  const m = validateConversationArchiveManifest(manifest);
  return {
    source: conversationArchiveRef(m),
    nextOrdinal: 1,
    previousHash: m.rootHash,
  };
}
export function conversationArchivePageHash(value: unknown): string {
  budget(value, CONVERSATION_ARCHIVE_LIMITS.pageBytes);
  return digestBody(value);
}
/** previousRecord must be the host's fixed row or the preceding verified page's last row. */
export function validateConversationArchiveCursor(
  value: unknown,
  manifest: unknown,
  previousRecord: unknown = null,
): any {
  const c = shape("ConversationArchiveCursor", value),
    m = validateConversationArchiveManifest(manifest);
  validateConversationArchiveRef(c.source, m);
  if (c.nextOrdinal > m.recordCount) throw Error("完整来源游标超出固定终点");
  if (c.nextOrdinal === 1) {
    if (previousRecord !== null || c.previousHash !== m.rootHash)
      throw Error("完整来源首游标根摘要不一致");
  } else {
    const r = validateConversationArchiveRecord(previousRecord);
    if (
      r.archiveId !== m.id ||
      r.ordinal !== c.nextOrdinal - 1 ||
      r.sha256 !== c.previousHash
    )
      throw Error("完整来源游标缺少真实前序记录");
  }
  return c;
}
export function validateConversationArchivePage(
  value: unknown,
  manifest: unknown,
  previousRecord: unknown = null,
): any {
  const p = shape(
    "ConversationArchivePage",
    value,
    CONVERSATION_ARCHIVE_LIMITS.pageBytes,
  );
  const m = validateConversationArchiveManifest(manifest);
  validateConversationArchiveCursor(p.cursor, m, previousRecord);
  if (
    p.cursor.nextOrdinal > m.recordCount ||
    p.sha256 !== conversationArchivePageHash(p)
  )
    throw Error("完整来源页起点或摘要无效");
  if (p.cursor.nextOrdinal === 1 && p.cursor.previousHash !== m.rootHash)
    throw Error("完整来源首游标根摘要不一致");
  let ordinal = p.cursor.nextOrdinal,
    previous = p.cursor.previousHash;
  for (const value of p.records) {
    const r = validateConversationArchiveRecord(value);
    if (
      r.archiveId !== m.id ||
      r.ordinal !== ordinal ||
      r.previousHash !== previous ||
      r.ordinal > m.recordCount
    )
      throw Error("完整来源页记录身份、顺序或链摘要不一致");
    ordinal = sum(ordinal, 1);
    previous = r.sha256;
  }
  const expected =
    ordinal === sum(m.recordCount, 1)
      ? null
      : {
          source: p.cursor.source,
          nextOrdinal: ordinal,
          previousHash: previous,
        };
  if (!same(p.next, expected) || (!p.next && previous !== m.tailHash))
    throw Error("完整来源下一页或终点摘要不一致");
  return p;
}
export function validateCurrentConversationArchive(
  manifest: unknown,
  head: unknown,
  contextRevision: number,
): any {
  const m = validateConversationArchiveManifest(manifest),
    current = conversationArchiveCapture(head, contextRevision);
  const { revision: _oldRevision, ...before } = m.capture;
  const { revision: _newRevision, ...after } = current;
  if (
    m.capture.revision > current.revision ||
    !same(
      { ...before, origin: identity(before.origin) },
      { ...after, origin: identity(after.origin) },
    )
  )
    throw Error("访谈或资料已变化；旧来源保留，新内容需要新的完整来源");
  return m;
}

/** An archive-scoped persistent index in production; entries are small refs, never all context bodies. */
export type ArchiveVerificationIndex = {
  get(id: string): { id: string; sha256: string } | undefined;
  put(ref: { id: string; sha256: string }): void;
  hasRequest(id: string): boolean;
  putRequest(id: string): void;
};
/** Sequential verifier; callers may supply records from arbitrarily many bounded pages. */
export class ConversationArchiveScan {
  private records = 0;
  private contexts = 0;
  private original = 0;
  private history = 0;
  private complete = 0;
  private failed = 0;
  private cancelled = 0;
  private tail: string;
  private historyTail: string;
  private capture: any;
  private pendingContext: { id: string; sha256: string } | null = null;
  private lastHistory: any = null;
  constructor(
    private id: string,
    capture: unknown,
    private index: ArchiveVerificationIndex,
  ) {
    this.capture = structuredClone(validateConversationArchiveCapture(capture));
    this.tail = conversationArchiveRoot(id, this.capture);
    this.historyTail = conversationThreadSeed(
      this.capture.sessionId,
      this.capture.origin,
    );
  }
  append(value: unknown) {
    const r = validateConversationArchiveRecord(value),
      c = this.capture,
      p = r.payload;
    if (
      r.archiveId !== this.id ||
      r.ordinal !== sum(this.records, 1) ||
      r.previousHash !== this.tail
    )
      throw Error("完整来源记录缺失、重复、乱序或属于其他来源");
    const contextOrdinal = c.origin ? 2 : 1;
    if (r.ordinal === 1 && c.origin) {
      if (
        p.kind !== "origin" ||
        !same(
          identity(confirmedConversationEvidence(p.snapshot)),
          identity(c.origin),
        )
      )
        throw Error("原访谈与固定起点不一致");
    } else if (p.kind === "origin")
      throw Error("原访谈只能完整保留一次且位于首位");
    if (
      r.ordinal === contextOrdinal &&
      (p.kind !== "context" || !same(contextRef(p.context), c.context))
    )
      throw Error("完整来源须先保存当前固定资料上下文");
    if (p.kind === "context") {
      const ref = contextRef(p.context);
      if (this.index.get(ref.id)) throw Error("完整来源上下文身份重复");
      if (this.contexts >= sum(c.historyCount, 1))
        throw Error("完整来源包含多余上下文");
      if (
        r.ordinal !== contextOrdinal &&
        (this.pendingContext || this.history >= c.historyCount)
      )
        throw Error("历史资料必须紧邻首次采用它的请求，不纳入无关资料");
      if (r.ordinal !== contextOrdinal) this.pendingContext = ref;
      this.index.put(ref);
      this.contexts = sum(this.contexts, 1);
    } else if (p.kind === "origin") {
      if (p.snapshot.attempts.some((a: any) => this.index.hasRequest(a.id)))
        throw Error("完整来源请求身份重复");
      this.original = p.snapshot.attempts.length;
      for (const a of p.snapshot.attempts) {
        this.count(a.state);
        this.index.putRequest(a.id);
      }
    } else {
      const e = p.entry;
      if (
        e.sessionId !== c.sessionId ||
        e.ordinal !== sum(this.history, 1) ||
        e.ordinal > c.historyCount ||
        e.previousHash !== this.historyTail ||
        !same(this.index.get(e.context.id) ?? null, e.context) ||
        (this.pendingContext && !same(this.pendingContext, e.context)) ||
        this.index.hasRequest(e.requestId)
      )
        throw Error("完整来源请求缺失、重复、乱序或资料未保存");
      const last = this.lastHistory;
      if (
        e.retryOf !== null &&
        (!last ||
          e.retryOf !== last.requestId ||
          !["failed", "cancelled"].includes(last.state) ||
          e.turnId !== last.turnId ||
          e.userMessageId !== last.userMessageId ||
          e.text !== last.text ||
          e.assistantMessageId === last.assistantMessageId)
      )
        throw Error("完整来源重试关联无效");
      if (
        e.retryOf === null &&
        last &&
        (e.turnId === last.turnId || e.userMessageId === last.userMessageId)
      )
        throw Error("完整来源新输入错误复用原用户轮次");
      this.count(e.state);
      this.history = e.ordinal;
      this.historyTail = e.sha256;
      this.index.putRequest(e.requestId);
      this.lastHistory = structuredClone(e);
      this.pendingContext = null;
    }
    this.records = sum(this.records, 1);
    this.tail = r.sha256;
  }
  private count(state: string) {
    if (state === "complete") this.complete = sum(this.complete, 1);
    else if (state === "failed") this.failed = sum(this.failed, 1);
    else if (state === "cancelled") this.cancelled = sum(this.cancelled, 1);
    else throw Error("活动请求不能成为固定来源");
  }
  manifest(createdAt: string): any {
    const c = this.capture;
    if (
      this.pendingContext ||
      this.history !== c.historyCount ||
      this.historyTail !== c.historyHash ||
      !same(this.index.get(c.context.id) ?? null, c.context) ||
      !!c.origin !== this.original > 0
    )
      throw Error("完整来源尚未复制到固定终点");
    const m: any = {
      version: 1,
      id: this.id,
      capture: structuredClone(c),
      createdAt,
      originRequestCount: this.original,
      historyCount: this.history,
      contextCount: this.contexts,
      recordCount: this.records,
      requestCount: sum(this.original, this.history),
      completeCount: this.complete,
      failedCount: this.failed,
      cancelledCount: this.cancelled,
      rootHash: conversationArchiveRoot(this.id, c),
      tailHash: this.tail,
      sha256: "",
    };
    m.sha256 = conversationArchiveManifestHash(m);
    return validateConversationArchiveManifest(m);
  }
  finish(value: unknown): any {
    const m = validateConversationArchiveManifest(value);
    if (!same(m, this.manifest(m.createdAt)))
      throw Error("完整来源实际扫描与清单不一致");
    return m;
  }
}
