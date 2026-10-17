/** Lossless bounded source reads; never model-processing or fact-confirmation evidence. */
import Ajv from "ajv/dist/2020.js";
import schema from "./p1.schema.json";
import { canonical, sha256 } from "./package-format";
import {
  validateConversationArchiveManifest,
  validateConversationArchiveRecord,
  validateConversationArchiveRef,
} from "./conversation-archive";

export const conversationSourceReadCapability = "conversation-source-read-v1";
export const CONVERSATION_SOURCE_LIMITS = {
  chunkBytes: 16384,
  outputBytes: 131072,
};
const format = "canonical-record-json-v1";
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema);
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const digest = (v: unknown) => sha256(Buffer.from(canonical(v), "utf8"));
const refOf = (m: any) => ({
  version: 1,
  archiveId: m.id,
  sessionId: m.capture.sessionId,
  sha256: m.sha256,
});
function shape(name: string, value: unknown): any {
  // Reject non-JSON/cyclic values before serializing; bounded depth also keeps errors finite.
  const seen = new Set<object>();
  let count = 0;
  const visit = (v: any, depth: number) => {
    if (++count > 1000 || depth > 12)
      throw Error("来源读取对象层级或字段数量超限");
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "number" && Number.isFinite(v)) return;
    if (typeof v === "string") {
      if (
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          Buffer.from(v),
        ) !== v
      )
        throw Error("来源读取含无效Unicode");
      return;
    }
    if (
      !v ||
      typeof v !== "object" ||
      seen.has(v) ||
      (!Array.isArray(v) &&
        ![null, Object.prototype].includes(Object.getPrototypeOf(v)))
    )
      throw Error("来源读取只接受有限JSON");
    seen.add(v);
    if (
      Array.isArray(v) &&
      (Object.keys(v).length !== v.length ||
        Object.keys(v).some((k, i) => k !== String(i)))
    )
      throw Error("来源读取数组须连续");
    for (const [k, child] of Object.entries(v)) {
      if (["__proto__", "constructor", "prototype"].includes(k))
        throw Error("来源读取含保留键");
      visit(k, depth + 1);
      visit(child, depth + 1);
    }
    seen.delete(v);
  };
  visit(value, 0);
  if (
    Buffer.byteLength(JSON.stringify(value), "utf8") >
    CONVERSATION_SOURCE_LIMITS.outputBytes
  )
    throw Error("来源读取输出超出预算");
  const check = ajv.getSchema(schema.$id + "#/$defs/" + name)!;
  if (!check(value))
    throw Error(name + "格式无效：" + ajv.errorsText(check.errors));
  return value;
}
function increment(n: number) {
  const v = n + 1;
  if (!Number.isSafeInteger(v)) throw Error("来源位置超过安全整数");
  return v;
}
function endAt(bytes: Buffer, start: number) {
  let end = Math.min(
    start + CONVERSATION_SOURCE_LIMITS.chunkBytes,
    bytes.length,
  );
  // A UTF-8 continuation byte cannot start the next fragment. Never split a scalar.
  while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
  if (end <= start) throw Error("来源片段无法推进");
  return end;
}
function recordAt(
  manifest: any,
  record: unknown,
  ordinal: number,
  previousRecord: unknown,
) {
  const r = validateConversationArchiveRecord(record);
  let previous = manifest.rootHash;
  if (ordinal === 1) {
    if (previousRecord !== null) throw Error("来源首记录不接受其他前序记录");
  } else {
    const p = validateConversationArchiveRecord(previousRecord);
    if (p.archiveId !== manifest.id || p.ordinal !== ordinal - 1)
      throw Error("来源读取缺少实际前序记录");
    previous = p.sha256;
  }
  if (
    ordinal > manifest.recordCount ||
    r.archiveId !== manifest.id ||
    r.ordinal !== ordinal ||
    r.previousHash !== previous
  )
    throw Error("来源读取记录身份、顺序或摘要链无效");
  if (ordinal === manifest.recordCount && r.sha256 !== manifest.tailHash)
    throw Error("来源读取末记录与固定终点不一致");
  return r;
}
export function conversationSourceStart(manifest: unknown): any {
  const m = validateConversationArchiveManifest(manifest);
  return {
    version: 1,
    format,
    source: refOf(m),
    recordOrdinal: 1,
    byteOffset: 0,
    previousHash: m.rootHash,
  };
}
export function validateConversationSourceCursor(
  value: unknown,
  manifest: unknown,
  record: unknown,
  previousRecord: unknown = null,
): any {
  const c = shape("ConversationSourceCursor", value),
    m = validateConversationArchiveManifest(manifest);
  validateConversationArchiveRef(c.source, m);
  const r = recordAt(m, record, c.recordOrdinal, previousRecord);
  if (c.previousHash !== r.previousHash)
    throw Error("来源读取游标前序摘要不一致");
  const bytes = Buffer.from(canonical(r), "utf8");
  if (c.byteOffset >= bytes.length) throw Error("来源片段起点超出真实记录");
  let offset = 0;
  while (offset < c.byteOffset) offset = endAt(bytes, offset);
  if (offset !== c.byteOffset) throw Error("来源片段起点不是固定切分边界");
  return c;
}
export function conversationSourceChunkHash(value: unknown): string {
  const { sha256: _ignored, ...body } = value as any;
  return digest(body);
}
export function conversationSourceRead(
  manifest: unknown,
  cursor: unknown,
  record: unknown,
  previousRecord: unknown = null,
): any {
  const m = validateConversationArchiveManifest(manifest);
  const c = validateConversationSourceCursor(
    cursor === null ? conversationSourceStart(m) : cursor,
    m,
    record,
    previousRecord,
  );
  const r = validateConversationArchiveRecord(record),
    bytes = Buffer.from(canonical(r), "utf8");
  const end = endAt(bytes, c.byteOffset);
  const chunk: any = {
    version: 1,
    format,
    source: refOf(m),
    recordOrdinal: r.ordinal,
    recordKind: r.payload.kind,
    recordHash: r.sha256,
    recordBytes: bytes.length,
    byteOffset: c.byteOffset,
    byteEnd: end,
    text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes.subarray(c.byteOffset, end),
    ),
  };
  chunk.sha256 = conversationSourceChunkHash(chunk);
  const next =
    end < bytes.length
      ? { ...c, byteOffset: end }
      : r.ordinal === m.recordCount
        ? null
        : {
            ...c,
            recordOrdinal: increment(r.ordinal),
            byteOffset: 0,
            previousHash: r.sha256,
          };
  return shape("ConversationSourceRead", {
    version: 1,
    cursor: structuredClone(c),
    chunk,
    next,
    done: next === null,
  });
}
export function validateConversationSourceRead(
  value: unknown,
  manifest: unknown,
  record: unknown,
  previousRecord: unknown = null,
): any {
  const v = shape("ConversationSourceRead", value);
  const expected = conversationSourceRead(
    manifest,
    v.cursor,
    record,
    previousRecord,
  );
  if (!same(v, expected))
    throw Error("来源读取正文、区间、摘要或后继与实际记录不符");
  return v;
}
/** Caller supplies registered manifest and authoritative rows, never caller-authored content. */
export class ConversationSourceScan {
  private manifest: any;
  private cursor: any;
  private bytes = 0;
  private chunks = 0;
  constructor(manifest: unknown) {
    this.manifest = structuredClone(
      validateConversationArchiveManifest(manifest),
    );
    this.cursor = conversationSourceStart(this.manifest);
  }
  append(value: unknown, record: unknown, previousRecord: unknown = null) {
    if (!this.cursor) throw Error("来源读取已经到达固定终点");
    const v = validateConversationSourceRead(
      value,
      this.manifest,
      record,
      previousRecord,
    );
    if (!same(v.cursor, this.cursor))
      throw Error("来源读取发生缺失、重复、乱序或换源");
    const bytes = this.bytes + v.chunk.byteEnd - v.chunk.byteOffset;
    if (!Number.isSafeInteger(bytes))
      throw Error("来源读取累计字节超出安全整数");
    const chunks = increment(this.chunks);
    this.cursor = structuredClone(v.next);
    this.bytes = bytes;
    this.chunks = chunks;
    return this.progress();
  }
  progress() {
    return {
      source: refOf(this.manifest),
      next: structuredClone(this.cursor),
      chunks: this.chunks,
      bytes: this.bytes,
      readComplete: this.cursor === null,
    };
  }
  finish() {
    if (this.cursor) throw Error("来源读取尚未覆盖固定终点");
    return this.progress();
  }
}
export function assertConversationSourceNode(
  node: any,
  capabilities: string[],
  manifest?: any,
  entry?: any,
) {
  if (node.type !== "source") return;
  if (
    node.version !== 1 ||
    !["manifest", "read"].includes(node.operation) ||
    !capabilities.includes(conversationSourceReadCapability)
  )
    throw Error("来源读取节点缺少实际支持的版本或能力声明");
  if (manifest || entry) {
    const resource = manifest?.resources.find(
      (r: any) => r.id === node.binding,
    );
    if (
      !entry?.capabilities.includes(conversationSourceReadCapability) ||
      !entry.resources.includes(node.binding) ||
      resource?.kind !== "conversation-source" ||
      resource.access !== "read"
    )
      throw Error("来源读取入口未声明本入口只读来源资源及能力");
  }
}
