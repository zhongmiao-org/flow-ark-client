import type { Store } from './store';
import type { Run } from '../shared/types';
import { walk } from '../core/validate';
import type {
  ResultMeta,
  ResultLedger,
  LedgerOwner,
  RawFamily,
  ActualCopy,
} from '../../contracts/result-ledger.mjs';
import {
  createLedger,
  inspectLedger,
  propose,
  verifyCopies,
  rawCharge,
} from '../../contracts/result-ledger.mjs';
import { canonical, digest, encode, merge, read } from '../../contracts/result-retention.mjs';
import { ledgerCapacity } from '../../contracts/result-capacity.mjs';
import type { CapacityReason } from '../shared/result-capacity';
import {
  result_retention_policy_v1,
  result_retention_result_ledger_v1,
} from '../shared/node-schema.generated';

const LEDGER = 'run-result-ledger';
const SOURCES = 'run-result-copy-index';
type Ref = { family: RawFamily; id: string; kind: string; key: string };
type SourceIndex = { version: 1; owner: LedgerOwner; refs: Ref[] };
type Pending = {
  owner: LedgerOwner;
  base: ResultLedger;
  refs: Ref[];
  values: ResultLedger['values'];
  results: ResultMeta[];
  touched: Map<string, Ref>;
};
export type StateReceiptStages = { key: string; rows: unknown[] };
type StateHold = { runId: string; meta: ResultMeta; value: unknown; stages: StateReceiptStages };
const byKey: Record<string, RawFamily> = {
  'template-result': 'entry-result',
  'author-sdk-result': 'entry-result',
  'entry-result-display': 'entry-display',
  'run-result-reuse': 'entry-reuse',
  'batch-initialization': 'entry-reuse',
  'typed-run-index': 'typed-result-index',
  output: 'run-output',
  'run-output-packed': 'run-output',
};
const byBody: Record<string, RawFamily> = {
  'template-data-operation': 'state-operation',
  'template-effect': 'effect-operation',
  'mcp-effect': 'effect-operation',
  'desktop-effect': 'effect-operation',
  'typed-run-result': 'typed-result-record',
  'browser-fields-input': 'browser-input-proof',
  'browser-scroll-input': 'browser-input-proof',
  'document-source-proof': 'document-source-proof',
};
export class ResultRetentionError extends Error {
  constructor(
    message: string,
    readonly reason: CapacityReason = 'integrity',
  ) {
    super('完整结果保留不可核验：' + message);
  }
}
function fail(reason: string, code: CapacityReason = 'integrity'): never {
  throw new ResultRetentionError(reason, code);
}
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const refKey = (r: Ref) => r.family + ':' + r.id;
const identity = (runId: string, family: RawFamily, kind: string, key: string): Ref => ({
  family,
  kind,
  key,
  id: digest({ version: 1, runId, family, kind, key }),
});

/** Host-only coordinator. No template API, deletion, GC or automatic policy activation. */
export class RunResultLedgerStore {
  private pending = new Map<string, Pending>();
  private newRuns = new Set<string>();
  private newSnapshots = new Set<string>();
  private committing = false;
  private stateHolds = new Map<string, StateHold>();
  constructor(private store: Store) {}
  observes(kind: string) {
    return (
      [LEDGER, SOURCES, 'run', 'snapshot'].includes(kind) ||
      Object.hasOwn(byKey, kind) ||
      Object.hasOwn(byBody, kind)
    );
  }

  owned(runId: string): boolean {
    const snapshot = this.store.get<any>('snapshot', runId);
    if (!snapshot || !Object.hasOwn(snapshot, 'resultRetention')) {
      if (this.store.get(LEDGER, runId) || this.store.get(SOURCES, runId))
        fail('目录仍存在但原运行政策来源缺失');
      return false;
    }
    if (!result_retention_policy_v1(snapshot.resultRetention)) fail('运行保存政策无效');
    return true;
  }
  private owner(runId: string, supplied?: Run): LedgerOwner {
    const run = supplied ?? this.store.get<Run>('run', runId);
    const snapshot = this.store.get<any>('snapshot', runId);
    if (!run || !snapshot) fail('原运行或固定方案缺失', 'missing');
    if (run.id !== runId || run.flowId !== snapshot.id || !this.owned(runId))
      fail('原运行与固定方案不一致', 'owner-mismatch');
    return {
      runId,
      flowId: run.flowId,
      versionId: run.versionId,
      snapshotSha256: digest(snapshot),
    };
  }
  private sourceRun(kind: string, key: string, value: any): string | undefined {
    if (Object.hasOwn(byKey, kind)) return key;
    if (kind === '@ai-event')
      return typeof value?.runId === 'string' ? value.runId : fail('模型回执拥有者缺失');
    if (!Object.hasOwn(byBody, kind)) return;
    // Global latest-document pointers have an independent owner. New Run proofs carry runId.
    if (kind === 'document-source-proof' && !value?.runId) return;
    // Legacy browser proofs have no Run field and remain legacy-only.
    if ((kind === 'browser-fields-input' || kind === 'browser-scroll-input') && !value?.runId)
      return;
    return typeof value?.runId === 'string' ? value.runId : fail('原值副本拥有者缺失');
  }
  private descriptor(runId: string, kind: string, key: string, value: unknown): Ref | undefined {
    const owner = this.sourceRun(kind, key, value);
    if (!owner) return;
    if (owner !== runId) fail('原值副本跨运行');
    const family = kind === '@ai-event' ? 'ai-receipt' : (byKey[kind] ?? byBody[kind]);
    return identity(runId, family, kind, key);
  }
  private actual(ref: Ref, runId: string): ActualCopy {
    const value =
      ref.kind === '@ai-event'
        ? this.store.eventAt(runId, Number(ref.key))
        : this.store.get(ref.kind, ref.key);
    if (value === undefined) fail('原值副本缺失', 'missing');
    const expected = this.descriptor(runId, ref.kind, ref.key, value);
    if (!expected || !equal(ref, expected)) fail('原值副本来源不符');
    return { family: ref.family, id: ref.id, value };
  }
  private index(value: unknown, owner: LedgerOwner): SourceIndex {
    const index = value as SourceIndex;
    if (
      !index ||
      !equal(Object.keys(index).sort(), ['owner', 'refs', 'version']) ||
      index.version !== 1 ||
      !equal(index.owner, owner) ||
      !Array.isArray(index.refs) ||
      index.refs.length > 8191
    )
      fail('副本来源索引无效');
    let previous = '';
    for (const ref of index.refs) {
      if (
        !ref ||
        !equal(Object.keys(ref).sort(), ['family', 'id', 'key', 'kind']) ||
        typeof ref.kind !== 'string' ||
        typeof ref.key !== 'string' ||
        !ref.key ||
        ref.key.length > 4096 ||
        refKey(ref) <= previous ||
        !equal(ref, identity(owner.runId, ref.family, ref.kind, ref.key))
      )
        fail('副本索引身份或顺序不符');
      previous = refKey(ref);
    }
    return index;
  }
  private indexCopy(index: SourceIndex): ActualCopy {
    const ref = identity(index.owner.runId, 'typed-result-index', SOURCES, index.owner.runId);
    return { family: ref.family, id: ref.id, value: index };
  }
  private consistency(ledger: ResultLedger, refs: Ref[], owner: LedgerOwner) {
    const nodes = new Map(
      walk(this.store.get<any>('snapshot', owner.runId).flow.steps).map((n) => [n.id, n]),
    );
    const indexed = refs.filter((r) => r.kind === 'typed-run-index');
    if (ledger.results.length && indexed.length !== 1) fail('逻辑结果索引缺失');
    if (indexed.length > 1) fail('逻辑结果索引重复');
    if (
      indexed.length &&
      !equal(this.store.get<any>('typed-run-index', owner.runId)?.entries, ledger.results)
    )
      fail('逻辑结果镜像不一致');
    const rows = new Set(refs.filter((r) => r.kind === 'typed-run-result').map((r) => r.key));
    if (rows.size !== ledger.results.length) fail('结果包装与目录不对应');
    for (const meta of ledger.results) {
      if (
        meta.id !==
          digest({
            runId: owner.runId,
            nodeId: meta.nodeId,
            nodeInstance: meta.nodeInstance,
            type: meta.type,
          }) ||
        nodes.get(meta.nodeId)?.type !== meta.type ||
        !(meta.nodeInstance === meta.nodeId || meta.nodeInstance.endsWith('/' + meta.nodeId))
      )
        fail('逻辑结果不属于固定节点实例');
      const row = this.store.get<any>('typed-run-result', meta.id);
      if (
        !rows.has(meta.id) ||
        !row ||
        !equal(Object.keys(row).sort(), ['meta', 'retention', 'runId']) ||
        row.runId !== owner.runId ||
        row.retention !== 'run-owned-results-v1' ||
        !equal(row.meta, meta)
      )
        fail('完整结果包装来源不一致');
    }
    for (const ref of refs.filter((r) => r.kind === 'template-data-operation')) {
      const row = this.store.get<any>(ref.kind, ref.key);
      if (row?.receipt?.status !== 'written') continue;
      const nodeId = String(row.nodeInstance).split('/').at(-1)!;
      const node = nodes.get(nodeId);
      const id = digest({
        runId: owner.runId,
        nodeId,
        nodeInstance: row.nodeInstance,
        type: 'context',
      });
      const meta = ledger.results.find((r) => r.id === id);
      if (
        node?.type !== 'context' ||
        node.operation !== 'state.write' ||
        !meta ||
        meta.sha256 !== digest(row.receipt.result)
      )
        fail('状态提交缺少同事务完整结果');
    }
  }
  private verified(runId: string) {
    const owner = this.owner(runId);
    const ledger = this.store.get<ResultLedger>(LEDGER, runId);
    if (!ledger) fail('目录缺失', 'missing');
    if (!result_retention_result_ledger_v1(ledger)) fail('目录格式无效');
    if (!equal(ledger.owner, owner)) fail('目录不属于固定运行', 'owner-mismatch');
    inspectLedger(ledger, owner);
    const index = this.index(this.store.get(SOURCES, runId), owner);
    verifyCopies(ledger, owner, [
      this.indexCopy(index),
      ...index.refs.map((r) => this.actual(r, runId)),
    ]);
    this.consistency(ledger, index.refs, owner);
    return { owner, ledger, refs: index.refs };
  }
  private touch(runId: string): Pending {
    const saved = this.pending.get(runId);
    if (saved) return saved;
    if (!this.store.inTransaction) fail('登记必须在宿主事务内');
    const { owner, ledger, refs } = this.verified(runId);
    const result: Pending = {
      owner,
      base: ledger,
      refs,
      values: ledger.values,
      results: [],
      touched: new Map(),
    };
    this.pending.set(runId, result);
    return result;
  }

  beforePut(kind: string, key: string, value: any, previous: any) {
    if (this.committing || kind === LEDGER || kind === SOURCES) return;
    if (kind === 'snapshot') {
      if (
        previous &&
        (Object.hasOwn(previous, 'resultRetention') || Object.hasOwn(value, 'resultRetention')) &&
        !equal(previous, value)
      )
        fail('固定运行方案不能覆盖');
      if (!previous && Object.hasOwn(value, 'resultRetention')) {
        if (!result_retention_policy_v1(value.resultRetention)) fail('运行保存政策无效');
        if (this.store.get('run', key) && !this.newRuns.has(key)) fail('旧运行不能补写新政策');
        this.newSnapshots.add(key);
      }
      return;
    }
    if (kind === 'run') {
      if (!previous) this.newRuns.add(key);
      if (!this.owned(key)) return;
      if (previous) {
        if (
          value.id !== key ||
          previous.flowId !== value.flowId ||
          previous.versionId !== value.versionId
        )
          fail('固定运行身份不能覆盖');
        if (['QUEUED', 'RUNNING'].includes(value.state)) this.verified(key);
        return;
      }
      if (!this.newSnapshots.has(key)) fail('新运行须在同一事务准备新快照');
      const owner = this.owner(key, value);
      if (this.store.get(LEDGER, key) || this.store.get(SOURCES, key)) fail('初始目录身份已使用');
      const base = createLedger(owner);
      this.pending.set(key, {
        owner,
        base,
        refs: [],
        values: base.values,
        results: [],
        touched: new Map(),
      });
      return;
    }
    const runId = this.sourceRun(kind, key, value);
    const previousRunId = previous === undefined ? undefined : this.sourceRun(kind, key, previous);
    if (previousRunId && this.owned(previousRunId) && previousRunId !== runId)
      fail('原副本拥有者不能更换或移除');
    if (!runId || !this.owned(runId)) return;
    if (previous && previousRunId !== runId) fail('原副本拥有者不能更换');
    const ref = this.descriptor(runId, kind, key, value)!;
    // Bound the actual complete row before inserting it, never just a small descriptor.
    rawCharge(ref.family, ref.id, value);
    this.touch(runId).touched.set(refKey(ref), ref);
  }
  beforeRemove(kind: string, key: string, previous: unknown) {
    if (previous === undefined) return;
    if ([LEDGER, SOURCES, 'snapshot', 'run'].includes(kind) && this.owned(key))
      fail('此政策尚无删除或清理接口');
    const runId = this.sourceRun(kind, key, previous);
    if (runId && this.owned(runId)) fail('保留副本不能单独删除');
  }
  beforeEvent(event: { runId: string; sequence: number; type: string }) {
    if (event.type === 'ai-outcome')
      this.beforePut('@ai-event', String(event.sequence), event, undefined);
  }
  stageResult(runId: string, meta: ResultMeta, value: unknown) {
    const held = this.stateHolds.get(meta.id);
    if (held && (held.runId !== runId || !equal(held.meta, meta) || !equal(held.value, value)))
      fail('状态结果与已预留的完整值不一致');
    if (
      meta.type === 'context' &&
      (value as { operation?: unknown })?.operation === 'state.write' &&
      !held
    )
      fail('状态结果缺少提交前的完整空间预留');
    const pending = this.touch(runId);
    const candidate = encode(value, runId, meta.id);
    if (
      digest(read(candidate, runId, meta.id)) !== meta.sha256 ||
      candidate.roots[0].bytes !== meta.bytes
    )
      fail('原完整结果摘要或字节不符');
    pending.values = merge(pending.values, candidate);
    const existing = [...pending.base.results, ...pending.results].find((r) => r.id === meta.id);
    if (existing && !equal(existing, meta)) fail('逻辑结果身份已使用');
    if (!existing) pending.results.push(meta);
  }
  /** Exact result plus the largest complete receipt stage; includes every outstanding hold. */
  reserveState(runId: string, meta: ResultMeta, value: unknown, stages: StateReceiptStages) {
    if (this.stateHolds.has(meta.id)) fail('此状态结果已有未消费预留');
    const hold = structuredClone({ runId, meta, value, stages });
    const all = [...this.stateHolds.values()].filter((h) => h.runId === runId).concat(hold);
    this.store.atomic(() => {
      const { owner, ledger, refs } = this.verified(runId);
      const projectedRevision =
        ledger.revision +
        2 * all.filter((h) => !ledger.results.some((r) => r.id === h.meta.id)).length;
      if (
        !Number.isSafeInteger(projectedRevision) ||
        projectedRevision > Number.MAX_SAFE_INTEGER - 1
      )
        fail('目录修订不足以保存准备和提交阶段');
      let values = ledger.values;
      const results = new Map(ledger.results.map((r) => [r.id, r]));
      const sources = new Map(refs.map((r) => [refKey(r), r]));
      const overrides = new Map<string, ActualCopy>();
      const future = (kind: string, key: string, body: unknown) => {
        const ref = this.descriptor(runId, kind, key, body);
        if (!ref) fail('状态预算来源无法登记');
        sources.set(refKey(ref), ref);
        overrides.set(refKey(ref), { family: ref.family, id: ref.id, value: body });
      };
      for (const item of all) {
        const encoded = encode(item.value, runId, item.meta.id);
        if (
          encoded.roots[0].sha256 !== item.meta.sha256 ||
          encoded.roots[0].bytes !== item.meta.bytes
        )
          fail('预留完整结果不一致');
        values = merge(values, encoded);
        const old = results.get(item.meta.id);
        if (old && !equal(old, item.meta)) fail('预留结果身份冲突');
        results.set(item.meta.id, item.meta);
        if (!item.stages.rows.length || item.stages.rows.length > 5) fail('状态预算阶段不完整');
        let largest: { value: unknown; bytes: number } | undefined;
        for (const body of item.stages.rows) {
          const ref = this.descriptor(runId, 'template-data-operation', item.stages.key, body);
          if (!ref) fail('状态回执拥有者不一致');
          const size = rawCharge(ref.family, ref.id, body).bytes;
          if (!largest || size > largest.bytes) largest = { value: body, bytes: size };
        }
        future('template-data-operation', item.stages.key, largest!.value);
        future('typed-run-result', item.meta.id, {
          runId,
          meta: item.meta,
          retention: 'run-owned-results-v1',
        });
      }
      future('typed-run-index', runId, { entries: [...results.values()] });
      const ordered = [...sources.values()].sort((a, b) =>
        refKey(a) < refKey(b) ? -1 : refKey(a) > refKey(b) ? 1 : 0,
      );
      const index: SourceIndex = { version: 1, owner, refs: ordered };
      this.index(index, owner);
      const actual = [
        this.indexCopy(index),
        ...ordered.map((r) => overrides.get(refKey(r)) ?? this.actual(r, runId)),
      ];
      const before = new Map(ledger.copies.map((c) => [c.family + ':' + c.id, c.sha256]));
      const candidate = propose(ledger, owner, ledger.revision, {
        values,
        results: [...results.values()].filter((r) => !ledger.results.some((x) => x.id === r.id)),
        copies: actual.map((c) => ({ ...c, before: before.get(c.family + ':' + c.id) ?? null })),
      });
      // Prepared and atomic written/result commits each advance the original directory once.
      candidate.revision = Math.max(candidate.revision, projectedRevision);
      inspectLedger(candidate, owner);
    });
    this.stateHolds.set(meta.id, hold);
    return () => {
      if (this.stateHolds.get(meta.id) === hold) this.stateHolds.delete(meta.id);
    };
  }
  assertStateReservation(runId: string, nodeId: string, nodeInstance: string, value: unknown) {
    const id = digest({ runId, nodeId, nodeInstance, type: 'context' });
    const held = this.stateHolds.get(id);
    if (
      !held ||
      held.runId !== runId ||
      held.meta.sha256 !== digest(value) ||
      !equal(held.value, value) ||
      held.stages.key !== (value as { operationId?: unknown })?.operationId
    )
      fail('状态提交没有匹配的完整空间预留');
  }
  /** Called before the surrounding original transaction commits. Never starts another transaction. */
  prepareCommit() {
    this.committing = true;
    try {
      for (const runId of this.newSnapshots) {
        if (!this.newRuns.has(runId)) fail('新政策快照没有同事务创建的运行');
        if (!this.pending.has(runId)) {
          const owner = this.owner(runId),
            base = createLedger(owner);
          if (this.store.get(LEDGER, runId) || this.store.get(SOURCES, runId))
            fail('初始目录身份已使用');
          this.pending.set(runId, {
            owner,
            base,
            refs: [],
            values: base.values,
            results: [],
            touched: new Map(),
          });
        }
      }
      for (const [runId, pending] of this.pending) {
        if (!equal(this.owner(runId), pending.owner)) fail('提交时拥有者已变化');
        const refs = new Map(pending.refs.map((r) => [refKey(r), r]));
        for (const [key, ref] of pending.touched) refs.set(key, ref);
        const ordered = [...refs.values()].sort((a, b) =>
          refKey(a) < refKey(b) ? -1 : refKey(a) > refKey(b) ? 1 : 0,
        );
        const index: SourceIndex = { version: 1, owner: pending.owner, refs: ordered };
        this.index(index, pending.owner);
        const oldCopies = new Map(pending.base.copies.map((c) => [c.family + ':' + c.id, c]));
        const actual = [this.indexCopy(index), ...ordered.map((r) => this.actual(r, runId))];
        const copies = actual.map((c) => ({
          ...c,
          before: oldCopies.get(c.family + ':' + c.id)?.sha256 ?? null,
        }));
        const next = propose(pending.base, pending.owner, pending.base.revision, {
          values: pending.values,
          results: pending.results,
          copies,
        });
        if (!result_retention_result_ledger_v1(next)) fail('最终目录格式无效');
        verifyCopies(next, pending.owner, actual);
        this.consistency(next, ordered, pending.owner);
        this.store.put(SOURCES, runId, index);
        this.store.put(LEDGER, runId, next);
      }
    } finally {
      this.committing = false;
    }
  }
  finishTransaction() {
    this.pending.clear();
    this.newRuns.clear();
    this.newSnapshots.clear();
  }
  release(runId: string) {
    for (const [id, hold] of this.stateHolds) if (hold.runId === runId) this.stateHolds.delete(id);
  }
  list(runId: string): ResultMeta[] {
    const pending = this.pending.get(runId);
    return structuredClone(
      pending
        ? [...pending.base.results, ...pending.results]
        : this.store.atomic(() => this.verified(runId).ledger.results),
    );
  }
  read(runId: string, id: string): unknown {
    return this.store.atomic(() => {
      if (this.pending.has(runId)) fail('本次结果正在登记，请待保存完成后读取');
      return read(this.verified(runId).ledger.values, runId, id);
    });
  }
  capacity(runId: string) {
    return this.summary(runId).capacity;
  }
  summary(runId: string) {
    return this.store.atomic(() => {
      if (this.pending.has(runId)) fail('本次结果正在登记，请待保存完成后读取');
      const v = this.verified(runId);
      return {
        entries: structuredClone(v.ledger.results),
        capacity: ledgerCapacity(v.ledger, v.owner),
      };
    });
  }
}

/** Single complete-value route for typed results and profile-document source consumers. */
export function storedTypedResult(store: Store, id: string) {
  return store.atomic(() => {
    const row = store.get<any>('typed-run-result', id);
    if (!row) return;
    if (!store.resultLedgers.owned(row.runId)) {
      if (row.retention !== undefined) fail('旧运行不能采用新引用');
      return row;
    }
    return { runId: row.runId, meta: row.meta, value: store.resultLedgers.read(row.runId, id) };
  });
}
