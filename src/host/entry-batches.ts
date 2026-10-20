import type { Store } from './store';
import { EntryBatchRecords } from './entry-batch-records';
import type { FlowRecord, PreparedScripts, Run } from '../shared/types';
import type { ReuseCapture } from './entry-results';
import type {
  BatchAdmissionProof,
  BatchDeclaration,
  BatchDecisionProof,
  BatchLimits,
  BatchScope,
  BatchSessionView,
  BatchStopReason,
  BatchStopRequest,
} from '../shared/entry-batches';
import { batchLimitsSchema, batchMethods } from '../shared/entry-batches';
import { digest, now, redact, uid } from '../shared/utils';
import { validateObject } from '../core/validate';
import { validateData } from '../../contracts/package-format';
import {
  assertBatchDeclaration,
  extractBatchDecision,
} from '../../contracts/entry-batch-decision.mjs';
import {
  batchTerminalPhases,
  stableBatchAuthorization,
  verifyBatchDecisionProof,
  verifyBatchAdmission,
} from '../../contracts/entry-batches';

export type BatchPrepared = {
  record: FlowRecord;
  prepared: PreparedScripts;
  authorization: unknown;
};
export type BatchDefinition = {
  owner: BatchScope['owner'];
  entryName: string;
  ownerName: string;
  declaration: BatchDeclaration;
  schema: unknown;
  configuration: unknown;
};
export type BatchPlan = BatchPrepared &
  BatchDefinition & {
    limits: BatchLimits;
    scope: BatchScope;
    scopeSha256: string;
  };
type Permit = {
  plan: BatchPlan;
  guard: () => void;
  wall: number;
  mono: number;
  nextMono?: number;
  invalid?: BatchStopReason;
};
type Private = { plan: BatchPlan; next?: { ordinal: number; runId: string } };
type Deps = {
  available: () => void;
  idle: () => boolean;
  serialize: <T>(fn: () => Promise<T>) => Promise<T>;
  definition: (record: FlowRecord, prepared: PreparedScripts) => Promise<BatchDefinition>;
  guard: (prepared: PreparedScripts) => () => void;
  prepareNext: (plan: BatchPlan) => Promise<BatchPrepared>;
  dispatch: () => void;
  cancel: (id: string) => Promise<boolean>;
  unresolved: (runId: string) => boolean;
};
const terminalRun = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']);
const names = (value: string, fallback: string) => {
  const result = redact(value) as string;
  return result.trim() && result.length <= 200 && !/[\uD800-\uDFFF]/.test(result)
    ? result
    : fallback;
};
/** Host-only supervision. No timer or persisted record reconstructs an execution permit. */
export class EntryBatches {
  readonly records: EntryBatchRecords;
  private processSha256 = digest(uid());
  private permits = new Map<string, Permit>();
  private decisions = new Map<string, BatchDecisionProof>();
  private ticking = false;
  constructor(
    private store: Store,
    private deps: Deps,
  ) {
    this.records = new EntryBatchRecords(store, (id) => {
      const p = this.permits.get(id);
      return !!p && !p.invalid;
    });
  }
  async plan(value: BatchPrepared, limits: BatchLimits): Promise<BatchPlan> {
    this.deps.available();
    batchLimitsSchema.parse(limits);
    const definition = await this.deps.definition(value.record, value.prepared);
    assertBatchDeclaration(definition.declaration, definition.schema);
    const scope: BatchScope = {
      version: 1,
      policy: 'stable-scope-v1',
      owner: definition.owner,
      flowId: value.record.id,
      flowSha256: digest(value.record),
      preparedSha256: digest(value.prepared),
      bindingsSha256: digest(value.record.bindings),
      configurationSha256: digest(definition.configuration),
      declarationSha256: digest(definition.declaration),
      stableAuthorizationSha256: digest(stableBatchAuthorization(value.authorization)),
      processSha256: this.processSha256,
    };
    validateObject('BatchScope', scope);
    this.deps.guard(value.prepared)();
    this.deps.available();
    return {
      ...value,
      ...definition,
      limits: structuredClone(limits),
      scope,
      scopeSha256: digest(scope),
    };
  }
  private ownerKey(plan: BatchPlan) {
    return digest({ kind: plan.owner.kind, ownerId: plan.owner.ownerId });
  }
  private availableOwner(plan: BatchPlan) {
    const previous = this.store.get<{ sessionId: string }>('batch-owner-ref', this.ownerKey(plan));
    if (previous) {
      const view = this.records.get(previous.sessionId);
      if (!view || !batchTerminalPhases.has(view.phase))
        throw Error('此模板实例或制作副本已有未结束的连续运行，请先查看原会话');
    }
  }
  /** Inside RunReview's original transaction, before snapshot/Run/link registration. */
  initial(plan: BatchPlan, run: Run) {
    this.deps.available();
    if (!this.deps.idle()) throw Error('请等待当前运行和原队列结束，再开始连续运行');
    this.availableOwner(plan);
    const sessionId = uid(),
      time = run.createdAt;
    const link = {
      sessionId,
      ordinal: 1,
      runId: run.id,
      scopeSha256: plan.scopeSha256,
      createdAt: time,
    };
    const view: BatchSessionView = {
      version: 1,
      sessionId,
      flowId: run.flowId,
      name: names(run.name, '连续运行'),
      entryName: names(plan.entryName, '模板入口'),
      ownerName: names(plan.ownerName, '本机模板'),
      scope: plan.scope,
      scopeSha256: plan.scopeSha256,
      limits: plan.limits,
      phase: 'running',
      revision: 1,
      generation: 1,
      startedBatches: 1,
      finishedBatches: 0,
      createdAt: time,
      updatedAt: time,
      dispatchDeadline: new Date(Date.parse(time) + plan.limits.maxDurationMs).toISOString(),
      current: link,
      checkingNext: false,
      live: false,
    };
    const proof: BatchAdmissionProof = {
      version: 1,
      run: link,
      processSha256: this.processSha256,
      authorizationSha256: digest(plan.authorization),
      observedAt: time,
    };
    return { view, proof };
  }
  /** Caller already staged the exact Run/snapshot in the same transaction. */
  register(plan: BatchPlan, view: BatchSessionView, proof: BatchAdmissionProof) {
    this.availableOwner(plan);
    this.deps.guard(plan.prepared)();
    this.records.stageView(view);
    this.records.stageLink(view, proof);
    this.store.put('batch-session-private', view.sessionId, { plan } satisfies Private);
    this.store.put('batch-owner-ref', this.ownerKey(plan), { sessionId: view.sessionId });
  }
  /** Only the successful original transaction may install the live process closure. */
  activate(plan: BatchPlan, view: BatchSessionView) {
    this.permits.set(view.sessionId, {
      plan,
      guard: this.deps.guard(plan.prepared),
      wall: Date.parse(view.createdAt),
      mono: performance.now(),
    });
  }
  private limited(view: BatchSessionView, permit: Permit): BatchStopReason | undefined {
    const elapsed = performance.now() - permit.mono;
    if (elapsed < 0 || Math.abs(Date.now() - permit.wall - elapsed) > 5000)
      return { code: 'clock-change', message: '系统时间发生变化，已停止安排新批；原运行记录保留' };
    if (elapsed >= view.limits.maxDurationMs)
      return { code: 'duration-limit', message: '已到新批次调度时限；这不代表模板目标已经完成' };
  }
  private assertPermit(view: BatchSessionView, permit: Permit, forNew: boolean) {
    this.deps.available();
    if (permit.invalid) throw Error('连续运行的进程许可已失效');
    permit.guard();
    if (
      view.scope.processSha256 !== this.processSha256 ||
      view.scopeSha256 !== permit.plan.scopeSha256
    )
      throw Error('连续运行进程或固定来源不一致');
    if (forNew && (view.phase !== 'waiting' || this.limited(view, permit)))
      throw Error('后续批次安排已经失效');
  }
  /** Runs in addition to, never instead of, the original full RunReview checkExecution. */
  queueStopped(run: Run) {
    if (!run.batch) return false;
    const view = this.records.get(run.batch.sessionId),
      permit = this.permits.get(run.batch.sessionId);
    if (!view || !permit) return true;
    const reason = permit.invalid ?? this.limited(view, permit);
    if (!reason) return false;
    this.store.tx(() => {
      view.phase = 'stopping';
      view.stopReason = reason;
      view.revision++;
      view.generation++;
      view.updatedAt = now();
      this.records.stageView(view);
    });
    return true;
  }
  async checkExecution(run: Run) {
    if (!run.batch) return;
    const view = this.records.get(run.batch.sessionId),
      permit = this.permits.get(run.batch.sessionId);
    if (
      !view ||
      !permit ||
      view.current?.runId !== run.id ||
      view.current.ordinal !== run.batch.ordinal ||
      view.scopeSha256 !== run.batch.scopeSha256
    )
      throw Error('此批次缺少原进程许可或唯一Run链接，不自动重放');
    const snapshot = this.store.get<{
      batchAdmissionProof?: BatchAdmissionProof;
      runReviewAuthorization?: unknown;
    }>('snapshot', run.id);
    const proof = snapshot?.batchAdmissionProof;
    if (!proof || !snapshot.runReviewAuthorization) throw Error('此批次缺少固定准入证明');
    validateObject('BatchAdmissionProof', proof);
    verifyBatchAdmission(proof, view, view.previous);
    if (
      digest(proof.run) !== digest(view.current) ||
      proof.authorizationSha256 !== digest(snapshot.runReviewAuthorization)
    )
      throw Error('此批次完整授权观察与准入证明不一致');
    this.assertPermit(view, permit, false);
    const captured = await this.deps.prepareNext(permit.plan);
    const fresh = await this.plan(captured, permit.plan.limits);
    if (fresh.scopeSha256 !== view.scopeSha256) throw Error('连续运行来源、配置或授权已变化');
    this.assertPermit(view, permit, false);
    // The deadline is for dispatch, not for killing an already-running batch.
  }
  /** Called synchronously with the original final secret set and complete schema-checked value. */
  capture(capture: ReuseCapture) {
    const { run, snapshot, saved, known } = capture;
    if (!run.batch) return;
    const view = this.records.get(run.batch.sessionId),
      permit = this.permits.get(run.batch.sessionId);
    if (
      !view?.current ||
      !permit ||
      view.current.runId !== run.id ||
      view.scopeSha256 !== run.batch.scopeSha256 ||
      snapshot.batchAdmissionProof?.run.runId !== run.id
    )
      return;
    if (digest(saved.schema) !== digest(permit.plan.schema)) return;
    if (saved.source.kind === 'template') {
      const ref = permit.plan.record.bindings.template;
      if (
        !ref ||
        ref.instanceId !== saved.source.instanceId ||
        ref.packageKey !== saved.source.packageKey ||
        ref.entryId !== saved.source.entryId ||
        ref.digest !== saved.source.packageDigest
      )
        return;
    } else {
      const context = permit.plan.prepared.authorSdk;
      if (
        !context ||
        saved.source.kind !== 'author-checkout' ||
        saved.source.contextId !== context.id ||
        saved.source.definitionSha256 !== context.definitionSha256
      )
        return;
    }
    validateData(permit.plan.schema, saved.value);
    const decision = extractBatchDecision(permit.plan.declaration, permit.plan.schema, saved.value);
    let reason = redact(decision.reason, known) as string;
    if (!reason.trim() || reason.length > 1000 || /[\uD800-\uDFFF]/.test(reason))
      reason = redact('状态说明已保护；请查看原批次结果', known) as string;
    if (known.some((secret) => secret && reason.includes(secret))) return;
    const proof: BatchDecisionProof = {
      version: 1,
      run: view.current,
      sourceSha256: digest(saved.source),
      valueSha256: digest(saved.value),
      decision: decision.decision,
      progressSha256: digest(decision.progress),
      reason,
      privacy: 'host-redacted-v1',
    };
    validateObject('BatchDecisionProof', proof);
    verifyBatchDecisionProof(proof, view, view.current);
    this.decisions.set(run.id, proof);
  }
  private stopView(view: BatchSessionView, reason: BatchStopReason, interrupted = false) {
    view.phase = interrupted ? 'interrupted' : 'stopped';
    view.stopReason = reason;
    view.checkingNext = false;
    delete view.nextAt;
    view.live = false;
    view.revision++;
    view.generation++;
    view.updatedAt = now();
    this.records.stageView(view);
    this.permits.delete(view.sessionId);
  }
  /** Only after the original Run's process, browser, capabilities and secrets have finished. */
  async finished(runId: string) {
    const run = this.store.get<Run>('run', runId);
    if (!run?.batch) return;
    const sessionId = run.batch.sessionId,
      permit = this.permits.get(sessionId);
    const decision = this.decisions.get(runId);
    this.decisions.delete(runId);
    let changed = false;
    try {
      if (run.state === 'SUCCEEDED' && decision && permit && !permit.invalid) {
        const fresh = await this.deps.prepareNext(permit.plan);
        const plan = await this.plan(fresh, permit.plan.limits);
        permit.guard();
        changed = plan.scopeSha256 !== permit.plan.scopeSha256;
      }
    } catch {
      changed = true;
    }
    this.store.tx(() => {
      const view = this.records.get(sessionId);
      if (!view || batchTerminalPhases.has(view.phase) || view.current?.runId !== runId) return;
      if (!terminalRun.has(run.state)) throw Error('批次Run仍未结束，不能安排后续');
      view.previous = view.current;
      delete view.current;
      view.finishedBatches = view.startedBatches;
      const failed =
        run.state !== 'SUCCEEDED'
          ? ({
              code:
                run.state === 'CANCELLED'
                  ? 'run-cancelled'
                  : run.state === 'FAILED'
                    ? 'run-failed'
                    : 'run-interrupted',
              message: '当前批次未成功结束；请核对原运行及已提交结果，不自动重放',
            } as BatchStopReason)
          : undefined;
      const problem: BatchStopReason | undefined =
        (run.state === 'CANCELLED' && view.stopReason?.code === 'duration-limit'
          ? view.stopReason
          : undefined) ??
        failed ??
        (this.deps.unresolved(runId)
          ? {
              code: 'operation-unresolved',
              message: '本批存在未确认操作；请核对原记录，不自动重放',
            }
          : undefined) ??
        permit?.invalid ??
        (changed || !permit
          ? {
              code: 'source-changed',
              message: '固定来源、配置或授权已变化，请重新核对后开始新会话',
            }
          : undefined) ??
        (!decision
          ? { code: 'result-unavailable', message: '本批缺少完整且可核验的决策结果；原记录保持' }
          : undefined);
      if (problem) return this.stopView(view, problem);
      const previousDecision = view.lastDecision;
      view.lastDecision = decision!;
      if (decision!.decision === 'complete') {
        view.phase = 'completed';
        view.stopReason = { code: 'target-complete', message: decision!.reason };
        view.checkingNext = false;
        delete view.nextAt;
        view.revision++;
        view.generation++;
        view.updatedAt = now();
        view.live = false;
        this.records.stageView(view);
        this.permits.delete(sessionId);
        return;
      }
      const reason =
        view.stopReason ??
        (decision!.decision === 'review'
          ? ({ code: 'review-required', message: decision!.reason } as BatchStopReason)
          : undefined) ??
        (previousDecision?.progressSha256 === decision!.progressSha256
          ? ({
              code: 'no-progress',
              message: '本批进度与上一批相同，已停止安排新批',
            } as BatchStopReason)
          : undefined) ??
        (view.startedBatches >= view.limits.maxBatches
          ? ({
              code: 'batch-limit',
              message: '已达到本次批数限制；这不代表模板目标完成',
            } as BatchStopReason)
          : undefined) ??
        this.limited(view, permit!);
      if (reason) return this.stopView(view, reason);
      const delay = view.limits.delayMs;
      permit!.nextMono = performance.now() + delay;
      const nextAt = Date.now() + delay;
      if (nextAt >= Date.parse(view.dispatchDeadline))
        return this.stopView(view, {
          code: 'duration-limit',
          message: '批间等待超过新批次调度时限，已停止安排新批',
        });
      view.phase = 'waiting';
      view.checkingNext = false;
      view.nextAt = new Date(nextAt).toISOString();
      view.revision++;
      view.generation++;
      view.updatedAt = now();
      this.records.stageView(view);
    });
  }
  async tick() {
    if (this.ticking || this.store.fault) return;
    this.ticking = true;
    try {
      for (const [sessionId, permit] of this.permits) {
        const view = this.records.get(sessionId);
        if (!view || view.phase !== 'waiting' || view.checkingNext || permit.invalid) continue;
        const reason = this.limited(view, permit);
        if (reason) {
          this.store.tx(() => this.stopView(view, reason));
          continue;
        }
        if (
          permit.nextMono === undefined ||
          performance.now() < permit.nextMono ||
          !this.deps.idle()
        )
          continue;
        await this.deps.serialize(() => this.admitNext(sessionId, permit));
      }
    } finally {
      this.ticking = false;
    }
  }
  private async admitNext(sessionId: string, permit: Permit) {
    let generation = 0;
    try {
      const initial = this.records.get(sessionId);
      if (!initial || !this.deps.idle()) return;
      this.assertPermit(initial, permit, true);
      const candidate = this.store.tx(() => {
        const view = this.records.get(sessionId)!;
        this.assertPermit(view, permit, true);
        if (view.checkingNext) throw Error('本会话已有后续批次预检');
        const row = this.store.get<Private>('batch-session-private', sessionId);
        if (!row || row.plan.scopeSha256 !== view.scopeSha256)
          throw Error('连续运行私有固定来源缺失');
        const next = row.next ?? { ordinal: view.startedBatches + 1, runId: uid() };
        if (next.ordinal !== view.startedBatches + 1) throw Error('后续批次登记身份不一致');
        view.checkingNext = true;
        view.generation++;
        view.revision++;
        view.updatedAt = now();
        generation = view.generation;
        this.store.put('batch-session-private', sessionId, { ...row, next });
        this.records.stageView(view);
        return next;
      });
      const captured = await this.deps.prepareNext(permit.plan);
      const plan = await this.plan(captured, permit.plan.limits);
      const current = this.records.get(sessionId);
      if (!current || current.generation !== generation || current.phase !== 'waiting') return;
      this.assertPermit(current, permit, true);
      if (plan.scopeSha256 !== permit.plan.scopeSha256) throw Error('来源、配置或稳定授权已变化');
      let admitted = false;
      this.store.tx(() => {
        const view = this.records.get(sessionId)!;
        if (view.generation !== generation || view.phase !== 'waiting') return;
        this.assertPermit(view, permit, true);
        if (!this.deps.idle()) {
          view.checkingNext = false;
          view.generation++;
          view.revision++;
          view.updatedAt = now();
          this.records.stageView(view);
          return; // Keep this ordinal's original candidate ID; allow the ordinary queue first.
        }
        const original = this.store.get<Run>('run', view.previous!.runId);
        if (!original || original.state !== 'SUCCEEDED') throw Error('上一批原Run状态不可核验');
        if (this.store.get('run', candidate.runId))
          throw Error('此批次原Run已存在，保留原记录核对');
        const time = now();
        view.startedBatches++;
        view.current = {
          sessionId,
          ordinal: candidate.ordinal,
          runId: candidate.runId,
          scopeSha256: view.scopeSha256,
          createdAt: time,
        };
        const proof: BatchAdmissionProof = {
          version: 1,
          run: view.current,
          previousRunId: view.previous!.runId,
          processSha256: this.processSha256,
          authorizationSha256: digest(captured.authorization),
          observedAt: time,
        };
        const run: Run = {
          id: candidate.runId,
          flowId: view.flowId,
          name: original.name,
          versionId: original.versionId,
          source: 'manual',
          state: 'QUEUED',
          createdAt: time,
          updatedAt: time,
          debug: false,
          review: { reviewedAt: time },
          batch: {
            version: 1,
            sessionId,
            ordinal: candidate.ordinal,
            scopeSha256: view.scopeSha256,
          },
          business: '连续运行的一批；执行结果与外部业务核对分别记录',
        };
        view.phase = 'running';
        view.checkingNext = false;
        delete view.nextAt;
        view.revision++;
        view.generation++;
        view.updatedAt = time;
        this.store.put('snapshot', run.id, {
          ...permit.plan.record,
          ...captured.prepared,
          versionId: run.versionId,
          runReviewAuthorization: captured.authorization,
          batchAdmissionProof: proof,
        });
        this.store.put('run', run.id, run);
        this.store.event(run.id, 'state', '', { state: 'QUEUED' });
        this.records.stageView(view);
        this.records.stageLink(view, proof);
        this.store.put('batch-session-private', sessionId, { plan: permit.plan } satisfies Private);
        admitted = true;
      });
      if (admitted) this.deps.dispatch();
    } catch {
      if (this.store.fault) {
        permit.invalid = {
          code: 'storage-fault',
          message: '本机存储无法可靠确认；保留原批次，不重新创建',
        };
        return;
      }
      this.store.tx(() => {
        const view = this.records.get(sessionId);
        if (!view || view.phase !== 'waiting' || (generation && view.generation !== generation))
          return;
        this.stopView(
          view,
          this.limited(view, permit) ?? {
            code: 'preflight-failed',
            message: '后续批次预检或原来源守卫未通过；请查看原记录并重新核对',
          },
        );
      });
    }
  }
  async stop(raw: unknown) {
    const request = batchMethods['run.batch.stop'].parse(raw) as BatchStopRequest;
    const previous = this.records.priorStop(request);
    if (previous) return previous;
    const receipt = this.records.beginStop(request);
    if (!receipt.targetRunId) this.permits.delete(request.sessionId);
    if (receipt.mode !== 'cancel-current' || receipt.currentCancellation !== 'needs-check')
      return receipt;
    try {
      const run = this.store.get<Run>('run', receipt.targetRunId!);
      if (!run || run.batch?.sessionId !== request.sessionId) return receipt;
      if (terminalRun.has(run.state)) return this.records.finishStop(request, 'already-terminal');
      const accepted = await this.deps.cancel(run.id);
      return this.records.finishStop(request, accepted ? 'requested' : 'already-terminal');
    } catch {
      return this.records.priorStop(request)!;
    }
  }
  /** Revokes future admission synchronously, before global cancellation can await. */
  invalidate(code: 'application-exit' | 'system-suspend') {
    for (const permit of this.permits.values())
      permit.invalid = { code, message: '应用退出或系统休眠，已停止安排新批；重开不会自动续跑' };
    if (this.store.fault) return;
    for (const [sessionId, permit] of this.permits) {
      try {
        this.store.tx(() => {
          const view = this.records.get(sessionId);
          if (!view || batchTerminalPhases.has(view.phase)) return;
          if (!view.current) return this.stopView(view, permit.invalid!, true);
          view.phase = 'stopping';
          view.stopReason = permit.invalid;
          view.checkingNext = false;
          delete view.nextAt;
          view.revision++;
          view.generation++;
          view.updatedAt = now();
          this.records.stageView(view);
        });
      } catch {
        // Storage diagnostics must never prevent the original global resource cancellation.
        this.store.fault ??= '连续运行停止记录无法可靠保存；已撤销进程许可，请保留原记录核对';
      }
    }
  }
  recover() {
    // The normal Store.recover has already made old Runs terminal. No permit is restored.
    const ceiling = this.store.lastPosition('batch-session');
    let before = ceiling + 1;
    while (true) {
      const rows = this.store.page<BatchSessionView>('batch-session', ceiling, before, 200);
      for (const row of rows) {
        before = row.position;
        if (batchTerminalPhases.has(row.value.phase)) continue;
        this.store.tx(() => {
          const view = this.records.get(row.value.sessionId)!;
          if (view.current) {
            view.previous = view.current;
            delete view.current;
          }
          view.finishedBatches = view.startedBatches;
          this.stopView(
            view,
            {
              code: 'application-restart',
              message: '上次连续运行已中断；请核对原批次后明确开始新会话，不自动续跑',
            },
            true,
          );
        });
      }
      if (rows.length < 200) break;
    }
  }
}
