import type { Store } from './store';
import type { Run } from '../shared/types';
import type {
  BatchAdmissionProof,
  BatchHistoryPage,
  BatchHistoryRow,
  BatchRunLink,
  BatchSessionPage,
  BatchSessionView,
  BatchStopReceipt,
  BatchStopRequest,
} from '../shared/entry-batches';
import { batchMethods } from '../shared/entry-batches';
import { digest, now } from '../shared/utils';
import { validateObject } from '../core/validate';
import {
  batchTerminalPhases,
  verifyBatchAdmission,
  verifyBatchPage,
  verifyBatchSession,
  verifyBatchStopReceipt,
} from '../../contracts/entry-batches';

const kind = 'batch-session';
const links = 'batch-run-link';
const requests = 'batch-stop-request';
const MAX_RESPONSE_BYTES = 256 * 1024;
type StopRow = { fingerprint: string; receipt: BatchStopReceipt };
/** Protected records only; scheduling and permission ownership belong to the supervisor. */
export class EntryBatchRecords {
  constructor(
    private store: Store,
    private live: (id: string) => boolean,
  ) {}
  get(sessionId: string): BatchSessionView | null {
    const row = this.store.get<BatchSessionView>(kind, sessionId);
    if (!row) return null;
    const value = {
      ...row,
      live: !this.store.fault && !batchTerminalPhases.has(row.phase) && this.live(sessionId),
    };
    validateObject('BatchSessionView', value);
    verifyBatchSession(value, digest);
    return value;
  }
  /** Caller must put this in the same host transaction as the Run/snapshot/link. */
  stageView(value: BatchSessionView) {
    const row = { ...value, live: false };
    validateObject('BatchSessionView', row);
    verifyBatchSession(row, digest);
    const previous = this.store.get<BatchSessionView>(kind, row.sessionId);
    if (
      previous &&
      (previous.scopeSha256 !== row.scopeSha256 ||
        previous.flowId !== row.flowId ||
        previous.createdAt !== row.createdAt ||
        previous.dispatchDeadline !== row.dispatchDeadline ||
        digest(previous.limits) !== digest(row.limits) ||
        previous.startedBatches > row.startedBatches ||
        previous.finishedBatches > row.finishedBatches ||
        batchTerminalPhases.has(previous.phase) ||
        previous.revision >= row.revision ||
        previous.generation > row.generation)
    )
      throw Error('连续运行修订或固定来源不一致');
    this.store.put(kind, row.sessionId, row);
  }
  /** Stage only after the exact Run and snapshot are staged in the enclosing transaction. */
  stageLink(view: BatchSessionView, proof: BatchAdmissionProof) {
    validateObject('BatchAdmissionProof', proof);
    verifyBatchAdmission(proof, view, view.previous);
    const link = proof.run,
      key = digest({ sessionId: link.sessionId, ordinal: link.ordinal });
    const previous = this.store.get<BatchRunLink>(links, key);
    if (previous && digest(previous) !== digest(link)) throw Error('同一连续批次已登记另一Run');
    const run = this.store.get<Run>('run', link.runId);
    const snapshot = this.store.get<{ batchAdmissionProof?: BatchAdmissionProof }>(
      'snapshot',
      link.runId,
    );
    if (
      !run ||
      run.flowId !== view.flowId ||
      run.state !== 'QUEUED' ||
      !snapshot?.batchAdmissionProof ||
      digest(snapshot?.batchAdmissionProof) !== digest(proof)
    )
      throw Error('批次Run或固定准入快照未在同一事务登记');
    const runRef = this.store.get<{ sessionId: string; ordinal: number }>(
      'batch-run-ref',
      link.runId,
    );
    if (runRef && (runRef.sessionId !== link.sessionId || runRef.ordinal !== link.ordinal))
      throw Error('Run已被另一连续批次引用');
    this.store.put(links, key, link);
    this.store.put('batch-run-ref', link.runId, {
      sessionId: link.sessionId,
      ordinal: link.ordinal,
    });
  }
  list(raw: unknown): BatchSessionPage {
    const args = batchMethods['run.batch.list'].parse(raw);
    const ceiling = args.cursor?.ceiling ?? this.store.lastPosition(kind);
    const before = args.cursor?.before ?? ceiling + 1;
    const rows = this.store.page<BatchSessionView>(kind, ceiling, before, 200);
    const items: Array<BatchSessionPage['items'][number]> = [];
    let scannedCount = 0,
      nextBefore = before,
      limited = false;
    for (const row of rows) {
      scannedCount++;
      if (row.value.flowId === args.flowId) {
        const session = this.get(row.value.sessionId);
        if (!session || session.flowId !== args.flowId)
          throw Error('连续运行列表来源变化，请重新读取');
        const candidate = { position: row.position, session };
        if (Buffer.byteLength(JSON.stringify([...items, candidate])) > MAX_RESPONSE_BYTES - 4096) {
          if (!items.length) throw Error('连续运行记录超过可读容量，请保留原记录核对');
          nextBefore = row.position + 1;
          limited = true;
          break;
        }
        items.push(candidate);
      }
      nextBefore = row.position;
      if (items.length === 20) {
        limited = true;
        break;
      }
    }
    const page = {
      flowId: args.flowId,
      ceiling,
      scannedCount,
      items,
      nextCursor:
        (limited || rows.length === 200) && nextBefore >= 1
          ? { flowId: args.flowId, ceiling, before: nextBefore }
          : null,
    };
    validateObject('BatchSessionPage', page);
    verifyBatchPage(args, page);
    if (Buffer.byteLength(JSON.stringify(page)) > MAX_RESPONSE_BYTES)
      throw Error('连续运行页超过可读容量');
    return page as BatchSessionPage;
  }
  history(raw: unknown): BatchHistoryPage {
    const args = batchMethods['run.batch.history'].parse(raw),
      session = this.get(args.sessionId);
    if (!session) throw Error('连续运行记录不存在');
    const ceiling = args.cursor?.ceiling ?? this.store.lastPosition(links);
    const before = args.cursor?.before ?? ceiling + 1;
    const rows = this.store.page<BatchRunLink>(links, ceiling, before, 200);
    const items: Array<BatchHistoryPage['items'][number]> = [];
    let scannedCount = 0,
      nextBefore = before,
      limited = false;
    for (const row of rows) {
      scannedCount++;
      if (row.value.sessionId === args.sessionId) {
        validateObject('BatchRunLink', row.value);
        if (row.value.scopeSha256 !== session.scopeSha256) throw Error('批次历史固定来源不一致');
        const run = this.store.get<Run>('run', row.value.runId);
        if (!run || run.flowId !== session.flowId) throw Error('批次原Run缺失，请保留记录核对');
        const value: BatchHistoryRow = { ...row.value, runName: run.name, runState: run.state };
        const candidate = { position: row.position, row: value };
        if (Buffer.byteLength(JSON.stringify([...items, candidate])) > MAX_RESPONSE_BYTES - 4096) {
          if (!items.length) throw Error('批次历史超过可读容量，请保留原记录核对');
          nextBefore = row.position + 1;
          limited = true;
          break;
        }
        items.push(candidate);
      }
      nextBefore = row.position;
      if (items.length === 20) {
        limited = true;
        break;
      }
    }
    const page = {
      sessionId: args.sessionId,
      scopeSha256: session.scopeSha256,
      ceiling,
      scannedCount,
      items,
      nextCursor:
        (limited || rows.length === 200) && nextBefore >= 1
          ? { sessionId: args.sessionId, ceiling, before: nextBefore }
          : null,
    };
    validateObject('BatchHistoryPage', page);
    verifyBatchPage(args, page, true);
    if (Buffer.byteLength(JSON.stringify(page)) > MAX_RESPONSE_BYTES)
      throw Error('批次历史页超过可读容量');
    return page as BatchHistoryPage;
  }
  priorStop(request: BatchStopRequest): BatchStopReceipt | null {
    const row = this.store.get<StopRow>(requests, request.requestId);
    if (!row) return null;
    if (row.fingerprint !== digest(request)) throw Error('停止请求ID已用于其他内容');
    validateObject('BatchStopReceipt', row.receipt);
    verifyBatchStopReceipt(request, row.receipt, digest);
    return row.receipt;
  }
  /** Saves invalidation before returning the exact Run eligible for normal cancellation. */
  beginStop(raw: unknown): BatchStopReceipt {
    const request = batchMethods['run.batch.stop'].parse(raw);
    return this.store.tx(() => {
      const prior = this.priorStop(request);
      if (prior) return prior;
      const view = this.get(request.sessionId);
      if (!view) throw Error('连续运行记录不存在');
      const terminal = batchTerminalPhases.has(view.phase);
      if (!terminal) {
        view.revision++;
        view.generation++;
        view.updatedAt = now();
        view.checkingNext = false;
        delete view.nextAt;
        view.phase = view.current ? 'stopping' : 'stopped';
        view.stopReason ??= {
          code: 'user-stop',
          message: '已停止安排后续批次；当前批结果另行核对',
        };
        this.stageView(view);
      }
      const receipt: BatchStopReceipt = {
        version: 1,
        requestId: request.requestId,
        sessionId: request.sessionId,
        mode: request.mode,
        fingerprint: digest(request),
        status: terminal ? 'already-terminal' : 'applied',
        nextBatchesStopped: true,
        sessionRevision: view.revision,
        requestedAt: now(),
        ...(view.current ? { targetRunId: view.current.runId } : {}),
        currentCancellation:
          request.mode === 'after-batch'
            ? 'not-requested'
            : terminal
              ? 'already-terminal'
              : view.current
                ? 'needs-check'
                : 'not-running',
      };
      validateObject('BatchStopReceipt', receipt);
      verifyBatchStopReceipt(request, receipt, digest);
      this.store.put(requests, request.requestId, { fingerprint: receipt.fingerprint, receipt });
      return receipt;
    });
  }
  finishStop(request: BatchStopRequest, state: 'requested' | 'already-terminal' | 'needs-check') {
    return this.store.tx(() => {
      const receipt = this.priorStop(request);
      if (!receipt) throw Error('原停止请求未登记');
      if (receipt.mode !== 'cancel-current' || receipt.currentCancellation !== 'needs-check')
        return receipt;
      const next = { ...receipt, currentCancellation: state };
      validateObject('BatchStopReceipt', next);
      verifyBatchStopReceipt(request, next, digest);
      this.store.put(requests, request.requestId, { fingerprint: next.fingerprint, receipt: next });
      return next;
    });
  }
}
