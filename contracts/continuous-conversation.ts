/** Normative JSON, identity and digest rules. Storage ownership and user consent remain host duties. */
import Ajv from "ajv/dist/2020.js";
import schema from "./p1.schema.json";
import { canonical, sha256 } from "./package-format";
import { confirmedConversationEvidence } from "./skill-trial";

export const continuousConversationCapability = "conversation-v2";
export const checkpointEvidenceCapability = "conversation-checkpoint-v1";
export const CONTINUOUS_LIMITS = {
  objectBytes: 1024 * 1024,
  pageBytes: 2 * 1024 * 1024,
  pageEntries: 20,
  selectedEntries: 24,
  answerCharacters: 100000,
  inputCharacters: 4000,
  values: 50000,
  depth: 40,
};
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema);
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const hash = (v: unknown) => sha256(Buffer.from(canonical(v), "utf8"));
const identity = (e: any) =>
  e && {
    sessionId: e.sessionId,
    revision: e.revision,
    sequence: e.sequence,
    sha256: e.sha256,
  };
const contextRef = (c: any) => ({ id: c.id, sha256: c.sha256 });

function budget(value: unknown, bytes = CONTINUOUS_LIMITS.objectBytes) {
  let count = 0;
  const seen = new Set<object>();
  const unicode = (v: string) => {
    if (
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        Buffer.from(v),
      ) !== v
    )
      throw Error("持续会话含无效Unicode");
  };
  const visit = (v: any, depth: number) => {
    if (++count > CONTINUOUS_LIMITS.values || depth > CONTINUOUS_LIMITS.depth)
      throw Error("持续会话对象层级或数量超限");
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
      throw Error("持续会话只接受有限JSON");
    seen.add(v);
    if (
      Array.isArray(v) &&
      (Object.keys(v).length !== v.length ||
        Object.keys(v).some((k, i) => k !== String(i)))
    )
      throw Error("数组须连续");
    for (const [key, child] of Object.entries(v)) {
      unicode(key);
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw Error("含保留键");
      visit(child, depth + 1);
    }
    seen.delete(v);
  };
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > bytes)
    throw Error("持续会话对象超过字节预算");
}
function shape(
  name: string,
  value: unknown,
  bytes = CONTINUOUS_LIMITS.objectBytes,
): any {
  budget(value, bytes);
  const check = ajv.getSchema(schema.$id + "#/$defs/" + name)!;
  if (!check(value))
    throw Error(name + "格式无效：" + ajv.errorsText(check.errors));
  return value;
}
function timestamp(v: string) {
  if (!Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v)
    throw Error("时间必须是规范UTC时间");
}
function digestBody(v: any) {
  const { sha256: _sha, ...body } = v;
  return hash(body);
}
export function conversationContextHash(value: any) {
  budget(value);
  const { id: _id, sha256: _sha, ...body } = value;
  return hash(body);
}
export function validateConversationContext(value: unknown): any {
  const c = shape("ConversationContext", value);
  if (
    !c.title.trim() ||
    !c.model.trim() ||
    !c.instructions.trim() ||
    c.instructions.length > 100000 ||
    c.sha256 !== conversationContextHash(c)
  )
    throw Error("上下文内容或摘要无效");
  return c;
}
export function conversationThreadSeed(
  sessionId: string,
  origin: unknown,
): string {
  shape("ConversationHistoryCursor", {
    sessionId,
    before: 1,
    sha256: "0".repeat(64),
  });
  shape("ConversationThreadOrigin", origin);
  if (origin && (origin as any).sessionId !== sessionId)
    throw Error("继续会话必须保留原会话ID");
  return hash({ version: 2, sessionId, origin: identity(origin) });
}
export function conversationEntryHash(value: any) {
  budget(value);
  return digestBody(value);
}
export function validateConversationEntry(value: unknown): any {
  const e = shape("ConversationThreadEntry", value);
  timestamp(e.finishedAt);
  if (
    !e.text.trim() ||
    e.text.length > 4000 ||
    e.answer.length > 100000 ||
    !e.model.trim() ||
    e.sha256 !== digestBody(e) ||
    e.retryOf === e.requestId ||
    e.userMessageId === e.assistantMessageId ||
    (e.state === "complete" && e.error)
  )
    throw Error("历史条目的身份、正文或摘要无效");
  return e;
}
export function validateConversationThread(value: unknown): any {
  const s = shape("ConversationThreadSnapshot", value);
  const active = s.active !== null;
  if (
    !s.title.trim() ||
    (s.status === "generating") !== active ||
    s.requestCount !== s.historyCount + (active ? 1 : 0) ||
    s.turnCount > s.requestCount ||
    (s.requestCount > 0 && s.turnCount === 0) ||
    (s.historyCount === 0) !== (s.lastEntry === null)
  )
    throw Error("持续会话计数或活动状态不一致");
  const seed = conversationThreadSeed(s.id, s.origin);
  if (s.lastEntry) {
    const e = validateConversationEntry(s.lastEntry);
    if (
      e.sessionId !== s.id ||
      e.ordinal !== s.historyCount ||
      e.sha256 !== s.historyHash
    )
      throw Error("持续会话历史尾部不一致");
  } else if (s.historyHash !== seed) throw Error("空历史起始摘要无效");
  if (s.draft.length > 4000) throw Error("输入超过字符预算");
  if (
    active &&
    (!same(s.active.context, s.context) ||
      !s.active.text.trim() ||
      s.active.text.length > 4000 ||
      s.active.answer.length > 100000 ||
      s.active.userMessageId === s.active.assistantMessageId ||
      s.active.retryOf === s.active.requestId ||
      s.active.requestId === s.lastEntry?.requestId)
  )
    throw Error("活动请求身份或上下文无效");
  if (
    active &&
    s.active.retryOf !== null &&
    (!s.lastEntry ||
      !["failed", "cancelled"].includes(s.lastEntry.state) ||
      s.active.retryOf !== s.lastEntry.requestId ||
      s.active.turnId !== s.lastEntry.turnId ||
      s.active.userMessageId !== s.lastEntry.userMessageId ||
      s.active.text !== s.lastEntry.text ||
      s.active.assistantMessageId === s.lastEntry.assistantMessageId)
  )
    throw Error("重试必须保留原用户轮次并另存助手尝试");
  if (
    active &&
    s.active.retryOf === null &&
    s.lastEntry &&
    (s.active.turnId === s.lastEntry.turnId ||
      s.active.userMessageId === s.lastEntry.userMessageId)
  )
    throw Error("新用户输入必须使用新的轮次身份");
  if (s.status === "draft" && s.historyCount !== 0)
    throw Error("非初始历史不能标为draft");
  if (
    ["ready", "failed", "cancelled"].includes(s.status) &&
    s.lastEntry?.state !==
      ({ ready: "complete", failed: "failed", cancelled: "cancelled" } as any)[
        s.status
      ]
  )
    throw Error("持续会话终态与历史不一致");
  if (s.latestCheckpoint && s.latestCheckpoint.sessionId !== s.id)
    throw Error("确认来源不属于本会话");
  if (
    s.checkpointCurrent &&
    (!s.latestCheckpoint ||
      active ||
      s.draft ||
      s.contextProposalId ||
      (!s.historyCount && !s.origin) ||
      (s.historyCount > 0 && s.lastEntry?.state !== "complete"))
  )
    throw Error("当前确认状态无效");
  timestamp(s.updatedAt);
  return s;
}
export function validateConversationThreadEvent(value: unknown): any {
  const e = shape("ConversationThreadEvent", value),
    s = validateConversationThread(e.snapshot);
  const latest = s.active ?? s.lastEntry;
  if (
    e.sessionId !== s.id ||
    e.sequence !== s.sequence ||
    e.eventId !== `thread:${s.id}:${s.sequence}` ||
    e.requestId !== (latest?.requestId ?? null) ||
    e.turnId !== (latest?.turnId ?? null)
  )
    throw Error("持续会话事件身份或序号不一致");
  return e;
}
export function validateConversationHistoryPage(
  value: unknown,
  origin: unknown,
): any {
  const p = shape(
    "ConversationHistoryPage",
    value,
    CONTINUOUS_LIMITS.pageBytes,
  );
  const { cursor, entries } = p;
  if (!entries.length) {
    if (
      cursor.before !== 1 ||
      cursor.sha256 !== conversationThreadSeed(cursor.sessionId, origin) ||
      p.next !== null
    )
      throw Error("空历史页或游标无效");
    return p;
  }
  for (let i = 0; i < entries.length; i++) {
    const e = validateConversationEntry(entries[i]);
    if (
      e.sessionId !== cursor.sessionId ||
      (i > 0 &&
        (e.ordinal !== entries[i - 1].ordinal + 1 ||
          e.previousHash !== entries[i - 1].sha256))
    )
      throw Error("历史页必须连续且属于当前会话");
  }
  const first = entries[0],
    last = entries.at(-1);
  if (
    last.ordinal !== cursor.before - 1 ||
    last.sha256 !== cursor.sha256 ||
    (first.ordinal === 1 &&
      first.previousHash !== conversationThreadSeed(cursor.sessionId, origin))
  )
    throw Error("历史页与游标不一致");
  const next =
    first.ordinal > 1
      ? {
          sessionId: cursor.sessionId,
          before: first.ordinal,
          sha256: first.previousHash,
        }
      : null;
  if (!same(next, p.next)) throw Error("历史页下一游标无效");
  return p;
}
/** entries and originSnapshot must be read by the host from its own protected storage. */
export function resolveConversationSelection(
  selection: unknown,
  head: unknown,
  originSnapshot: unknown,
  entries: unknown[],
): any[] {
  const s = validateConversationThread(head),
    refs = shape("ConversationHistorySelection", selection);
  if (refs.length > s.historyWindow) throw Error("选择超过本次上下文窗口");
  if (
    !Array.isArray(entries) ||
    entries.length > CONTINUOUS_LIMITS.selectedEntries
  )
    throw Error("只读取本次选择所需的有限历史");
  budget(entries, CONTINUOUS_LIMITS.pageBytes);
  let origin: any;
  if (s.origin) {
    const actual = confirmedConversationEvidence(originSnapshot);
    if (!same(identity(actual), identity(s.origin)))
      throw Error("原会话来源不一致");
    origin = originSnapshot;
  } else if (originSnapshot !== null) throw Error("没有声明原会话来源");
  const rows = entries.map(validateConversationEntry);
  const found: any[] = [],
    turns = new Set(),
    requests = new Set();
  let lastOrigin = -1,
    lastOrdinal = 0,
    sawHistory = false;
  for (const ref of refs) {
    let item: any;
    if (ref.kind === "origin") {
      if (!origin || sawHistory) throw Error("原会话选择顺序无效");
      const index = origin.attempts.findIndex(
        (a: any) => a.id === ref.requestId,
      );
      const a = origin.attempts[index];
      const u =
        a &&
        origin.messages.find(
          (m: any) =>
            m.turnId === a.turnId &&
            m.role === "user" &&
            m.state === "complete",
        );
      const m =
        a &&
        origin.messages.find(
          (m: any) =>
            m.requestId === a.id &&
            m.role === "assistant" &&
            m.state === "complete",
        );
      if (!a || a.state !== "complete" || !u || !m || index <= lastOrigin)
        throw Error("原会话选择须为真实完整轮次且按原顺序");
      lastOrigin = index;
      item = {
        ref,
        requestId: a.id,
        turnId: a.turnId,
        userMessageId: u.id,
        assistantMessageId: m.id,
        text: u.text,
        answer: m.text,
      };
    } else {
      sawHistory = true;
      const e = rows.find((e) => e.ordinal === ref.ordinal);
      if (
        !e ||
        e.sessionId !== s.id ||
        e.state !== "complete" ||
        e.sha256 !== ref.sha256 ||
        e.ordinal <= lastOrdinal ||
        e.ordinal > s.historyCount
      )
        throw Error("历史选择身份或顺序无效");
      lastOrdinal = e.ordinal;
      item = {
        ref,
        requestId: e.requestId,
        turnId: e.turnId,
        userMessageId: e.userMessageId,
        assistantMessageId: e.assistantMessageId,
        text: e.text,
        answer: e.answer,
      };
    }
    if (turns.has(item.turnId) || requests.has(item.requestId))
      throw Error("不能重复选择同轮或同请求");
    turns.add(item.turnId);
    requests.add(item.requestId);
    found.push(item);
  }
  return found;
}
const transcript = (items: any[]) =>
  items.flatMap((e) => [
    {
      role: "user",
      text: e.text,
      messageId: e.userMessageId,
      requestId: e.requestId,
    },
    {
      role: "assistant",
      text: e.answer,
      messageId: e.assistantMessageId,
      requestId: e.requestId,
    },
  ]);
export function conversationPreparedHash(value: any) {
  budget(value);
  return digestBody(value);
}
export function validateConversationPrepared(
  value: unknown,
  head: unknown,
  context: unknown,
  originSnapshot: unknown,
  entries: unknown[],
): any {
  const p = shape("ConversationThreadPrepared", value),
    s = validateConversationThread(head),
    c = validateConversationContext(context);
  const items = resolveConversationSelection(
    p.selection,
    s,
    originSnapshot,
    entries,
  );
  const messages = transcript(items)
    .map(({ role, text }) => ({ role, text }))
    .concat({ role: "user", text: p.text });
  const input = {
    provider: c.provider,
    model: c.model,
    instructions: c.instructions,
    context: {
      value: c.context,
      history: {
        sessionId: s.id,
        count: s.historyCount,
        sha256: s.historyHash,
        origin: s.origin,
        selection: p.selection,
      },
    },
    messages,
  };
  if (
    p.sessionId !== s.id ||
    p.revision !== s.revision ||
    p.historyCount !== s.historyCount ||
    p.historyHash !== s.historyHash ||
    !same(p.context, s.context) ||
    !same(p.context, contextRef(c)) ||
    !p.text.trim() ||
    p.text.length > 4000 ||
    !same(p.input, input) ||
    p.sha256 !== digestBody(p) ||
    s.active ||
    s.contextProposalId
  )
    throw Error("实际发送内容与本次核对不一致");
  if (
    p.retryOf !== null &&
    (p.retryOf !== s.lastEntry?.requestId ||
      !["failed", "cancelled"].includes(s.lastEntry.state) ||
      p.text !== s.lastEntry.text)
  )
    throw Error("仅能显式重试最后未完成轮次");
  return p;
}
export function conversationCheckpointHash(value: any) {
  budget(value);
  return digestBody(value);
}
export function validateConversationCheckpoint(value: unknown): any {
  const c = shape("ConversationCheckpoint", value);
  validateConversationContext(c.context);
  timestamp(c.confirmedAt);
  const seed = conversationThreadSeed(c.sessionId, c.origin);
  if (!c.historyCount && c.historyHash !== seed)
    throw Error("确认快照的空历史摘要无效");
  if (
    !c.title.trim() ||
    c.sha256 !== digestBody(c) ||
    c.transcript.length !== c.selection.length * 2
  )
    throw Error("确认快照摘要或选择数量无效");
  const messages = new Set(),
    requests = new Set();
  for (let i = 0; i < c.transcript.length; i += 2) {
    const u = c.transcript[i],
      a = c.transcript[i + 1];
    if (
      u.role !== "user" ||
      a.role !== "assistant" ||
      !u.text.trim() ||
      u.text.length > 4000 ||
      a.text.length > 100000 ||
      u.requestId !== a.requestId ||
      u.messageId === a.messageId ||
      messages.has(u.messageId) ||
      messages.has(a.messageId) ||
      requests.has(u.requestId)
    )
      throw Error("确认快照消息身份或顺序无效");
    messages.add(u.messageId);
    messages.add(a.messageId);
    requests.add(u.requestId);
  }
  return c;
}
export function validateCurrentConversationCheckpoint(
  value: unknown,
  head: unknown,
  context: unknown,
  originSnapshot: unknown,
  entries: unknown[],
  creating = false,
): any {
  const c = validateConversationCheckpoint(value),
    s = validateConversationThread(head),
    x = validateConversationContext(context);
  const items = resolveConversationSelection(
    c.selection,
    s,
    originSnapshot,
    entries,
  );
  if (
    c.sessionId !== s.id ||
    c.historyCount !== s.historyCount ||
    c.historyHash !== s.historyHash ||
    !same(c.context, x) ||
    !same(contextRef(x), s.context) ||
    !same(c.origin, s.origin) ||
    c.sourceRevision > s.revision ||
    (creating && c.sourceRevision !== s.revision) ||
    s.active ||
    s.draft ||
    s.contextProposalId ||
    (s.historyCount > 0 && s.lastEntry?.state !== "complete") ||
    !same(c.transcript, transcript(items)) ||
    !items.length
  )
    throw Error("确认快照不是当前核对的完整来源");
  const required =
    s.lastEntry?.requestId ?? (originSnapshot as any)?.attempts.at(-1)?.id;
  if (!items.some((e) => e.requestId === required))
    throw Error("确认范围必须包含最新完整轮次");
  if (
    !creating &&
    (!s.checkpointCurrent ||
      s.latestCheckpoint?.checkpointId !== c.id ||
      s.latestCheckpoint.sha256 !== c.sha256)
  )
    throw Error("此确认来源已被新内容取代，旧记录保留");
  return c;
}
export function conversationCheckpointEvidence(value: unknown): any {
  const c = validateConversationCheckpoint(value);
  return {
    kind: "conversation-checkpoint",
    label: c.title,
    sessionId: c.sessionId,
    checkpointId: c.id,
    sha256: c.sha256,
  };
}
export function verifyConversationCheckpointEvidence(
  evidence: unknown,
  checkpoint: unknown,
): any {
  const e = shape("ConversationCheckpointEvidence", evidence),
    actual = conversationCheckpointEvidence(checkpoint);
  if (!same({ ...e, label: "" }, { ...actual, label: "" }))
    throw Error("确认来源与本机固定快照不一致");
  return e;
}
export function validateConversationContextProposal(
  value: unknown,
  head: unknown,
): any {
  const p = shape("ConversationContextProposal", value),
    s = validateConversationThread(head);
  validateConversationContext(p.proposed);
  if (
    p.sessionId !== s.id ||
    p.id !== s.contextProposalId ||
    p.revision > s.revision ||
    !same(p.base, s.context) ||
    (p.proposed.sha256 === p.base.sha256 &&
      p.historyWindow === s.historyWindow) ||
    s.active
  )
    throw Error("上下文更新须重新核对当前来源");
  return p;
}
export function conversationThreadOutput(
  head: unknown,
  checkpoint: unknown,
): any {
  const s = validateConversationThread(head);
  const proposalId = s.contextProposalId;
  const current = s.checkpointCurrent && proposalId === null;
  let c: any;
  if (current) {
    c = validateConversationCheckpoint(checkpoint);
    verifyConversationCheckpointEvidence(s.latestCheckpoint, c);
    if (
      c.sourceRevision > s.revision ||
      !same(c.origin, s.origin) ||
      c.historyCount !== s.historyCount ||
      c.historyHash !== s.historyHash ||
      !same(contextRef(c.context), s.context)
    )
      throw Error("当前来源状态不一致");
  }
  return shape("ConversationThreadOutput", {
    formatVersion: "2.0",
    sessionId: s.id,
    status: proposalId ? "context-review" : current ? "confirmed" : "pending",
    revision: s.revision,
    sequence: s.sequence,
    context: s.context,
    historyCount: s.historyCount,
    historyHash: s.historyHash,
    origin: s.origin,
    transcript: current ? c.transcript : [],
    evidence: current ? conversationCheckpointEvidence(c) : null,
    proposalId,
  });
}
export function assertContinuousConversationCapabilities(
  node: any,
  capabilities: readonly string[],
) {
  if (node.type !== "conversation" || node.version !== 2) return;
  if (
    !capabilities.includes(continuousConversationCapability) ||
    !capabilities.includes(checkpointEvidenceCapability)
  )
    throw Error("持续会话须声明conversation-v2及conversation-checkpoint-v1");
  if (
    typeof node.key === "string" &&
    (!node.key.trim() || node.key.length > 100)
  )
    throw Error("持续会话键须为1–100字符非空文本");
  if (!node.title?.trim() || !node.instructions?.trim())
    throw Error("持续会话标题与指令不能为空");
}
export function assertCheckpointEvidenceCapabilities(
  evidence: readonly any[],
  capabilities: readonly string[],
) {
  if (
    evidence.some((e) => e?.kind === "conversation-checkpoint") &&
    !capabilities.includes(checkpointEvidenceCapability)
  )
    throw Error("采用持续会话来源须声明conversation-checkpoint-v1");
}
