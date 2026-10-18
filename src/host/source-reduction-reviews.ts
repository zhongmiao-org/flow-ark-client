import {
  createSourceReductionRunReview,
  assertSourceReductionRunReviewCurrent,
  SOURCE_REDUCTION_REVIEW_LIMITS,
  sourceReductionRunConfirmation,
  sourceReductionRunReviewReceipt,
  validateSourceReductionRunReviewReceipt,
  type SourceReductionReviewContext,
} from '../../contracts/source-reduction-review';
import {
  reductionRunConfirmation,
  type ReductionTarget,
  type SourceReductionRunReview,
  type SourceReductionRunPlan,
  type SourceReductionRunConfirmation,
  type SourceReductionRunReviewReceipt,
  type SourceReductionRecipe,
  type SourceReductionCheckpoint,
  type SourceReductionAttempt,
  type SourceReductionOutput,
  type SourceReductionConfirmationOutcome,
} from '../shared/source-reduction';
import { sourceReductionRecipeHash } from '../../contracts/source-reduction';
import type { RunRerunConfirmInput, RunRerunPreview } from '../shared/run-rerun';
import type { FlowRecord, PreparedScripts, Run } from '../shared/types';
import type { Store } from './store';
import type { SourceRerunScope } from './run-rerun';
import { uid, now, digest } from '../shared/utils';

export type ReductionSelection = ReductionTarget & { jobId: string };
type Registered = {
  selection: ReductionSelection;
  review: SourceReductionRunReview;
  plan?: { preview: RunRerunPreview; requestId: string };
};
type Context = { value: SourceReductionReviewContext; check: () => void };
type Job = {
  id: string;
  recipe: SourceReductionRecipe;
  checkpoint: SourceReductionCheckpoint;
  revision: number;
  phase: SourceReductionOutput['phase'];
  sequence: number;
  pending: number | null;
};
export type ReductionAdmission = {
  record: FlowRecord;
  target: ReductionTarget;
  jobId: string;
  recipe: SourceReductionRecipe;
  job?: Job;
};
export type ReductionPermit = {
  requestLimit: number;
  retry: boolean;
  authorize: () => void;
  beforeRequest: (job: Job, configurationRevision: string) => void;
  /** Called inside the same Store transaction as prepared -> dispatched. */
  dispatch: (job: Job, attempt: SourceReductionAttempt) => void;
  /** Called inside the same Store transaction as checkpoint advancement. */
  advance: (before: SourceReductionCheckpoint, next: SourceReductionCheckpoint) => void;
};
type Batch = {
  version: 1;
  runId: string;
  nodeInstance: string;
  reviewId: string;
  epoch: string;
  jobId: string;
  requestLimit: number;
  requests: number;
  sequence: number;
  checkpointSha256: string;
  startedAt: string;
};
type Confirmed = {
  fingerprint: string;
  confirmation: SourceReductionRunConfirmation;
  receipt: SourceReductionRunReviewReceipt;
};
export function reductionSnapshotHash(snapshot: FlowRecord & Partial<PreparedScripts>) {
  return digest({
    flow: snapshot.flow,
    bindings: snapshot.bindings,
    webTarget: snapshot.webTarget,
    outputTarget: snapshot.outputTarget,
    toolTargets: snapshot.toolTargets,
    desktopTarget: snapshot.desktopTarget,
    scripts: snapshot.scripts,
    scriptBundles: snapshot.scriptBundles,
    skillSnapshots: snapshot.skillSnapshots,
    templateData: snapshot.templateData,
    authorSdk: snapshot.authorSdk,
  });
}

/** Host-owned previews and scoped receipts; preview creation never authorizes execution. */
export class SourceReductionReviews {
  private readonly epoch = uid();
  private registered = new Map<string, Registered>();
  constructor(
    private store: Store,
    private deps: {
      context: (selection: ReductionSelection, epoch: string) => Promise<Context>;
      plan: (id: string) => Promise<RunRerunPreview>;
      create: (
        input: RunRerunConfirmInput,
        check: () => void,
        scope: SourceRerunScope,
      ) => Promise<Run>;
      configurationGuard: (provider: string) => () => void;
      authorize: (run: Run, snapshot: FlowRecord) => void;
      error: (error: unknown) => string;
      hasSourceJobs: (runId: string) => boolean;
    },
  ) {}

  async preview(selection: ReductionSelection): Promise<SourceReductionRunReview> {
    const actual = await this.deps.context(selection, this.epoch);
    actual.check();
    const createdAt = now();
    this.prune(Date.parse(createdAt));
    if (this.registered.size >= 128) throw Error('来源范围核对数量达到上限，请稍后重试');
    const review: SourceReductionRunReview = createSourceReductionRunReview(
      actual.value,
      uid(),
      createdAt,
      new Date(Date.parse(createdAt) + SOURCE_REDUCTION_REVIEW_LIMITS.lifetimeMs).toISOString(),
    );
    // The registry has its own clone; Renderer can never replace the host authority.
    this.registered.set(review.reviewId, {
      selection: structuredClone(selection),
      review: structuredClone(review),
    });
    return structuredClone(review);
  }

  /** Confirmation must retrieve this original registration, not accept a client review object. */
  async current(reviewId: string) {
    const entry = this.registered.get(reviewId);
    if (!entry) throw Error('来源范围核对不存在或应用已重启，请重新核对');
    const actual = await this.deps.context(entry.selection, this.epoch);
    const check = () => {
      actual.check();
      assertSourceReductionRunReviewCurrent(entry.review, actual.value, now());
    };
    check();
    return { review: structuredClone(entry.review), actual: actual.value, check };
  }

  async plan(selection: ReductionSelection): Promise<SourceReductionRunPlan> {
    const review = await this.preview(selection);
    const plan = await this.deps.plan(selection.runId);
    if (Buffer.byteLength(JSON.stringify(plan), 'utf8') > 512 * 1024)
      throw Error('整体运行核对内容超出范围，请缩小流程后重新核对');
    const current = await this.current(review.reviewId);
    current.check();
    const entry = this.registered.get(review.reviewId)!;
    entry.plan = { preview: structuredClone(plan), requestId: uid() };
    return { source: structuredClone(review), run: structuredClone(plan) };
  }

  private previous(input: SourceReductionRunConfirmation): Run | undefined {
    const old = this.store.get<Confirmed>('source-run-confirmation', input.requestId);
    if (!old) return;
    if (old.fingerprint !== digest(input)) throw Error('来源确认身份已用于不同内容');
    const receipt = validateSourceReductionRunReviewReceipt(old.receipt);
    const run = this.store.get<Run>('run', receipt.runId);
    if (!run || digest(this.store.get('source-run-receipt', run.id)) !== digest(receipt))
      throw Error('来源确认回执不完整，已阻止重复创建');
    return run;
  }

  async confirm(raw: unknown, assertAdmission: () => void): Promise<Run> {
    const input = reductionRunConfirmation.parse(raw);
    // A lost reply never becomes a new grant, even after expiry or restart.
    const previous = this.previous(input);
    if (previous) return previous;
    const current = await this.current(input.reviewId);
    sourceReductionRunConfirmation(input, current.review, current.actual, now());
    const entry = this.registered.get(input.reviewId)!;
    if (!entry.plan) throw Error('请先核对原入口的完整执行范围');
    if (this.store.get('source-run-review-use', input.reviewId))
      throw Error('本次范围已绑定运行，请查看原确认回执；不能再次创建');
    let checked = current;
    const fingerprint = digest(input);
    return this.deps.create(
      {
        id: current.review.target.runId,
        mode: 'snapshot',
        debug: false,
        token: entry.plan.preview.token,
        requestId: entry.plan.requestId,
        reviewed: true,
      },
      assertAdmission,
      {
        fingerprint,
        validate: async () => {
          checked = await this.current(input.reviewId);
          sourceReductionRunConfirmation(input, checked.review, checked.actual, now());
          return () => {
            assertAdmission();
            checked.check();
            if (this.store.get('source-run-review-use', input.reviewId))
              throw Error('此范围已经绑定另一运行');
          };
        },
        persist: (run) => {
          checked.check();
          const snapshot = this.store.get<FlowRecord & PreparedScripts>('snapshot', run.id)!;
          if (
            run.versionId !== checked.review.executionVersionId ||
            reductionSnapshotHash(snapshot) !== checked.review.snapshotSha256
          )
            throw Error('新运行未保持原执行快照，请重新核对');
          const receipt: SourceReductionRunReviewReceipt = sourceReductionRunReviewReceipt(
            input,
            checked.review,
            checked.actual,
            run.id,
            run.createdAt,
          );
          this.store.put('source-run-receipt', run.id, receipt);
          this.store.put('source-run-review-use', input.reviewId, { runId: run.id, fingerprint });
          this.store.put('source-run-confirmation', input.requestId, {
            fingerprint,
            confirmation: input,
            receipt,
          } satisfies Confirmed);
        },
      },
    );
  }

  async confirmOutcome(
    raw: unknown,
    check: () => void,
  ): Promise<SourceReductionConfirmationOutcome> {
    const input = reductionRunConfirmation.parse(raw);
    try {
      return { status: 'created', run: await this.confirm(input, check) };
    } catch (error) {
      try {
        const prior = this.previous(input);
        if (prior) return { status: 'created', run: prior };
        if (!this.store.fault) return { status: 'blocked', error: this.deps.error(error) };
      } catch {
        // Failure to read a receipt never proves that creation did not happen.
      }
      return { status: 'unknown', error: this.deps.error(error) };
    }
  }

  hasReceipt(runId: string) {
    return this.store.get('source-run-receipt', runId) !== undefined;
  }

  private receipt(runId: string): SourceReductionRunReviewReceipt | undefined {
    const saved = this.store.get('source-run-receipt', runId);
    if (saved === undefined) return;
    const receipt: SourceReductionRunReviewReceipt = validateSourceReductionRunReviewReceipt(saved);
    const run = this.store.get<Run>('run', runId);
    const confirmation = this.store.get<Confirmed>('source-run-confirmation', receipt.requestId);
    if (
      receipt.runId !== runId ||
      run?.rerun?.runId !== receipt.review.target.runId ||
      !confirmation ||
      digest(confirmation.receipt) !== digest(receipt) ||
      digest(this.store.get('source-run-review-use', receipt.review.reviewId)) !==
        digest({ runId, fingerprint: confirmation.fingerprint })
    )
      throw Error('来源运行与持久确认回执不一致');
    return receipt;
  }

  async checkQueuedRun(runId: string) {
    const receipt = this.receipt(runId);
    if (!receipt) return;
    const actual = await this.deps.context(
      { ...receipt.review.target, jobId: receipt.review.job.jobId },
      this.epoch,
    );
    actual.check();
    assertSourceReductionRunReviewCurrent(receipt.review, actual.value, now());
  }

  async admit(input: ReductionAdmission): Promise<ReductionPermit | undefined> {
    const { target, job, recipe, jobId, record } = input;
    const run = this.store.get<Run>('run', target.runId);
    if (!run) throw Error('来源运行不存在');
    const receipt = this.receipt(run.id);
    if (!receipt && !run.rerun) return;
    // A branch never reached in the original Run may be a genuinely new task.
    // An already existing job still requires its own exact source review.
    if (!receipt && !job && run.rerun && !this.deps.hasSourceJobs(run.rerun.runId)) return;
    const authorize = () => {
      this.deps.authorize(run, record);
      if (receipt && receipt.review.epoch !== this.epoch)
        throw Error('应用已重启，不能继续旧的付费批次，请重新核对');
    };
    authorize();
    const zero: ReductionPermit = {
      requestLimit: 0,
      retry: false,
      authorize,
      beforeRequest: () => {
        throw Error('此来源实例只允许读取完整登记结果');
      },
      dispatch: () => {
        throw Error('此来源实例没有请求许可');
      },
      advance: () => {
        throw Error('此来源实例没有请求许可');
      },
    };
    if (!receipt || target.nodeInstance !== receipt.review.target.nodeInstance) {
      if (job?.phase === 'complete') return zero;
      throw Error('需要从准确来源实例核对执行范围；不能借用其他实例的许可');
    }
    const review = receipt.review;
    if (
      target.nodeId !== review.target.nodeId ||
      !job ||
      job.id !== review.job.jobId ||
      jobId !== review.job.jobId ||
      digest(job.checkpoint.job) !== digest(review.job) ||
      sourceReductionRecipeHash(recipe) !== review.job.recipeHash ||
      reductionSnapshotHash(record) !== review.snapshotSha256
    )
      throw Error('来源、原任务或动态输入已变化；未创建新整理任务或发出请求');
    const guard = this.deps.configurationGuard(review.provider);
    const actual = await this.deps.context(
      { ...review.target, jobId: review.job.jobId },
      this.epoch,
    );
    actual.check();
    assertSourceReductionRunReviewCurrent(review, actual.value, now());
    const key = digest({ runId: run.id, nodeInstance: target.nodeInstance });
    this.store.tx(() => {
      authorize();
      guard();
      actual.check();
      assertSourceReductionRunReviewCurrent(review, actual.value, now());
      if (this.store.get('source-run-batch', key))
        throw Error('本次运行的来源批次已经启动，不能再次消耗许可');
      this.store.put('source-run-batch', key, {
        version: 1,
        runId: run.id,
        nodeInstance: target.nodeInstance,
        reviewId: review.reviewId,
        epoch: this.epoch,
        jobId,
        requestLimit: review.requestLimit,
        requests: 0,
        sequence: job.sequence,
        checkpointSha256: job.checkpoint.sha256,
        startedAt: now(),
      } satisfies Batch);
    });
    const batch = () => {
      authorize();
      guard();
      const row = this.store.get<Batch>('source-run-batch', key);
      if (
        !row ||
        row.epoch !== this.epoch ||
        row.runId !== run.id ||
        row.nodeInstance !== target.nodeInstance ||
        row.jobId !== jobId ||
        row.reviewId !== review.reviewId ||
        row.requestLimit !== review.requestLimit ||
        !Number.isSafeInteger(row.requests) ||
        row.requests < 0 ||
        row.requests > row.requestLimit
      )
        throw Error('来源批次登记不一致，已停止请求');
      return row;
    };
    const check = (value: Job, revision: string) => {
      const row = batch();
      if (
        value.id !== jobId ||
        value.checkpoint.sha256 !== row.checkpointSha256 ||
        digest(value.checkpoint.job) !== digest(review.job) ||
        revision !== review.configurationRevision
      )
        throw Error('批次检查点或Key配置已变化，未发出新请求');
      return row;
    };
    return {
      requestLimit: review.requestLimit,
      retry: review.operation === 'retry-one',
      authorize: () => {
        batch();
      },
      beforeRequest: (value, revision) => {
        check(value, revision);
      },
      dispatch: (value, attempt) => {
        const row = check(value, attempt.configurationRevision);
        if (
          row.requests >= row.requestLimit ||
          attempt.runId !== run.id ||
          attempt.nodeInstance !== target.nodeInstance ||
          attempt.sequence !== row.sequence + 1 ||
          attempt.state !== 'prepared' ||
          attempt.checkpointSha256 !== row.checkpointSha256
        )
          throw Error('来源请求已达到本次上限或请求身份不一致');
        this.store.put('source-run-batch', key, {
          ...row,
          requests: row.requests + 1,
          sequence: attempt.sequence,
        });
      },
      advance: (before, next) => {
        const row = batch();
        if (
          before.sha256 !== row.checkpointSha256 ||
          next.revision !== before.revision + 1 ||
          digest(next.job) !== digest(review.job)
        )
          throw Error('批次推进不属于本次检查点');
        this.store.put('source-run-batch', key, { ...row, checkpointSha256: next.sha256 });
      },
    };
  }

  private prune(time: number) {
    for (const [id, entry] of this.registered)
      if (Date.parse(entry.review.expiresAt) <= time) this.registered.delete(id);
  }
}
