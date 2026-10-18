import { setImmediate as yieldImmediate } from 'node:timers/promises';
import {
  beginSourceReduction,
  validateSourceReductionRecipe,
  sourceReductionRecipeHash,
  sourceReductionRequest,
  sourceReductionTransport,
  sourceReductionAttemptId,
  validateSourceReductionAttempt,
  advanceSourceReduction,
  SourceReductionCoverage,
  validateSourceReductionOutput,
  sourceReductionUsage,
  assertSourceReductionNode,
} from '../../contracts/source-reduction';
import { conversationSourceRead } from '../../contracts/conversation-source';
import { generate } from '../ai/providers';
import { AIRequestFailureError } from '../ai/request-failure';
import { assertAISchema, aiBinding } from '../shared/ai-node';
import { digest, now } from '../shared/utils';
import { walk } from '../core/validate';
import {
  assertReductionAttempt,
  type ReductionNode,
  type ReductionTarget,
  type SourceReductionOutput as Output,
  type SourceReductionAttempt as Attempt,
  type SourceReductionRecipe as Recipe,
  type SourceReductionCheckpoint as Checkpoint,
  type SourceReductionProof as Proof,
} from '../shared/source-reduction';
import type { FlowRecord, Run } from '../shared/types';
import type { AINodeReceipt } from '../shared/types';
import type { AIConfiguration } from '../shared/ai-settings';
import type { Store } from './store';
import type { ConversationArchives } from './conversation-archives';
import type { ConversationSources } from './conversation-sources';
import type { SourceReductionReviewContext } from '../../contracts/source-reduction-review';
import type { ReductionAdmission, ReductionPermit } from './source-reduction-reviews';

const kinds = {
  job: 'source-reduction-job',
  attempt: 'source-reduction-attempt',
  index: 'source-reduction-run-index',
  result: 'source-reduction-run-result',
  proof: 'source-reduction-proof',
  action: 'source-reduction-action',
};
type Job = {
  id: string;
  owner: string;
  recipe: Recipe;
  checkpoint: Checkpoint;
  revision: number;
  phase: Output['phase'];
  sequence: number;
  pending: number | null;
  proof: Proof | null;
  attempts: number;
  reportedTotalTokens: number;
  unknownUsageRequests: number;
  error: string;
  updatedAt: string;
};
type Live = { runId: string; nodeInstance: string; abort: AbortController };
const resultKey = (t: ReductionTarget) => digest(t);
const attemptKey = (id: string, sequence: number) => `${id}:${sequence}`;
const add = (n: number, delta: number) => {
  const v = n + delta;
  if (!Number.isSafeInteger(v) || v < 0) throw Error('整理任务计数超界');
  return v;
};
const same = (a: unknown, b: unknown) => digest(a) === digest(b);
function until<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason ?? Error('整理已停止'));
    signal.addEventListener('abort', stop, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', stop))
      .catch(() => {});
    if (signal.aborted) stop();
  });
}

/** Finite batches only. Provider calls, durable intent and cursor advancement stay in the host. */
export class SourceReductions {
  private live = new Map<string, Live>();
  constructor(
    private store: Store,
    private archives: ConversationArchives,
    private sources: ConversationSources,
    private deps: {
      available: () => void;
      configuration: (provider: 'deepseek' | 'openai-codex') => Promise<AIConfiguration>;
      key: (provider: string, revision: string) => Promise<string>;
      secret: (key: string) => void;
      publish: (output: Output) => Promise<unknown>;
      current: (manifest: any) => boolean;
      error: (error: unknown) => string;
      receipt: (runId: string, nodeInstance: string, receipt: AINodeReceipt) => void;
      fetch?: typeof fetch;
      admit?: (input: ReductionAdmission) => Promise<ReductionPermit | undefined>;
    },
  ) {
    this.recoverStartup();
  }
  usesProvider(provider: string) {
    return [...this.live.keys()].some((id) => this.load(id).recipe.provider === provider);
  }

  private owner(record: FlowRecord, nodeInstance: string) {
    const t = record.bindings.template;
    return digest(
      t
        ? { instanceId: t.instanceId, entryId: t.entryId, nodeInstance }
        : { flowId: record.id, nodeInstance },
    );
  }
  private node(record: FlowRecord, nodeId: string, nodeInstance: string) {
    const n = walk(record.flow.steps).find((n) => n.id === nodeId);
    if (
      n?.type !== 'source-reduce' ||
      !(nodeInstance === n.id || nodeInstance.endsWith('/' + n.id))
    )
      throw Error('整理节点不属于本次运行快照');
    assertSourceReductionNode(n, record.flow.requiredCapabilities);
    return n;
  }
  private load(id: string): Job {
    const job = this.store.get<Job>(kinds.job, id);
    if (!job || job.id !== id) throw Error('整理任务不存在');
    this.output(job);
    return job;
  }
  private attempt(job: Job, sequence: number): Attempt {
    const a = this.store.get<Attempt>(kinds.attempt, attemptKey(job.id, sequence));
    assertReductionAttempt(a);
    if (
      a.sequence !== sequence ||
      a.attemptId !== sourceReductionAttemptId(job.id, sequence) ||
      !same(a.job, job.checkpoint.job)
    )
      throw Error('整理请求记录身份不一致');
    return a;
  }
  private output(job: Job): Output {
    const value = {
      version: 1 as const,
      job: job.checkpoint.job,
      phase: job.phase,
      revision: job.revision,
      checkpoint: job.checkpoint,
      pendingAttemptId: job.pending === null ? null : sourceReductionAttemptId(job.id, job.pending),
      attempts: job.attempts,
      reportedTotalTokens: job.reportedTotalTokens,
      unknownUsageRequests: job.unknownUsageRequests,
      proof: job.proof,
    };
    validateSourceReductionOutput(
      value,
      this.archives.sourceInfo(value.job.source).manifest,
      job.recipe,
    );
    return structuredClone(value);
  }
  private publish(job: Job) {
    void this.deps.publish(this.output(job)).catch(() => {});
  }
  private change(id: string, mutate: (job: Job) => void) {
    let next!: Job;
    this.store.tx(() => {
      next = this.load(id);
      mutate(next);
      next.revision = add(next.revision, 1);
      next.updatedAt = now();
      this.output(next);
      this.store.put(kinds.job, id, next);
    });
    this.publish(next);
    return next;
  }
  private contribution(a: Attempt) {
    const usage = a.outcome?.status === 'success' ? a.outcome.result.usage : a.outcome?.usage;
    const reported =
      usage && typeof usage.total_tokens === 'number' && Number.isSafeInteger(usage.total_tokens)
        ? usage.total_tokens
        : null;
    return a.state === 'prepared'
      ? { attempts: 0, tokens: 0, unknown: 0 }
      : { attempts: 1, tokens: reported ?? 0, unknown: reported === null ? 1 : 0 };
  }
  private putAttempt(job: Job, old: Attempt | null, next: Attempt) {
    assertReductionAttempt(next);
    const before = old ? this.contribution(old) : { attempts: 0, tokens: 0, unknown: 0 },
      after = this.contribution(next);
    job.attempts = add(job.attempts, after.attempts - before.attempts);
    job.reportedTotalTokens = add(job.reportedTotalTokens, after.tokens - before.tokens);
    job.unknownUsageRequests = add(job.unknownUsageRequests, after.unknown - before.unknown);
    this.store.put(kinds.attempt, attemptKey(job.id, next.sequence), next);
  }
  private *journal(job: Job) {
    for (let i = 1; i <= job.sequence; i++) yield this.attempt(job, i);
  }
  private recoverStartup() {
    const ceiling = this.store.lastPosition(kinds.job);
    let before = ceiling + 1;
    while (true) {
      const rows = this.store.page<Job>(kinds.job, ceiling, before, 20);
      if (!rows.length) break;
      for (const row of rows) {
        const j = row.value;
        if (j.phase !== 'running') continue;
        this.change(j.id, (job) => {
          if (job.pending !== null) {
            const old = this.attempt(job, job.pending);
            if (old.state === 'dispatched')
              this.putAttempt(job, old, { ...old, state: 'unknown', outcome: null });
            job.phase = 'attention';
            job.error = '上次整理已中断，请核对未提交请求；不会自动重新收费。';
          } else job.phase = 'ready';
        });
      }
      before = rows.at(-1)!.position;
    }
  }
  private ai(record: FlowRecord, id: string) {
    const value = record.bindings.resources?.[id];
    if (!value || Object.keys(value).some((k) => !['provider', 'model'].includes(k)))
      throw Error('整理AI需要独立服务与模型绑定，不能混入其他资源');
    return aiBinding(record.bindings, id, 2);
  }
  async preflight(record: FlowRecord, reviewedSource = false) {
    for (const node of walk(record.flow.steps).filter(
      (n): n is ReductionNode => n.type === 'source-reduce',
    )) {
      assertSourceReductionNode(node, record.flow.requiredCapabilities);
      assertAISchema(node.schema);
      this.sources.assertBinding(record, node.binding);
      if (reviewedSource) continue;
      const binding = this.ai(record, node.aiBinding),
        config = await this.deps.configuration(binding.provider);
      if (!config.configured || !config.revision) throw Error('来源整理需要先配置用户自己的AI Key');
    }
  }
  private target(t: ReductionTarget, id?: string) {
    const run = this.store.get<Run>('run', t.runId),
      record = this.store.get<FlowRecord>('snapshot', t.runId);
    if (!run || !record) throw Error('原运行或固定快照不存在');
    this.node(record, t.nodeId, t.nodeInstance);
    const linked = this.store.get<{ jobId: string; owner: string }>(kinds.index, resultKey(t));
    if (!linked) {
      if (id) throw Error('本次运行未引用此整理任务');
      return null;
    }
    const job = this.load(linked.jobId);
    if (
      (id && id !== job.id) ||
      linked.owner !== this.owner(record, t.nodeInstance) ||
      job.owner !== linked.owner
    )
      throw Error('整理任务不属于所选运行与实例');
    return job;
  }
  forRun(t: ReductionTarget) {
    const j = this.target(t);
    return j ? this.view(j) : null;
  }
  hasJobsForRun(runId: string) {
    const snapshot = this.store.get<FlowRecord>('snapshot', runId);
    if (!snapshot) return false;
    const nodes = new Set(
      walk(snapshot.flow.steps)
        .filter((n) => n.type === 'source-reduce')
        .map((n) => n.id),
    );
    for (const instance of new Set(
      this.store
        .events(runId)
        .map((e) => e.nodeInstance)
        .filter(Boolean),
    )) {
      const nodeId = instance.split('/').at(-1)!;
      if (
        nodes.has(nodeId) &&
        this.store.get(kinds.index, resultKey({ runId, nodeId, nodeInstance: instance }))
      )
        return true;
    }
    return false;
  }
  detail(t: ReductionTarget, id: string) {
    return this.view(this.target(t, id)!);
  }
  /** Private source data for host projection. Never return this context to Renderer. */
  reviewContext(t: ReductionTarget, id: string) {
    this.deps.available();
    const j = this.target(t, id)!;
    if (this.live.has(id) || j.phase === 'running')
      throw Error('整理任务正在运行或收尾，请稍后重新核对');
    const snapshot = this.store.get<FlowRecord>('snapshot', t.runId)!;
    const node = this.node(snapshot, t.nodeId, t.nodeInstance);
    const source = this.sources.assertBinding(snapshot, node.binding);
    const binding = this.ai(snapshot, node.aiBinding);
    if (
      !same(source, j.checkpoint.job.source) ||
      !same(binding, { provider: j.recipe.provider, model: j.recipe.model })
    )
      throw Error('原任务的来源或模型绑定已不匹配，请核对原记录');
    const ordinal = j.checkpoint.next?.recordOrdinal;
    return {
      target: structuredClone(t),
      node: structuredClone(node),
      capabilities: [...snapshot.flow.requiredCapabilities],
      manifest: this.archives.sourceInfo(source).manifest,
      recipe: structuredClone(j.recipe),
      output: this.output(j),
      pendingAttempt: j.pending === null ? null : this.attempt(j, j.pending),
      record: ordinal === undefined ? null : this.archives.sourceRecord(source, ordinal),
      previousRecord:
        ordinal === undefined || ordinal === 1
          ? null
          : this.archives.sourceRecord(source, ordinal - 1),
    } satisfies Omit<
      SourceReductionReviewContext,
      'epoch' | 'executionVersionId' | 'snapshotSha256' | 'configurationRevision'
    >;
  }
  private view(j: Job) {
    return { output: this.output(j), busy: this.live.has(j.id), error: j.error };
  }
  attempts(t: ReductionTarget, id: string, before: number | null) {
    const j = this.target(t, id)!;
    let at = before ?? add(j.sequence, 1);
    if (at > j.sequence + 1) throw Error('整理请求目录位置无效');
    const rows = [];
    while (at > 1 && rows.length < 20) {
      const a = this.attempt(j, --at);
      rows.push({
        sequence: a.sequence,
        attemptId: a.attemptId,
        state: a.state,
        requestSha256: a.requestSha256,
        dispatched: a.transport !== null,
        recordOrdinal: (a.request.input as any).fragment.cursor.recordOrdinal,
        byteOffset: (a.request.input as any).fragment.chunk.byteOffset,
        byteEnd: (a.request.input as any).fragment.chunk.byteEnd,
        provider: a.request.provider,
        model: a.request.model,
        outcome: a.outcome?.status ?? null,
        usage:
          a.outcome?.status === 'success' ? a.outcome.result.usage : (a.outcome?.usage ?? null),
      });
    }
    return { rows, next: at > 1 ? at : null };
  }
  readAttempt(t: ReductionTarget, id: string, sequence: number) {
    const j = this.target(t, id)!;
    if (sequence > j.sequence) throw Error('请求序号超出任务范围');
    return structuredClone(this.attempt(j, sequence));
  }
  private action(t: ReductionTarget, id: string, revision: number, pendingAttemptId: string) {
    this.deps.available();
    const j = this.target(t, id)!;
    if (
      this.live.has(id) ||
      j.revision !== revision ||
      j.pending === null ||
      sourceReductionAttemptId(id, j.pending) !== pendingAttemptId ||
      j.phase !== 'attention'
    )
      throw Error('整理任务正在运行或已变化，请重新读取；原进度保留');
    return j;
  }
  async recover(
    t: ReductionTarget,
    id: string,
    revision: number,
    pendingAttemptId: string,
    requestId: string,
  ) {
    const key = digest({ id, requestId }),
      inputHash = digest({ t, id, revision, pendingAttemptId }),
      old = this.store.get<{ inputHash: string; result: Output }>(kinds.action, key);
    this.target(t, id);
    if (old) {
      if (old.inputHash !== inputHash) throw Error('恢复请求身份已使用');
      return { output: old.result, busy: false, error: '' };
    }
    const j = this.action(t, id, revision, pendingAttemptId),
      a = this.attempt(j, j.pending!);
    if (a.state !== 'response') throw Error('未保存可采用的完整响应；可保留进度或核对后另发请求');
    const result = await this.commit(
      j,
      a,
      () => {
        const live = this.target(t, id)!;
        if (this.live.has(id) || live.revision !== revision)
          throw Error('整理任务已变化，未覆盖当前进度');
      },
      { key, inputHash },
    );
    return this.view(result);
  }
  private async proof(job: Job, candidate: Attempt, final: Checkpoint, check: () => void) {
    const m = this.archives.sourceInfo(job.checkpoint.job.source).manifest,
      scan = new SourceReductionCoverage(m, job.recipe, job.id);
    for (let i = 1; i <= job.sequence; i++) {
      check();
      const a =
        i === candidate.sequence
          ? { ...candidate, state: 'committed' as const }
          : this.attempt(job, i);
      if (a.state === 'committed') {
        const ordinal = (a.request.input as any).fragment.cursor.recordOrdinal;
        scan.append(
          a,
          this.archives.sourceRecord(a.job.source, ordinal),
          ordinal === 1 ? null : this.archives.sourceRecord(a.job.source, ordinal - 1),
        );
      }
      if (i % 16 === 0) await yieldImmediate();
    }
    return scan.finish(final) as Proof;
  }
  private async commit(
    job: Job,
    attempt: Attempt,
    check: () => void,
    action?: { key: string; inputHash: string },
    advance?: ReductionPermit['advance'],
  ) {
    const m = this.archives.sourceInfo(job.checkpoint.job.source).manifest,
      ordinal = (attempt.request.input as any).fragment.cursor.recordOrdinal;
    const next = advanceSourceReduction(
      job.checkpoint,
      attempt,
      m,
      job.recipe,
      this.archives.sourceRecord(attempt.job.source, ordinal),
      ordinal === 1 ? null : this.archives.sourceRecord(attempt.job.source, ordinal - 1),
    ) as Checkpoint;
    const proof = next.next === null ? await this.proof(job, attempt, next, check) : null;
    check();
    return this.change(job.id, (j) => {
      check();
      const a = this.attempt(j, attempt.sequence);
      if (
        j.pending !== attempt.sequence ||
        j.checkpoint.sha256 !== job.checkpoint.sha256 ||
        a.state !== 'response' ||
        !same(a, attempt)
      )
        throw Error('完整响应或检查点已经变化，未重复推进');
      this.putAttempt(j, a, { ...a, state: 'committed' });
      j.checkpoint = next;
      advance?.(job.checkpoint, next);
      j.pending = null;
      j.phase = proof ? 'complete' : 'ready';
      j.proof = proof;
      j.error = '';
      if (proof) {
        const totals = sourceReductionUsage(j.checkpoint.job, this.journal(j));
        if (
          totals.attempts !== j.attempts ||
          totals.reportedTotalTokens !== j.reportedTotalTokens ||
          totals.unknownUsageRequests !== j.unknownUsageRequests
        )
          throw Error('实际请求累计用量与任务不一致');
        this.store.put(kinds.proof, proof.sha256, { jobId: j.id, proof });
      }
      if (action)
        this.store.put(kinds.action, action.key, {
          inputHash: action.inputHash,
          result: this.output({ ...j, revision: j.revision + 1 }),
        });
    });
  }
  private async response(
    id: string,
    sequence: number,
    outcome: Attempt['outcome'],
    localError: string,
  ) {
    return this.change(id, (j) => {
      const a = this.attempt(j, sequence),
        pending = j.pending === sequence;
      if (a.state === 'committed') return;
      const success = outcome?.status === 'success';
      const state: Attempt['state'] = !a.transport
        ? 'prepared'
        : !pending || a.state === 'abandoned'
          ? 'abandoned'
          : success
            ? 'response'
            : outcome
              ? 'failed'
              : 'unknown';
      this.putAttempt(j, a, { ...a, state, outcome: a.transport ? outcome : null });
      if (a.transport && outcome && !this.store.get('source-reduction-usage-event', a.attemptId)) {
        const receipt: AINodeReceipt =
          outcome.status === 'success'
            ? {
                status: 'success',
                provider: outcome.result.provider,
                model: outcome.result.model,
                requestId: outcome.result.requestId || null,
                usage: outcome.result.usage,
              }
            : outcome;
        this.deps.receipt(a.runId, a.nodeInstance, receipt);
        this.store.put('source-reduction-usage-event', a.attemptId, {
          receiptSha256: digest(receipt),
        });
      }
      if (pending) {
        j.error = localError;
        if (!success || this.live.get(id)?.abort.signal.aborted) j.phase = 'attention';
      }
    });
  }
  async perform(
    record: FlowRecord,
    t: ReductionTarget,
    seed: unknown,
    runSignal: AbortSignal,
    checkRun: () => void,
  ) {
    this.deps.available();
    checkRun();
    const node = this.node(record, t.nodeId, t.nodeInstance),
      source = this.sources.assertBinding(record, node.binding),
      m = this.archives.sourceInfo(source).manifest,
      binding = this.ai(record, node.aiBinding);
    assertAISchema(node.schema);
    const recipe = validateSourceReductionRecipe({
        version: 1,
        ...binding,
        instructions: node.instructions,
        schema: node.schema,
        seed,
      }) as Recipe,
      owner = this.owner(record, t.nodeInstance),
      id =
        'sr_' + digest({ owner, source, recipe: sourceReductionRecipeHash(recipe) }).slice(0, 40);
    let j = this.store.get<Job>(kinds.job, id);
    if (j) {
      this.output(j);
      if (j.owner !== owner || !same(j.recipe, recipe) || !same(j.checkpoint.job.source, source))
        throw Error('整理任务的来源或规则不一致');
    }
    // The resolved seed is known here, before creating a job or reading any Key.
    const permit = await this.deps.admit?.({ record, target: t, jobId: id, recipe, job: j });
    checkRun();
    if (permit?.requestLimit === 0 && j?.phase !== 'complete')
      throw Error('本次来源实例只允许读取已完整登记的结果');
    if (!j) {
      j = {
        id,
        owner,
        recipe,
        checkpoint: beginSourceReduction(m, recipe, id),
        revision: 1,
        phase: 'ready',
        sequence: 0,
        pending: null,
        proof: null,
        attempts: 0,
        reportedTotalTokens: 0,
        unknownUsageRequests: 0,
        error: '',
        updatedAt: now(),
      };
      this.store.tx(() => {
        if (this.store.get(kinds.job, id)) throw Error('整理任务已建立，请重新读取');
        this.output(j!);
        this.store.put(kinds.job, id, j);
      });
    }
    if (j.owner !== owner || !same(j.recipe, recipe) || !same(j.checkpoint.job.source, source))
      throw Error('整理任务的来源或规则不一致');
    this.store.put(kinds.index, resultKey(t), { jobId: id, owner });
    if (this.live.has(id)) throw Error('此整理任务正在处理另一批请求');
    if (j.phase === 'attention') {
      if (!permit?.retry) return this.result(t, j);
      const revision = j.revision,
        pending = j.pending,
        checkpoint = j.checkpoint.sha256;
      j = this.change(id, (job) => {
        permit.authorize();
        if (
          job.revision !== revision ||
          job.pending !== pending ||
          job.checkpoint.sha256 !== checkpoint
        )
          throw Error('重试核对已变化');
        const a = this.attempt(job, job.pending!);
        if (a.transport) this.putAttempt(job, a, { ...a, state: 'abandoned' });
        job.pending = null;
        job.phase = 'ready';
        job.error = '';
      });
    }
    if (j.phase === 'complete') return this.result(t, j);
    const live = { runId: t.runId, nodeInstance: t.nodeInstance, abort: new AbortController() };
    this.live.set(id, live);
    const signal = AbortSignal.any([runSignal, live.abort.signal]);
    const check = () => {
      signal.throwIfAborted();
      checkRun();
      this.deps.available();
      permit?.authorize();
    };
    const deadline = Date.now() + (node.timeoutMs ?? 1800000) - 6000;
    try {
      for (let n = 0; n < (permit?.requestLimit ?? node.maxRequests); n++) {
        check();
        j = this.load(id);
        if (j.phase === 'complete' || j.phase === 'attention') break;
        if (n > 0 && deadline - Date.now() < 125000) break;
        if (deadline <= Date.now())
          throw Error('整理时间预算不足，请增加节点超时后再运行；未发出新请求。');
        const ordinal = j.checkpoint.next!.recordOrdinal,
          row = this.archives.sourceRecord(source, ordinal),
          prev = ordinal === 1 ? null : this.archives.sourceRecord(source, ordinal - 1),
          read = conversationSourceRead(m, j.checkpoint.next, row, prev),
          request = sourceReductionRequest(m, recipe, j.checkpoint, read, row, prev);
        const config = await until(this.deps.configuration(binding.provider), signal);
        check();
        if (!config.configured || !config.revision) throw Error('本人AI Key配置不可用');
        permit?.beforeRequest(j, config.revision);
        const key = await until(this.deps.key(binding.provider, config.revision), signal);
        check();
        if (typeof key !== 'string' || !key.trim()) throw Error('本人AI Key不可用');
        this.deps.secret(key);
        const sequence = add(j.sequence, 1),
          intent: Attempt = {
            version: 1,
            attemptId: sourceReductionAttemptId(id, sequence),
            job: j.checkpoint.job,
            sequence,
            checkpointRevision: j.checkpoint.revision,
            checkpointSha256: j.checkpoint.sha256,
            runId: t.runId,
            nodeInstance: t.nodeInstance,
            configurationRevision: config.revision,
            state: 'prepared',
            request,
            requestSha256: digest(request),
            transport: null,
            outcome: null,
          };
        validateSourceReductionAttempt(intent, m, recipe, j.checkpoint, row, prev);
        j = this.change(id, (job) => {
          check();
          if (
            job.checkpoint.sha256 !== intent.checkpointSha256 ||
            job.pending !== null ||
            job.sequence !== sequence - 1
          )
            throw Error('请求建立前任务已变化');
          job.sequence = sequence;
          job.pending = sequence;
          job.phase = 'running';
          job.error = '';
          this.putAttempt(job, null, intent);
        });
        const fetcher: typeof fetch = async (url, options) => {
          check();
          const transport = sourceReductionTransport(request, String(options?.body ?? ''));
          this.change(id, (job) => {
            check();
            const a = this.attempt(job, sequence);
            if (job.pending !== sequence || a.state !== 'prepared')
              throw Error('请求发出意图已失效');
            permit?.dispatch(job, a);
            this.putAttempt(job, a, { ...a, state: 'dispatched', transport });
          });
          check();
          return (this.deps.fetch ?? fetch)(url, options);
        };
        // Observe the real adapter promise before racing cancellation; durable response is independent of adoption.
        const requestSignal = AbortSignal.any([
          signal,
          AbortSignal.timeout(Math.max(1, Math.min(120000, deadline - Date.now()))),
        ]);
        const observed = generate(request, key, requestSignal, fetcher, [], 'planning', true).then(
          async (result) => {
            await this.response(id, sequence, { status: 'success', result }, '');
          },
          async (error) => {
            await this.response(
              id,
              sequence,
              error instanceof AIRequestFailureError ? error.failure : null,
              this.deps.error(error).slice(0, 2000),
            );
          },
        );
        await until(observed, signal);
        check();
        j = this.load(id);
        if (j.phase === 'attention') break;
        const a = this.attempt(j, sequence);
        if (a.state !== 'response') {
          j = this.change(id, (job) => {
            job.phase = 'attention';
            job.error = '请求未取得可采用的完整响应，请核对记录。';
          });
          break;
        }
        j = await this.commit(j, a, check, undefined, permit?.advance);
      }
      return this.result(t, this.load(id));
    } catch (error) {
      try {
        j = this.change(id, (job) => {
          if (job.pending !== null) {
            const a = this.attempt(job, job.pending);
            if (a.state === 'dispatched')
              this.putAttempt(job, a, { ...a, state: 'unknown', outcome: null });
            job.phase = 'attention';
          }
          job.error = this.deps.error(error).slice(0, 2000);
        });
      } catch {
        /* Preserve durable state on storage failure. */
      }
      throw error;
    } finally {
      this.live.delete(id);
      try {
        this.change(id, () => {});
      } catch {
        /* Host reports store fault; no network recovery here. */
      }
    }
  }
  private result(t: ReductionTarget, j: Job) {
    const output = this.output(j),
      key = resultKey(t),
      old = this.store.get<Output>(kinds.result, key);
    if (old && !same(old, output)) throw Error('同一步骤整理结果身份已使用');
    if (!old) this.store.put(kinds.result, key, output);
    return output;
  }
  verifyResult(t: ReductionTarget, value: unknown) {
    const j = this.target(t);
    const original = this.store.get<Output>(kinds.result, resultKey(t));
    if (!j || !original || !same(original, value))
      throw Error('整理结果与准确运行的持久收据不一致');
    validateSourceReductionOutput(
      value,
      this.archives.sourceInfo(j.checkpoint.job.source).manifest,
      j.recipe,
    );
  }
  verifyEvidence(evidence: any, current: boolean) {
    const p = evidence.proof,
      registration = p && this.store.get<{ jobId: string; proof: Proof }>(kinds.proof, p.sha256);
    if (evidence.kind !== 'source-reduction' || !registration || !same(registration.proof, p))
      throw Error('Skill来源缺少本机登记的完整模型覆盖');
    const j = this.load(registration.jobId),
      m = this.archives.sourceInfo(j.checkpoint.job.source).manifest;
    if (j.phase !== 'complete' || !same(j.proof, p)) throw Error('完整覆盖不属于准确最终草稿');
    if (current && !this.deps.current(m))
      throw Error('来源已有新的资料或访谈，请先核对最新完整来源');
  }
  cancel(runId: string, nodeInstance?: string) {
    for (const live of this.live.values())
      if (live.runId === runId && (!nodeInstance || live.nodeInstance === nodeInstance))
        live.abort.abort(Error('本批整理已取消'));
  }
  async stop() {
    for (const live of this.live.values()) live.abort.abort(Error('应用正在退出或休眠'));
  }
}
