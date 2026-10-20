import { assertBatchDeclaration, batchCapability } from './entry-batch-decision.mjs';
/** Pure protocol relationships. A valid value is never a permit to execute a Run. */
export const batchSessionPolicy = 'stable-scope-v1';
export const batchTerminalPhases = new Set(['stopped', 'completed', 'interrupted']);
type Hasher = (value: unknown) => string;
const fail = (message: string): never => { throw Error(message); };
function instant(value: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value)
    fail('批次记录时间无效');
  return time;
}
export function assertEntryBatching(entry: any, resultSchema: unknown): void {
  if (!entry || !Array.isArray(entry.capabilities)) fail('入口能力声明无效');
  const present = Object.hasOwn(entry, 'batching');
  if (present !== entry.capabilities.includes(batchCapability))
    fail('连续批次映射与入口能力须同时明确声明');
  if (present) assertBatchDeclaration(entry.batching, resultSchema);
}
/** Full RunReview environment validation must run before this projection. */
export function stableBatchAuthorization(value: any): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('连续运行授权来源无效');
  const allowed = new Set(['paths', 'browsers', 'template', 'embedded']);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    fail('此一次性目标或授权类型尚不支持连续运行');
  if (!Array.isArray(value.paths) || !Array.isArray(value.browsers))
    fail('连续运行资源身份不完整');
  // Only the embedded document observation is temporary. Binding and path
  // identities remain, while the original full observation is saved per Run.
  const { embedded: _observation, ...stable } = value;
  return structuredClone(stable);
}
function sameLink(link: any, view: any): void {
  if (
    link.sessionId !== view.sessionId || link.scopeSha256 !== view.scopeSha256 ||
    link.ordinal > view.startedBatches
  ) fail('批次链接与连续运行来源不一致');
}
/** Validate the JSON Schema first; this checks cross-field identities only. */
export function verifyBatchSession(view: any, digest: Hasher): void {
  if (view.scopeSha256 !== digest(view.scope) || view.scope.flowId !== view.flowId)
    fail('连续运行固定范围摘要不一致');
  if (view.finishedBatches > view.startedBatches)
    fail('连续运行批次数关系无效');
  for (const link of [view.current, view.previous, view.lastDecision?.run])
    if (link) { sameLink(link, view); instant(link.createdAt); }
  if (view.current) {
    if (view.current.ordinal !== view.startedBatches ||
        view.finishedBatches !== view.startedBatches - 1)
      fail('当前批次与已登记序号不一致');
    if (view.previous &&
        (view.previous.ordinal >= view.current.ordinal || view.previous.runId === view.current.runId))
      fail('当前批次不能复用上一批链接');
  }
  if (['waiting', 'completed', 'stopped'].includes(view.phase) &&
      view.finishedBatches !== view.startedBatches)
    fail('上一批尚未结束，不能声明等待或停止完成');
  if (view.phase === 'waiting' || view.phase === 'completed') {
    if (!view.previous || !view.lastDecision ||
        view.previous.runId !== view.lastDecision.run.runId ||
        view.previous.ordinal !== view.startedBatches ||
        view.lastDecision.run.ordinal !== view.previous.ordinal)
      fail('连续运行决策不属于准确上一批');
  }
  if (view.startedBatches > view.limits.maxBatches)
    fail('已登记批次超过本次有限设置');
  if (batchTerminalPhases.has(view.phase) &&
      (view.current || view.nextAt || view.checkingNext || view.live))
    fail('已结束连续运行不能仍安排后续批次');
  if (view.phase !== 'waiting' && (view.nextAt || view.checkingNext))
    fail('后续预检只属于等待中的连续运行');
  const created = instant(view.createdAt), deadline = instant(view.dispatchDeadline);
  instant(view.updatedAt); // A wall-clock change does not order revisions.
  if (deadline <= created)
    fail('连续运行时间范围无效');
  if (deadline - created !== view.limits.maxDurationMs)
    fail('调度截止与本次有限设置不一致');
  if (view.nextAt && instant(view.nextAt) > deadline)
    fail('下一批安排超过调度截止');
}
export function verifyBatchAdmission(proof: any, view: any, previous: any): void {
  instant(proof.observedAt);
  instant(proof.run.createdAt);
  sameLink(proof.run, view);
  if (proof.processSha256 !== view.scope.processSha256 ||
      proof.run.ordinal !== view.startedBatches ||
      proof.run.runId !== view.current?.runId)
    fail('批次准入证明不属于当前进程和唯一登记');
  if (proof.run.ordinal === 1 ? proof.previousRunId !== undefined :
      !previous || proof.previousRunId !== previous.runId ||
      previous.sessionId !== view.sessionId ||
      previous.scopeSha256 !== view.scopeSha256 ||
      previous.ordinal !== proof.run.ordinal - 1)
    fail('批次准入的前序关系不一致');
}
/** Caller verifies the actual protected source and full value before making this proof. */
export function verifyBatchDecisionProof(proof: any, view: any, link: any): void {
  sameLink(proof.run, view);
  if (proof.run.runId !== link.runId || proof.run.ordinal !== link.ordinal ||
      link.sessionId !== view.sessionId || link.scopeSha256 !== view.scopeSha256)
    fail('批次决策不属于当前已结束Run');
}
export function verifyBatchStopReceipt(request: any, receipt: any, digest: Hasher): void {
  instant(receipt.requestedAt);
  if (request.requestId !== receipt.requestId || request.sessionId !== receipt.sessionId ||
      request.mode !== receipt.mode || receipt.fingerprint !== digest(request))
    fail('停止回执与原请求不一致');
}
/** Pages scan bounded storage rows; an empty match page may still have a cursor. */
export function verifyBatchPage(request: any, page: any, history = false): void {
  const key = history ? 'sessionId' : 'flowId';
  if (request[key] !== page[key] ||
      (request.cursor && (request.cursor[key] !== request[key] ||
        request.cursor.ceiling !== page.ceiling)))
    fail('连续运行读取游标来源不一致');
  const before = request.cursor?.before ?? page.ceiling + 1;
  if (before > page.ceiling + 1) fail('连续运行读取游标超出固定范围');
  let prior = before;
  const identities = new Set<string>();
  const ordinals = new Set<number>();
  for (const item of page.items) {
    if (item.position >= prior || item.position > page.ceiling)
      fail('连续运行读取范围或顺序不一致');
    prior = item.position;
    const row = history ? item.row : item.session;
    instant(row.createdAt);
    if (row[key] !== request[key]) fail('连续运行页包含其他来源');
    const identity = history ? row.runId : row.sessionId;
    if (identities.has(identity)) fail('连续运行页包含重复链接');
    identities.add(identity);
    if (history) {
      if (row.scopeSha256 !== page.scopeSha256 || ordinals.has(row.ordinal))
        fail('批次历史范围不一致或序号重复');
      ordinals.add(row.ordinal);
    }
  }
  if (page.scannedCount < page.items.length) fail('扫描计数小于返回记录');
  if (!page.scannedCount && page.nextCursor) fail('空扫描不能继续推进游标');
  if (page.nextCursor && (page.nextCursor[key] !== request[key] ||
      page.nextCursor.ceiling !== page.ceiling || page.nextCursor.before >= before ||
      page.nextCursor.before > prior))
    fail('连续运行读取游标没有向前推进');
}
