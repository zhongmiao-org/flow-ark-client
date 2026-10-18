/** Read-only reference projection. Host registry, ownership, transactions and network admission remain mandatory. */
import Ajv from "ajv/dist/2020.js";
import schema from "./p1.schema.json";
import { canonical, sha256 } from "./package-format";
import { conversationSourceRead } from "./conversation-source";
import {
  assertSourceReductionNode,
  validateSourceReductionOutput,
  validateSourceReductionRecipe,
  validateSourceReductionAttempt,
} from "./source-reduction";

export const SOURCE_REDUCTION_REVIEW_LIMITS = {
  bytes: 32768,
  lifetimeMs: 600000,
};
const ajv = new Ajv({ strict: false, allErrors: true, logger: false });
ajv.addSchema(schema);
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const digest = (v: unknown) => sha256(Buffer.from(canonical(v), "utf8"));
const hash = (v: any) => {
  const { sha256: omitted, ...body } = v;
  return digest(body);
};

function shape(name: string, value: unknown): any {
  let count = 0;
  const seen = new Set<object>();
  const visit = (v: any, depth: number) => {
    if (++count > 2000 || depth > 16) throw Error("运行核对层级或数量超限");
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "number" && Number.isFinite(v)) return;
    if (typeof v === "string") {
      if (
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          Buffer.from(v),
        ) !== v
      )
        throw Error("运行核对含无效Unicode");
      return;
    }
    if (
      !v ||
      typeof v !== "object" ||
      seen.has(v) ||
      (!Array.isArray(v) &&
        ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
    )
      throw Error("运行核对只接受有限JSON");
    seen.add(v);
    if (
      Array.isArray(v) &&
      (Object.keys(v).length !== v.length ||
        Object.keys(v).some((key, i) => key !== String(i)))
    )
      throw Error("核对数组须连续");
    for (const [key, child] of Object.entries(v)) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw Error("核对含保留键");
      visit(key, depth + 1);
      visit(child, depth + 1);
    }
    seen.delete(v);
  };
  visit(value, 0);
  if (
    Buffer.byteLength(JSON.stringify(value), "utf8") >
    SOURCE_REDUCTION_REVIEW_LIMITS.bytes
  )
    throw Error("运行核对超过字节预算");
  const check = ajv.getSchema(schema.$id + "#/$defs/" + name)!;
  // Never echo unknown client properties or their values into a public diagnostic.
  if (!check(value)) throw Error("来源运行核对格式无效：" + name);
  return value;
}
function timestamp(value: string): number {
  const n = Date.parse(value);
  if (!Number.isFinite(n) || new Date(n).toISOString() !== value)
    throw Error("运行核对时间无效");
  return n;
}
function timeRange(review: any) {
  const start = timestamp(review.createdAt),
    end = timestamp(review.expiresAt);
  if (end <= start || end - start > SOURCE_REDUCTION_REVIEW_LIMITS.lifetimeMs)
    throw Error("运行核对有效期超限");
  return { start, end };
}

export function validateSourceReductionRunReview(value: unknown): any {
  const r = shape("SourceReductionRunReview", value),
    c = r.checkpoint;
  timeRange(r);
  const operation =
    r.phase === "attention"
      ? "retry-one"
      : r.phase === "ready"
        ? "continue-batch"
        : "use-complete";
  const limit =
    r.phase === "attention" ? 1 : r.phase === "ready" ? r.batchLimit : 0;
  if (
    r.sha256 !== hash(r) ||
    r.operation !== operation ||
    r.requestLimit !== limit ||
    c.revision !== c.chunks ||
    c.records > c.chunks ||
    r.attempts < c.chunks ||
    r.unknownUsageRequests > r.attempts ||
    (r.phase !== "complete" && r.configurationRevision === null) ||
    (r.phase === "attention") !== (r.pending !== null) ||
    (r.phase === "complete") !== (c.next === null) ||
    (r.phase === "complete") !== (r.fragment === null)
  )
    throw Error("运行核对的阶段、范围或摘要不一致");
  if (
    r.pending &&
    r.pending.hasSavedResponse !== (r.pending.state === "response")
  )
    throw Error("未提交请求与已保存响应状态不一致");
  if (r.fragment) {
    const f = r.fragment,
      n = c.next;
    if (
      !same(n.source, r.job.source) ||
      !same(f.source, r.job.source) ||
      f.recordOrdinal !== n.recordOrdinal ||
      f.byteOffset !== n.byteOffset ||
      f.byteEnd <= f.byteOffset ||
      f.byteEnd > f.recordBytes ||
      f.byteEnd - f.byteOffset > 16384
    )
      throw Error("片段范围不属于检查点的下一位置");
  }
  if (
    !(
      r.target.nodeInstance === r.target.nodeId ||
      r.target.nodeInstance.endsWith("/" + r.target.nodeId)
    )
  )
    throw Error("节点实例与节点身份不一致");
  return r;
}

/** Inputs must be reread from host-owned records, never accepted from Renderer as authority. */
export type SourceReductionReviewContext = {
  target: { runId: string; nodeId: string; nodeInstance: string };
  epoch: string;
  executionVersionId: string;
  snapshotSha256: string;
  configurationRevision: string | null;
  node: any;
  capabilities: string[];
  manifest: unknown;
  /** Actual selected provider/model/instructions/schema and resolved dynamic seed. */
  recipe: unknown;
  output: unknown;
  pendingAttempt: unknown | null;
  record: unknown | null;
  previousRecord?: unknown;
};

export function createSourceReductionRunReview(
  context: SourceReductionReviewContext,
  reviewId: string,
  createdAt: string,
  expiresAt: string,
): any {
  const x = context,
    recipe = validateSourceReductionRecipe(x.recipe),
    output = validateSourceReductionOutput(x.output, x.manifest, recipe),
    checkpoint = output.checkpoint;
  assertSourceReductionNode(x.node, x.capabilities);
  if (
    x.node.id !== x.target.nodeId ||
    x.node.instructions !== recipe.instructions ||
    !same(x.node.schema, recipe.schema) ||
    output.phase === "running"
  )
    throw Error("节点、配方或任务当前不可核对");
  let pending = null;
  let fragment = null;
  if (checkpoint.next !== null) {
    const read = conversationSourceRead(
      x.manifest,
      checkpoint.next,
      x.record,
      x.previousRecord,
    );
    const { text: omitted, ...projected } = read.chunk;
    fragment = projected;
    if (output.phase === "attention") {
      const a = validateSourceReductionAttempt(
        x.pendingAttempt,
        x.manifest,
        recipe,
        checkpoint,
        x.record,
        x.previousRecord,
      );
      if (
        a.attemptId !== output.pendingAttemptId ||
        !["prepared", "response", "failed", "unknown"].includes(a.state) ||
        a.nodeInstance !== x.target.nodeInstance
      )
        throw Error("待处理请求不属于原节点实例和检查点");
      pending = {
        attemptId: a.attemptId,
        state: a.state,
        hasSavedResponse: a.state === "response",
      };
    } else if (x.pendingAttempt !== null)
      throw Error("可继续任务不能混入未处理请求");
  } else if (x.pendingAttempt !== null || x.record !== null)
    throw Error("已完整任务不能声明新片段或未处理请求");
  const {
    revision,
    sha256: checkpointHash,
    next,
    chunks,
    records,
    bytes,
  } = checkpoint;
  const body = {
    version: 1,
    reviewId,
    epoch: x.epoch,
    target: structuredClone(x.target),
    mode: "snapshot",
    executionVersionId: x.executionVersionId,
    snapshotSha256: x.snapshotSha256,
    job: structuredClone(output.job),
    jobRevision: output.revision,
    checkpoint: {
      revision,
      sha256: checkpointHash,
      next,
      chunks,
      records,
      bytes,
    },
    phase: output.phase,
    operation:
      output.phase === "attention"
        ? "retry-one"
        : output.phase === "ready"
          ? "continue-batch"
          : "use-complete",
    pending,
    fragment,
    batchLimit: x.node.maxRequests,
    requestLimit:
      output.phase === "attention"
        ? 1
        : output.phase === "ready"
          ? x.node.maxRequests
          : 0,
    requestScope: "source-node-instance",
    runStartsAtFirstNode: true,
    provider: recipe.provider,
    model: recipe.model,
    configurationRevision: x.configurationRevision,
    attempts: output.attempts,
    reportedTotalTokens: output.reportedTotalTokens,
    unknownUsageRequests: output.unknownUsageRequests,
    createdAt,
    expiresAt,
  };
  return structuredClone(
    validateSourceReductionRunReview({ ...body, sha256: digest(body) }),
  );
}

/** Format/currentness only. Caller must retrieve the registered review by opaque ID and enforce ownership. */
export function assertSourceReductionRunReviewCurrent(
  registeredReview: unknown,
  actual: SourceReductionReviewContext,
  currentTime: string,
): any {
  const r = validateSourceReductionRunReview(registeredReview),
    t = timestamp(currentTime),
    { start, end } = timeRange(r);
  if (t < start || t >= end) throw Error("来源运行核对已过期，请重新核对");
  const current = createSourceReductionRunReview(
    actual,
    r.reviewId,
    r.createdAt,
    r.expiresAt,
  );
  if (!same(r, current))
    throw Error("来源、任务、规则或配置已改变，请重新核对");
  return r;
}

export function sourceReductionRunConfirmation(
  value: unknown,
  registeredReview: unknown,
  actual: SourceReductionReviewContext,
  currentTime: string,
): any {
  const c = shape("SourceReductionRunConfirmation", value),
    r = assertSourceReductionRunReviewCurrent(
      registeredReview,
      actual,
      currentTime,
    );
  if (c.reviewId !== r.reviewId || c.reviewSha256 !== r.sha256)
    throw Error("确认不属于宿主登记的预览");
  return structuredClone(c);
}

/** Persist atomically with a unique new Run and the request/review lookup, never as a standalone grant. */
export function sourceReductionRunReviewReceipt(
  confirmation: unknown,
  registeredReview: unknown,
  actual: SourceReductionReviewContext,
  runId: string,
  confirmedAt: string,
): any {
  const c = sourceReductionRunConfirmation(
      confirmation,
      registeredReview,
      actual,
      confirmedAt,
    ),
    r = validateSourceReductionRunReview(registeredReview);
  if (runId === r.target.runId) throw Error("核对必须绑定独立新Run");
  const body = {
    version: 1,
    requestId: c.requestId,
    runId,
    review: structuredClone(r),
    confirmedAt,
  };
  return validateSourceReductionRunReviewReceipt({
    ...body,
    sha256: digest(body),
  });
}

export function validateSourceReductionRunReviewReceipt(value: unknown): any {
  const r = shape("SourceReductionRunReviewReceipt", value),
    review = validateSourceReductionRunReview(r.review),
    { start, end } = timeRange(review),
    t = timestamp(r.confirmedAt);
  if (
    r.sha256 !== hash(r) ||
    r.runId === review.target.runId ||
    t < start ||
    t >= end
  )
    throw Error("来源运行确认回执不一致");
  return structuredClone(r);
}
