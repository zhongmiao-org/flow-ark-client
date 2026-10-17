/** Reference transitions. Consumers must supply registered sources and actual persisted provider attempts. */
import Ajv from "ajv/dist/2020.js";
import schema from "./p1.schema.json";
import { canonical, sha256, validateData } from "./package-format";
import { validateConversationArchiveManifest } from "./conversation-archive";
import {
  conversationSourceStart,
  validateConversationSourceRead,
} from "./conversation-source";

export const sourceReductionCapabilities = [
  "source-reduce-v1",
  "conversation-source-read-v1",
  "ai-node-v1",
];
export const SOURCE_REDUCTION_LIMITS = {
  inputBytes: 196608,
  accumulatorBytes: 65536,
  transportBytes: 393216,
  attemptBytes: 1048576,
  maxRequests: 16,
  outputTokens: 16384,
};
const ajv = new Ajv({ strict: false, allErrors: true, logger: false });
ajv.addSchema(schema);
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");
const digest = (v: unknown) => sha256(Buffer.from(canonical(v), "utf8"));
function bounded(v: unknown, max: number, depth = 48, count = 30000) {
  const seen = new Set<object>();
  const visit = (x: any, d: number) => {
    if (d > depth || --count < 0) throw Error("来源整理对象层级或数量超限");
    if (x === null || typeof x === "boolean") return;
    if (typeof x === "number" && Number.isFinite(x)) return;
    if (typeof x === "string") {
      if (
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          Buffer.from(x),
        ) !== x
      )
        throw Error("来源整理含无效Unicode");
      return;
    }
    if (
      !x ||
      typeof x !== "object" ||
      seen.has(x) ||
      (!Array.isArray(x) &&
        ![Object.prototype, null].includes(Object.getPrototypeOf(x)))
    )
      throw Error("来源整理只接受有限JSON");
    seen.add(x);
    if (
      Array.isArray(x) &&
      (Object.keys(x).length !== x.length ||
        Object.keys(x).some((k, i) => k !== String(i)))
    )
      throw Error("来源整理数组须连续");
    for (const [k, child] of Object.entries(x)) {
      if (["__proto__", "constructor", "prototype"].includes(k))
        throw Error("来源整理含保留键");
      visit(child, d + 1);
    }
    seen.delete(x);
  };
  visit(v, 0);
  if (bytes(v) > max) throw Error("来源整理对象超过字节预算");
}
function shape(
  name: string,
  value: unknown,
  max = SOURCE_REDUCTION_LIMITS.attemptBytes,
): any {
  bounded(value, max);
  const validate = ajv.getSchema(schema.$id + "#/$defs/" + name)!;
  if (!validate(value))
    throw Error(name + "格式无效：" + ajv.errorsText(validate.errors));
  return value;
}
function accumulator(value: any) {
  bounded(value, SOURCE_REDUCTION_LIMITS.accumulatorBytes, 32, 10000);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("整理结果须为根object");
}
function hashWithoutSelf(value: any) {
  const { sha256: omitted, ...body } = value;
  return digest(body);
}
const refOf = (m: any) => ({
  version: 1,
  archiveId: m.id,
  sessionId: m.capture.sessionId,
  sha256: m.sha256,
});
function add(a: number, b: number) {
  const n = a + b;
  if (!Number.isSafeInteger(n)) throw Error("来源整理计数超过安全整数");
  return n;
}
export function validateSourceReductionRecipe(value: unknown): any {
  const r = shape(
    "SourceReductionRecipe",
    value,
    SOURCE_REDUCTION_LIMITS.inputBytes,
  );
  if (
    !r.instructions.trim() ||
    r.schema.type !== "object" ||
    bytes(r.schema) > 65536 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(r.model)
  )
    throw Error("整理配方的指令、模型或结果Schema无效");
  const check = new Ajv({ strict: false, logger: false }).compile(r.schema);
  if ((check as any).$async) throw Error("来源整理不支持异步结果Schema");
  accumulator(r.seed);
  return r;
}
export function sourceReductionRecipeHash(recipe: unknown) {
  return digest(validateSourceReductionRecipe(recipe));
}
export function sourceReductionAttemptId(jobId: string, sequence: number) {
  if (
    !/^[a-zA-Z0-9_-]{1,100}$/.test(jobId) ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1
  )
    throw Error("来源整理尝试序号无效");
  return "ra_" + digest({ jobId, sequence }).slice(0, 32);
}
export function validateSourceReductionCheckpoint(
  value: unknown,
  manifest: unknown,
  recipe: unknown,
): any {
  const c = shape("SourceReductionCheckpoint", value),
    m = validateConversationArchiveManifest(manifest),
    r = validateSourceReductionRecipe(recipe);
  accumulator(c.accumulator);
  if (
    c.sha256 !== hashWithoutSelf(c) ||
    !same(c.job.source, refOf(m)) ||
    c.job.recipeHash !== digest(r) ||
    c.revision !== c.chunks ||
    c.records > c.chunks ||
    c.records > m.recordCount ||
    (c.chunks === 0) !== (c.lastAttemptId === null)
  )
    throw Error("来源整理检查点摘要、配方或计数不一致");
  if (
    c.next === null
      ? c.records !== m.recordCount
      : !same(c.next.source, c.job.source) ||
        c.next.recordOrdinal !== c.records + 1
  )
    throw Error("来源整理检查点与记录终点不一致");
  if (
    c.chunks === 0 &&
    (!same(c.next, conversationSourceStart(m)) ||
      c.bytes !== 0 ||
      c.records !== 0 ||
      !same(c.accumulator, r.seed) ||
      c.chainHash !== digest({ job: c.job, seed: r.seed }))
  )
    throw Error("来源整理初始检查点被改变");
  return c;
}
export function beginSourceReduction(
  manifest: unknown,
  recipe: unknown,
  jobId: string,
): any {
  const m = validateConversationArchiveManifest(manifest),
    r = validateSourceReductionRecipe(recipe);
  const job = shape("SourceReductionRef", {
    version: 1,
    jobId,
    source: refOf(m),
    recipeHash: digest(r),
  });
  const c = {
    version: 1,
    job,
    revision: 0,
    next: conversationSourceStart(m),
    accumulator: structuredClone(r.seed),
    chunks: 0,
    records: 0,
    bytes: 0,
    chainHash: digest({ job, seed: r.seed }),
    lastAttemptId: null,
    sha256: "",
  };
  c.sha256 = hashWithoutSelf(c);
  return validateSourceReductionCheckpoint(c, m, r);
}
export function sourceReductionRequest(
  manifest: unknown,
  recipe: unknown,
  checkpoint: unknown,
  read: unknown,
  record: unknown,
  previousRecord: unknown = null,
): any {
  const m = validateConversationArchiveManifest(manifest),
    r = validateSourceReductionRecipe(recipe),
    c = validateSourceReductionCheckpoint(checkpoint, m, r),
    fragment = validateConversationSourceRead(read, m, record, previousRecord);
  if (c.next === null || !same(c.next, fragment.cursor))
    throw Error("整理请求未采用准确下一片段");
  const request = {
    provider: r.provider,
    model: r.model,
    instructions: r.instructions,
    input: {
      format: "source-reduction-v1",
      source: c.job.source,
      manifest: m,
      fragment,
      prior: {
        revision: c.revision,
        sha256: c.sha256,
        accumulator: c.accumulator,
      },
    },
    schema: r.schema,
  };
  return shape("AIRequest", request, SOURCE_REDUCTION_LIMITS.inputBytes);
}
/** Exact existing planning adapter payload, with no Key, headers, tools or images. */
export function sourceReductionWire(request: any) {
  shape("AIRequest", request, SOURCE_REDUCTION_LIMITS.inputBytes);
  const input = JSON.stringify(request.input);
  return request.provider === "deepseek"
    ? {
        model: request.model,
        messages: [
          {
            role: "system",
            content:
              request.instructions +
              "\n只输出符合以下 JSON Schema 的完整 JSON：" +
              JSON.stringify(request.schema),
          },
          { role: "user", content: input },
        ],
        response_format: { type: "json_object" },
        max_tokens: 16384,
        stream: false,
      }
    : {
        model: request.model,
        store: false,
        instructions: request.instructions,
        input,
        max_output_tokens: 16384,
        text: {
          format: {
            type: "json_schema",
            name: "template_result",
            strict: true,
            schema: request.schema,
          },
        },
      };
}
export function sourceReductionTransport(request: any, body: string) {
  if (
    typeof body !== "string" ||
    Buffer.byteLength(body, "utf8") > SOURCE_REDUCTION_LIMITS.transportBytes
  )
    throw Error("实际供应商请求体超限");
  const value = JSON.parse(body);
  // Reject duplicate keys and noncompact alternate encodings; the current adapter uses JSON.stringify.
  if (
    JSON.stringify(value) !== body ||
    !same(value, sourceReductionWire(request))
  )
    throw Error("实际供应商请求体与完整来源输入不一致");
  return shape("SourceReductionTransport", {
    body,
    sha256: sha256(Buffer.from(body, "utf8")),
  });
}
export function validateSourceReductionAttempt(
  value: unknown,
  manifest: unknown,
  recipe: unknown,
  checkpoint: unknown,
  record: unknown,
  previousRecord: unknown = null,
): any {
  const a = shape("SourceReductionAttempt", value),
    c = validateSourceReductionCheckpoint(checkpoint, manifest, recipe);
  if (a.attemptId !== sourceReductionAttemptId(a.job.jobId, a.sequence))
    throw Error("来源整理尝试身份与宿主单调序号不符");
  if (
    !same(a.job, c.job) ||
    a.checkpointRevision !== c.revision ||
    a.checkpointSha256 !== c.sha256 ||
    a.requestSha256 !== digest(a.request) ||
    !same(
      a.request,
      sourceReductionRequest(
        manifest,
        recipe,
        c,
        a.request.input?.fragment,
        record,
        previousRecord,
      ),
    )
  )
    throw Error("尝试未绑定真实来源、准确检查点及实际请求");
  if (
    a.transport &&
    !same(a.transport, sourceReductionTransport(a.request, a.transport.body))
  )
    throw Error("实际供应商请求摘要不同");
  if (a.state !== "prepared" && !a.transport)
    throw Error("已发尝试缺少实际请求体");
  if (a.state === "prepared" && a.transport !== null)
    throw Error("实际请求正文与发出意图须一起登记，未发状态不能混用");
  if (
    ["prepared", "dispatched", "unknown"].includes(a.state) &&
    a.outcome !== null
  )
    throw Error("在途或未知尝试不能带有已采用结果");
  if (
    ["response", "committed"].includes(a.state) &&
    a.outcome?.status !== "success"
  )
    throw Error("尝试没有完整成功结果");
  if (a.state === "failed" && a.outcome?.status !== "failed")
    throw Error("失败尝试缺少故障收据");
  if (
    a.outcome &&
    (a.outcome.status === "success"
      ? a.outcome.result.provider
      : a.outcome.provider) !== a.request.provider
  )
    throw Error("供应商结果不属于该尝试");
  if (a.outcome?.status === "success") {
    accumulator(a.outcome.result.output);
    validateData((recipe as any).schema, a.outcome.result.output);
  }
  return a;
}
/** Transaction caller checks live attempt/revision once more and commits this plus its receipt atomically. */
export function advanceSourceReduction(
  checkpoint: unknown,
  attempt: unknown,
  manifest: unknown,
  recipe: unknown,
  record: unknown,
  previousRecord: unknown = null,
): any {
  const c = validateSourceReductionCheckpoint(checkpoint, manifest, recipe),
    a = validateSourceReductionAttempt(
      attempt,
      manifest,
      recipe,
      c,
      record,
      previousRecord,
    );
  if (a.state !== "response") throw Error("只有尚未提交的完整响应可以推进一次");
  const read = a.request.input.fragment,
    out = a.outcome.result.output;
  const next = {
    version: 1,
    job: c.job,
    revision: add(c.revision, 1),
    next: read.next,
    accumulator: structuredClone(out),
    chunks: add(c.chunks, 1),
    records: add(
      c.records,
      read.chunk.byteEnd === read.chunk.recordBytes ? 1 : 0,
    ),
    bytes: add(c.bytes, read.chunk.byteEnd - read.chunk.byteOffset),
    chainHash: digest({
      previous: c.chainHash,
      checkpoint: c.sha256,
      attemptId: a.attemptId,
      request: a.requestSha256,
      transport: a.transport.sha256,
      response: digest(a.outcome),
      fragment: read.chunk.sha256,
    }),
    lastAttemptId: a.attemptId,
    sha256: "",
  };
  next.sha256 = hashWithoutSelf(next);
  return validateSourceReductionCheckpoint(next, manifest, recipe);
}
/** Constant-memory replay, excluding unadopted/retried/late attempts. Host supplies the actual journal. */
export class SourceReductionCoverage {
  private checkpoint: any;
  private sequence = 0;
  constructor(
    private manifest: unknown,
    private recipe: unknown,
    jobId: string,
  ) {
    this.checkpoint = beginSourceReduction(manifest, recipe, jobId);
  }
  append(attempt: unknown, record: unknown, previousRecord: unknown = null) {
    const a = validateSourceReductionAttempt(
      attempt,
      this.manifest,
      this.recipe,
      this.checkpoint,
      record,
      previousRecord,
    );
    if (a.state !== "committed" || a.sequence <= this.sequence)
      throw Error("覆盖日志须为连续位置及递增的已采用尝试");
    const next = advanceSourceReduction(
      this.checkpoint,
      { ...a, state: "response" },
      this.manifest,
      this.recipe,
      record,
      previousRecord,
    );
    this.checkpoint = next;
    this.sequence = a.sequence;
    return structuredClone(next);
  }
  finish(final: unknown): any {
    const c = validateSourceReductionCheckpoint(
      final,
      this.manifest,
      this.recipe,
    );
    if (!same(c, this.checkpoint) || c.next !== null || !c.chunks)
      throw Error("整理覆盖尚未达到准确固定终点");
    const proof = {
      version: 1,
      job: c.job,
      checkpointSha256: c.sha256,
      accumulatorSha256: digest(c.accumulator),
      chainHash: c.chainHash,
      chunks: c.chunks,
      records: c.records,
      bytes: c.bytes,
      sha256: "",
    };
    proof.sha256 = hashWithoutSelf(proof);
    return shape("SourceReductionProof", proof);
  }
}
/** Read each registered attempt's latest state once, ordered by host-assigned sequence. */
export function sourceReductionUsage(
  job: unknown,
  attempts: Iterable<unknown>,
) {
  const ref = shape("SourceReductionRef", job);
  let sequence = 0,
    count = 0,
    reportedTotalTokens = 0,
    unknownUsageRequests = 0;
  for (const value of attempts) {
    const a = shape("SourceReductionAttempt", value);
    if (
      !same(a.job, ref) ||
      a.sequence <= sequence ||
      a.attemptId !== sourceReductionAttemptId(ref.jobId, a.sequence)
    )
      throw Error("用量日志必须是本任务每个尝试的唯一最新状态");
    sequence = a.sequence;
    if (a.state === "prepared") {
      if (a.transport !== null || a.outcome !== null)
        throw Error("未发尝试不能登记已发用量");
      continue;
    }
    if (!a.transport) throw Error("已发用量缺少实际请求正文");
    count = add(count, 1);
    const usage =
      a.outcome?.status === "success"
        ? a.outcome.result.usage
        : a.outcome?.usage;
    if (Number.isSafeInteger(usage?.total_tokens) && usage.total_tokens >= 0)
      reportedTotalTokens = add(reportedTotalTokens, usage.total_tokens);
    else unknownUsageRequests = add(unknownUsageRequests, 1);
  }
  return { attempts: count, reportedTotalTokens, unknownUsageRequests };
}
export function validateSourceReductionOutput(
  value: unknown,
  manifest: unknown,
  recipe: unknown,
): any {
  const o = shape("SourceReductionOutput", value),
    c = validateSourceReductionCheckpoint(o.checkpoint, manifest, recipe);
  if (
    !same(o.job, c.job) ||
    o.attempts < c.chunks ||
    o.unknownUsageRequests > o.attempts ||
    (["running", "attention"].includes(o.phase)
      ? o.pendingAttemptId === null
      : o.pendingAttemptId !== null)
  )
    throw Error("整理状态、尝试或待核对身份不一致");
  if (
    (o.phase === "complete") !== (o.proof !== null) ||
    (c.next === null) !== (o.phase === "complete")
  )
    throw Error("整理完成状态与真实终点/证明不一致");
  if (o.proof) {
    const p = o.proof;
    if (
      p.sha256 !== hashWithoutSelf(p) ||
      !same(p.job, c.job) ||
      p.checkpointSha256 !== c.sha256 ||
      p.accumulatorSha256 !== digest(c.accumulator) ||
      p.chainHash !== c.chainHash ||
      p.chunks !== c.chunks ||
      p.records !== c.records ||
      p.bytes !== c.bytes
    )
      throw Error("整理覆盖证明不属于最终草稿");
  }
  return o;
}
export function assertSourceReductionNode(
  node: any,
  capabilities: string[],
  manifest?: any,
  entry?: any,
) {
  if (node.type !== "source-reduce") return;
  shape("Node", node);
  if (sourceReductionCapabilities.some((c) => !capabilities.includes(c)))
    throw Error("来源整理节点缺少实际能力声明");
  if (
    !node.instructions.trim() ||
    node.schema?.type !== "object" ||
    bytes(node.schema) > 65536
  )
    throw Error("来源整理指令或结果字段无效");
  const validate = new Ajv({ strict: false, logger: false }).compile(
    node.schema,
  );
  if ((validate as any).$async) throw Error("来源整理不支持异步结果字段");
  if (manifest || entry) {
    const source = manifest?.resources.find((r: any) => r.id === node.binding),
      ai = manifest?.resources.find((r: any) => r.id === node.aiBinding);
    if (
      sourceReductionCapabilities.some(
        (c) => !entry?.capabilities.includes(c),
      ) ||
      !entry?.resources.includes(node.binding) ||
      !entry?.resources.includes(node.aiBinding) ||
      source?.kind !== "conversation-source" ||
      source.access !== "read" ||
      ai?.kind !== "ai" ||
      ai.access !== "use"
    )
      throw Error("来源整理入口未声明准确只读来源与本人AI资源");
  }
}
