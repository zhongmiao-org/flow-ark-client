import type { Store } from './store';
import type { Run } from '../shared/types';
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
const byKey: Record<string, RawFamily> = {
  'template-result': 'entry-result',
  'author-sdk-result': 'entry-result',
  'entry-result-display': 'entry-display',
  'run-result-reuse': 'entry-reuse',
  'typed-run-index': 'typed-result-index',
  output: 'run-output',
};
const byBody: Record<string, RawFamily> = {
  'template-data-operation': 'state-operation',
  'template-effect': 'effect-operation',
  'typed-run-result': 'typed-result-record',
  'browser-fields-input': 'browser-input-proof',
  'browser-scroll-input': 'browser-input-proof',
  'document-source-proof': 'document-source-proof',
};
function fail(reason: string): never {
  throw Error('完整结果保留不可核验：' + reason);
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
  private committing = false;
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
    if (!snapshot || !Object.hasOwn(snapshot, 'resultRetention')) return false;
    if (!result_retention_policy_v1(snapshot.resultRetention)) fail('运行保存政策无效');
    return true;
  }
  private owner(runId: string, supplied?: Run): LedgerOwner {
    const run = supplied ?? this.store.get<Run>('run', runId);
    const snapshot = this.store.get<any>('snapshot', runId);
    if (!run || !snapshot || run.id !== runId || run.flowId !== snapshot.id || !this.owned(runId))
      fail('原运行或固定方案缺失');
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
    if (value === undefined) fail('原值副本缺失');
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
  }
  private verified(runId: string) {
    const owner = this.owner(runId);
    const ledger = this.store.get<ResultLedger>(LEDGER, runId);
    if (!ledger || !result_retention_result_ledger_v1(ledger)) fail('目录缺失或无效');
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
      return;
    }
    if (kind === 'run') {
      if (!this.owned(key)) return;
      if (previous) {
        if (previous.flowId !== value.flowId || previous.versionId !== value.versionId)
          fail('固定运行身份不能覆盖');
        if (['QUEUED', 'RUNNING'].includes(value.state)) this.verified(key);
        return;
      }
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
    if (!runId || !this.owned(runId)) return;
    if (previous && this.sourceRun(kind, key, previous) !== runId) fail('原副本拥有者不能更换');
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
  /** Called before the surrounding original transaction commits. Never starts another transaction. */
  prepareCommit() {
    this.committing = true;
    try {
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
    return this.store.atomic(() => {
      if (this.pending.has(runId)) fail('本次结果正在登记，请待保存完成后读取');
      const v = this.verified(runId);
      return ledgerCapacity(v.ledger, v.owner);
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
