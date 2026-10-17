import type { Store } from './store';
import type { FlowRecord, Run } from '../shared/types';
import type {
  HandoffPreview,
  HandoffReceipt,
  HandoffRequest,
  HandoffSelection,
} from '../shared/entry-handoff';
import { validateObject } from '../core/validate';
import { digest, now, uid } from '../shared/utils';
type Row = { fingerprint: string; receipt: HandoffReceipt };
type Capture = { record: FlowRecord; instanceName: string; runs: Run[] };
type Preview = { value: HandoffPreview; signature: string; epoch: number; used: boolean };
type Deps = {
  available: () => void;
  epoch: () => number;
  capture: (selection: HandoffSelection) => Capture;
  prepare: (record: FlowRecord) => Promise<void>;
  package: (record: FlowRecord) => Promise<{ version: string; digest: string }>;
  reserve: (requestId: string) => void;
  release: (requestId: string) => void;
  stop: (ids: string[]) => Promise<void>;
  create: (record: FlowRecord, selection: HandoffSelection, requestId: string) => Promise<Run>;
  error: (error: unknown) => string;
};
/** A human initiated transition on the existing single Run slot. Never an execution lane. */
export class EntryHandoffs {
  private previews = new Map<string, Preview>();
  private pending = new Map<string, { fingerprint: string; promise: Promise<HandoffReceipt> }>();
  constructor(
    private store: Store,
    private deps: Deps,
  ) {}
  private row(id: string) {
    const row = this.store.get<Row>('entry-handoff', id);
    if (row) validateObject('EntryHandoffReceipt', row.receipt);
    return row;
  }
  get(requestId: string) {
    return this.row(requestId)?.receipt ?? null;
  }
  list(instanceId: string) {
    return this.store
      .list<Row>('entry-handoff')
      .filter((r) => r.receipt.selection.source.instanceId === instanceId)
      .slice(-20)
      .reverse()
      .map((r) => {
        validateObject('EntryHandoffReceipt', r.receipt);
        return r.receipt;
      });
  }
  recover() {
    for (const row of this.store.list<Row>('entry-handoff'))
      if (row.receipt.status === 'stopping') {
        this.update(row.receipt.requestId, {
          status: 'interrupted',
          error: '上次停止后执行请求已中断，请核对原运行；不会自动续跑',
        });
        this.store.attention(
          'unknown-result',
          '入口切换已中断，请核对原请求',
          { requestId: row.receipt.requestId, instanceId: row.receipt.selection.source.instanceId },
          'entry-handoff:' + row.receipt.requestId,
        );
      }
  }
  private signature(c: Capture) {
    return digest({
      record: c.record,
      runs: c.runs
        .map((r) => ({ id: r.id, state: r.state }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    });
  }
  async preview(selection: HandoffSelection): Promise<HandoffPreview> {
    this.deps.available();
    const epoch = this.deps.epoch(),
      c = this.deps.capture(selection),
      signature = this.signature(c);
    await this.deps.prepare(c.record);
    const pkg = await this.deps.package(c.record);
    this.deps.available();
    if (epoch !== this.deps.epoch() || signature !== this.signature(this.deps.capture(selection)))
      throw Error('来源或运行范围已变化，请重新核对');
    const value: HandoffPreview = {
      version: 1,
      selection,
      token: digest({ nonce: uid(), selection, signature, epoch }),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      flowName: c.record.flow.name,
      instanceName: c.instanceName,
      packageVersion: pkg.version,
      packageDigest: pkg.digest,
      runs: c.runs.map((r) => ({
        id: r.id,
        name: r.name,
        state: r.state as HandoffPreview['runs'][number]['state'],
      })) as HandoffPreview['runs'],
      limitations: [
        '只停止明确列出的本实例运行；不回滚已提交的外部操作。',
        '确认回收后创建一次新入口运行，执行结果仍须核对。',
        '中断或重开只读原请求，不自动续跑或重试。',
      ],
    };
    validateObject('EntryHandoffPreview', value);
    while (this.previews.size >= 64) this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(value.token, { value, signature, epoch, used: false });
    return value;
  }
  update(id: string, patch: Partial<Pick<HandoffReceipt, 'status' | 'runId' | 'error'>>) {
    const row = this.row(id);
    if (!row) throw Error('入口切换请求不存在');
    const receipt = {
      ...row.receipt,
      ...patch,
      revision: row.receipt.revision + 1,
      updatedAt: now(),
    };
    validateObject('EntryHandoffReceipt', receipt);
    this.store.put('entry-handoff', id, { ...row, receipt });
    return receipt;
  }
  /** Called in the same transaction that writes the unique Run and snapshot. */
  created(id: string, runId: string) {
    if (this.row(id)?.receipt.status !== 'stopping') throw Error('入口切换请求已终止');
    this.update(id, { status: 'created', runId, error: null });
  }
  confirm(request: HandoffRequest): Promise<HandoffReceipt> {
    const fingerprint = digest(request),
      old = this.pending.get(request.requestId);
    if (old)
      return old.fingerprint === fingerprint
        ? old.promise
        : Promise.reject(Error('同一请求身份的内容不一致'));
    const promise = this.confirmOnce(request).finally(() => this.pending.delete(request.requestId));
    this.pending.set(request.requestId, { fingerprint, promise });
    return promise;
  }
  private async confirmOnce(request: HandoffRequest): Promise<HandoffReceipt> {
    const fingerprint = digest(request),
      old = this.row(request.requestId);
    if (old) {
      if (old.fingerprint !== fingerprint) throw Error('同一请求身份的内容不一致');
      return old.receipt;
    }
    const p = this.previews.get(request.token);
    if (
      !p ||
      p.used ||
      Date.parse(p.value.expiresAt) < Date.now() ||
      digest(p.value.selection) !== digest(request.selection)
    )
      throw Error('核对已失效，请先读取原请求或重新核对');
    this.deps.available();
    if (p.epoch !== this.deps.epoch()) throw Error('应用状态已变化，请重新核对');
    const c = this.deps.capture(request.selection);
    if (this.signature(c) !== p.signature) throw Error('来源或运行范围已变化，请重新核对');
    this.deps.reserve(request.requestId);
    const operationEpoch = this.deps.epoch();
    try {
      this.deps.available();
      if (
        operationEpoch !== this.deps.epoch() ||
        this.signature(this.deps.capture(request.selection)) !== p.signature
      )
        throw Error('来源或运行范围已变化，请重新核对');
      const at = now(),
        receipt: HandoffReceipt = {
          version: 1,
          requestId: request.requestId,
          selection: request.selection,
          token: request.token,
          revision: 1,
          status: 'stopping',
          stoppedRunIds: c.runs.map((r) => r.id) as HandoffReceipt['stoppedRunIds'],
          runId: null,
          createdAt: at,
          updatedAt: at,
          error: null,
        };
      validateObject('EntryHandoffReceipt', receipt);
      this.store.put('entry-handoff', request.requestId, { fingerprint, receipt });
      p.used = true;
      await this.deps.stop(receipt.stoppedRunIds);
      this.deps.available();
      if (operationEpoch !== this.deps.epoch()) throw Error('应用退出或休眠，本次不启动新入口');
      await this.deps.create(c.record, request.selection, request.requestId);
      return this.get(request.requestId)!;
    } catch (error) {
      const saved = this.row(request.requestId);
      if (saved?.receipt.status === 'created') return saved.receipt;
      if (saved && !this.store.fault)
        return this.update(request.requestId, {
          status: 'failed',
          error: this.deps.error(error).slice(0, 500) || '停止后执行未确认，请核对原请求',
        });
      throw error;
    } finally {
      this.deps.release(request.requestId);
    }
  }
}
