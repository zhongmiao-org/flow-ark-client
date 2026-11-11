import {
  isTemplateAttentionOrigin,
  type TemplateAttentionOrigin,
} from '../../contracts/template-attention';
import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { now, redact } from '../shared/utils';
import type { AINodeReceipt, Event, Run, RunState } from '../shared/types';
import { ai_receipt_v1 } from '../shared/node-schema.generated';
import { RunResultLedgerStore } from './result-ledger';

// Stored documents contain JSON values. Freeze the complete tree before sharing it
// with a read-only host consumer; ordinary reads still receive mutable copies.
function freezeDocument<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDocument(child);
  }
  return value;
}

// Development storage has one current layout; no legacy migration runs at startup.
export function initializeStore(db: DatabaseSync) {
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number })
    .user_version;
  if (version === 2) return;
  if (version !== 0) throw new Error('数据格式不支持；请先通过显式维护工具清理开发数据');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(
      'CREATE TABLE documents(kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE events(run_id TEXT NOT NULL,seq INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(run_id,seq)); PRAGMA user_version=2; COMMIT;',
    );
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export class Store {
  private db: DatabaseSync;
  private key: Buffer | null;
  private transactionDepth = 0;
  private writeGeneration = 0;
  private cacheReferenceGeneration = 0;
  private templateSourceGeneration = 0;
  private flowCatalogCache?: { externalVersion: number; rows: unknown[] };
  private artifactCatalogCache?: { externalVersion: number; runs: Map<string, unknown[]> };
  private attentionKeyIndex?: { externalVersion: number; ids: Map<string, string> };
  private protectedRows = new Map<string, { payload: string; value: unknown; weight: number }>();
  private protectedRowsWeight = 0;
  private dropProtectedRow(key: string) {
    const row = this.protectedRows.get(key);
    if (row) this.protectedRowsWeight -= row.weight;
    this.protectedRows.delete(key);
  }
  get templateSourceRevision() {
    const external = this.db.prepare('PRAGMA data_version').get() as { data_version: number };
    return `${this.templateSourceGeneration}:${external.data_version}`;
  }
  get cacheReferenceRevision() {
    const external = this.db.prepare('PRAGMA data_version').get() as { data_version: number };
    return `${this.cacheReferenceGeneration}:${external.data_version}`;
  }
  readonly resultLedgers: RunResultLedgerStore;
  fault?: string;
  constructor(path: string, key: Buffer | null, private storageMode: 'encrypted' | 'workspace-json-v1' = 'encrypted') {
    if (storageMode === 'encrypted' && key?.length !== 32) throw new Error('受保护的数据密钥不可用');
    this.key = key;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    try {
      chmodSync(path, 0o600);
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      initializeStore(this.db);
    } catch (error) {
      this.db.close();
      throw error;
    }
    this.resultLedgers = new RunResultLedgerStore(this);
  }
  private seal(v: any): string {
    if (this.storageMode === 'workspace-json-v1') return 'workspace-json-v1:' + JSON.stringify(v);
    if (!this.key) throw new Error('受保护的数据密钥不可用');
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    return Buffer.concat([
      iv,
      c.update(JSON.stringify(v), 'utf8'),
      c.final(),
      c.getAuthTag(),
    ]).toString('base64');
  }
  private open(s: string): any {
    if (this.storageMode === 'workspace-json-v1') {
      if (!s.startsWith('workspace-json-v1:')) throw new Error('普通工作区格式不符，未尝试解密或重建');
      return JSON.parse(s.slice('workspace-json-v1:'.length));
    }
    if (!this.key || s.startsWith('workspace-json-v1:')) throw new Error('加密工作区格式或密钥不符');
    const b = Buffer.from(s, 'base64');
    const c = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12));
    c.setAuthTag(b.subarray(-16));
    return JSON.parse(Buffer.concat([c.update(b.subarray(12, -16)), c.final()]).toString('utf8'));
  }
  tx<T>(fn: () => T): T {
    if (this.fault) throw new Error(this.fault);
    this.write(() => this.db.exec('BEGIN IMMEDIATE'));
    this.transactionDepth++;
    this.writeGeneration = 0;
    try {
      const r = fn();
      this.resultLedgers.prepareCommit();
      this.write(() => this.db.exec('COMMIT'));
      return r;
    } catch (e) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        this.fault = '本地存储回滚失败，已停止新运行';
      }
      throw e;
    } finally {
      this.transactionDepth--;
      this.resultLedgers.finishTransaction();
    }
  }
  get inTransaction() {
    return this.transactionDepth > 0;
  }
  get transactionWriteGeneration() {
    return this.writeGeneration;
  }
  /** Reuse the original host transaction; never nest BEGIN or commit a caller's partial writes. */
  atomic<T>(fn: () => T): T {
    return this.inTransaction ? fn() : this.tx(fn);
  }
  private write<T>(fn: () => T): T {
    if (this.fault) throw new Error(this.fault);
    try {
      return fn();
    } catch (e) {
      this.fault = '本地存储写入失败，已停止新运行';
      throw e;
    }
  }
  put(kind: string, id: string, value: any) {
    if (this.fault) throw new Error(this.fault);
    return this.atomic(() => {
      this.dropProtectedRow(`${kind}\0${id}`);
      if (['flow', 'template-instance', 'template-package'].includes(kind))
        this.templateSourceGeneration++;
      if (kind === 'flow') this.flowCatalogCache = undefined;
      if (kind === 'artifact') this.artifactCatalogCache = undefined;
      if (kind === 'attention') this.attentionKeyIndex = undefined;
      if (!['cache-cleanup', 'cache-registration'].includes(kind)) this.cacheReferenceGeneration++;
      // Match the actual protected JSON row; optional undefined headers are not persisted.
      const stored = JSON.parse(JSON.stringify(value));
      if (this.resultLedgers.observes(kind))
        this.resultLedgers.beforePut(kind, id, stored, this.get(kind, id));
      try {
        this.writeGeneration++;
        this.db
          .prepare(
            'INSERT INTO documents VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload',
          )
          .run(kind, id, this.seal(stored));
      } catch (e) {
        this.fault = '本地存储写入失败，已停止新运行';
        throw e;
      }
    });
  }
  get<T = any>(kind: string, id: string): T | undefined {
    return this.readDocument<T>(kind, id, false);
  }
  /** SDK inspection only. Every access still checks the complete current ciphertext. */
  runSnapshotView<T = any>(id: string): Readonly<T> | undefined {
    return this.readDocument<T>('snapshot', id, true);
  }
  private readDocument<T>(kind: string, id: string, immutable: boolean): T | undefined {
    const row = this.db
      .prepare('SELECT payload FROM documents WHERE kind=? AND id=?')
      .get(kind, id) as { payload: string } | undefined;
    const key = `${kind}\0${id}`;
    if (!row) {
      this.dropProtectedRow(key);
      return;
    }
    const reusable =
      !this.inTransaction && ['snapshot', 'flow', 'template-instance'].includes(kind);
    const cached = reusable ? this.protectedRows.get(key) : undefined;
    // Always query and compare the complete current ciphertext, including external writes.
    if (cached?.payload === row.payload) {
      this.protectedRows.delete(key);
      this.protectedRows.set(key, cached);
      return (immutable ? freezeDocument(cached.value) : structuredClone(cached.value)) as T;
    }
    if (reusable) this.dropProtectedRow(key);
    const value = this.open(row.payload);
    // Conservative text-size weight, not an exact heap measurement. Small rows stay uncached.
    const weight = row.payload.length * 6;
    const budget = 16 * 1024 * 1024;
    if (reusable && row.payload.length >= 16 * 1024 && weight <= budget) {
      while (this.protectedRows.size >= 8 || this.protectedRowsWeight + weight > budget)
        this.dropProtectedRow(this.protectedRows.keys().next().value!);
      this.protectedRows.set(key, { payload: row.payload, value, weight });
      this.protectedRowsWeight += weight;
      return (immutable ? freezeDocument(value) : structuredClone(value)) as T;
    }
    return immutable ? freezeDocument(value) : value;
  }
  list<T = any>(kind: string): T[] {
    return (
      this.db
        .prepare('SELECT payload FROM documents WHERE kind=? ORDER BY rowid')
        .all(kind) as any[]
    ).map((r) => this.open(r.payload));
  }
  /** File availability is still inspected live by the caller; only stored metadata is reused. */
  artifactsForRun<T extends { runId: string }>(runId: string): readonly T[] {
    if (this.inTransaction)
      return this.list<T>('artifact').filter((artifact) => artifact.runId === runId);
    const version = () =>
      (this.db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
    const before = version();
    if (this.artifactCatalogCache?.externalVersion === before)
      return (this.artifactCatalogCache.runs.get(runId) ?? []) as T[];
    this.artifactCatalogCache = undefined;
    const rows = this.list<T>('artifact');
    if (
      before === version() &&
      Buffer.byteLength(JSON.stringify(rows), 'utf8') <= 32 * 1024 * 1024
    ) {
      const runs = new Map<string, T[]>();
      for (const row of freezeDocument(rows)) {
        const run = runs.get(row.runId) ?? [];
        run.push(row);
        runs.set(row.runId, run);
      }
      for (const run of runs.values()) Object.freeze(run);
      this.artifactCatalogCache = { externalVersion: before, runs };
      return runs.get(runId) ?? [];
    }
    return rows.filter((artifact) => artifact.runId === runId);
  }
  /** Bootstrap may reuse an unchanged catalog; execution and preflight keep fresh reads. */
  flowCatalog<T = any>(): T[] {
    return this.readFlowCatalog<T>(false);
  }
  /** Bootstrap serializes this immutable tree through IPC instead of cloning it twice. */
  flowCatalogView<T = any>(): readonly T[] {
    return this.readFlowCatalog<T>(true);
  }
  private readFlowCatalog<T>(immutable: boolean): T[] {
    // Never retain uncommitted rows, including rows from a transaction that later rolls back.
    if (this.inTransaction) {
      const rows = this.list<T>('flow');
      return immutable ? freezeDocument(rows) : rows;
    }
    const externalVersion = () =>
      (this.db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
    const before = externalVersion();
    if (this.flowCatalogCache?.externalVersion === before)
      return (
        immutable
          ? freezeDocument(this.flowCatalogCache.rows)
          : structuredClone(this.flowCatalogCache.rows)
      ) as T[];
    this.flowCatalogCache = undefined;
    const rows = this.list<T>('flow');
    // Keep the complete catalog or nothing. Other connections can invalidate it during loading.
    if (
      externalVersion() === before &&
      Buffer.byteLength(JSON.stringify(rows), 'utf8') <= 32 * 1024 * 1024
    ) {
      this.flowCatalogCache = { externalVersion: before, rows };
      return immutable ? freezeDocument(rows) : structuredClone(rows);
    }
    return immutable ? freezeDocument(rows) : rows;
  }
  *cacheReferenceDocuments(): Generator<unknown> {
    // Stream only on an explicit maintenance scan, without copying the database.
    for (const row of this.db
      .prepare(
        "SELECT payload FROM documents WHERE kind NOT IN ('cache-cleanup','cache-registration')",
      )
      .iterate())
      yield this.open(row.payload as string);
  }
  remove(kind: string, id: string) {
    return this.atomic(() => {
      this.dropProtectedRow(`${kind}\0${id}`);
      if (['flow', 'template-instance', 'template-package'].includes(kind))
        this.templateSourceGeneration++;
      if (kind === 'flow') this.flowCatalogCache = undefined;
      if (kind === 'artifact') this.artifactCatalogCache = undefined;
      if (kind === 'attention') this.attentionKeyIndex = undefined;
      if (!['cache-cleanup', 'cache-registration'].includes(kind)) this.cacheReferenceGeneration++;
      if (this.resultLedgers.observes(kind))
        this.resultLedgers.beforeRemove(kind, id, this.get(kind, id));
      this.writeGeneration++;
      this.write(() =>
        this.db.prepare('DELETE FROM documents WHERE kind=? AND id=?').run(kind, id),
      );
    });
  }
  eventAt(runId: string, sequence: number): Event | undefined {
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw Error('运行回执位置无效');
    const row = this.db
      .prepare('SELECT payload FROM events WHERE run_id=? AND seq=?')
      .get(runId, sequence) as { payload: string } | undefined;
    return row ? this.open(row.payload) : undefined;
  }
  lastPosition(kind: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(rowid),0) n FROM documents WHERE kind=?')
      .get(kind) as any;
    const n = Number(row.n);
    if (!Number.isSafeInteger(n) || n < 0 || n >= Number.MAX_SAFE_INTEGER)
      throw new Error('本地记录位置超出支持范围');
    return n;
  }
  position(kind: string, id: string): number {
    const row = this.db
      .prepare('SELECT rowid AS n FROM documents WHERE kind=? AND id=?')
      .get(kind, id) as { n: number } | undefined;
    const n = Number(row?.n);
    if (!Number.isSafeInteger(n) || n < 1) throw new Error('本地记录位置不存在或无效');
    return n;
  }
  count(kind: string, after = 0): number {
    return Number(
      (
        this.db
          .prepare('SELECT COUNT(*) n FROM documents WHERE kind=? AND rowid>?')
          .get(kind, after) as any
      ).n,
    );
  }
  page<T>(
    kind: string,
    ceiling: number,
    before: number,
    limit: number,
  ): { position: number; value: T }[] {
    return (
      this.db
        .prepare(
          'SELECT rowid AS position,payload FROM documents NOT INDEXED WHERE kind=? AND rowid<=? AND rowid<? ORDER BY rowid DESC LIMIT ?',
        )
        .all(kind, ceiling, before, limit) as any[]
    ).map((r) => ({ position: Number(r.position), value: this.open(r.payload) }));
  }
  event(runId: string, type: string, nodeInstance: string, data: any): Event {
    return this.appendEvent(runId, type, nodeInstance, redact(data));
  }
  aiOutcome(runId: string, nodeInstance: string, receipt: AINodeReceipt, secrets: string[]): Event {
    if (!ai_receipt_v1(receipt)) throw new Error('AI收据格式无效，未登记');
    // Validated usage has only fixed field names and nonnegative safe integer values.
    // Keep those counts, while redacting all free-form metadata with the Run's secrets.
    const { usage, ...metadata } = receipt;
    return this.appendEvent(runId, 'ai-outcome', nodeInstance, {
      ...redact(metadata, secrets),
      usage,
    });
  }
  private appendEvent(runId: string, type: string, nodeInstance: string, data: any): Event {
    return this.atomic(() => {
      const sequence = Number(
        (
          this.db
            .prepare('SELECT COALESCE(MAX(seq),0)+1 n FROM events WHERE run_id=?')
            .get(runId) as any
        ).n,
      );
      const event = JSON.parse(
        JSON.stringify({
          runId,
          sequence,
          time: now(),
          type,
          nodeInstance,
          data,
        }),
      ) as Event;
      this.resultLedgers.beforeEvent(event);
      this.writeGeneration++;
      this.write(() =>
        this.db.prepare('INSERT INTO events VALUES(?,?,?)').run(runId, sequence, this.seal(event)),
      );
      return event;
    });
  }
  events(runId: string): Event[] {
    return (
      this.db.prepare('SELECT payload FROM events WHERE run_id=? ORDER BY seq').all(runId) as any[]
    ).map((r) => this.open(r.payload));
  }
  state(id: string, state: RunState, extra: Partial<Run> = {}) {
    this.tx(() => {
      const run = this.get<Run>('run', id);
      if (!run) throw new Error('运行不存在');
      this.put('run', id, { ...run, ...extra, state, updatedAt: now() });
      this.event(id, 'state', '', { state, ...extra });
    });
  }
  recover() {
    this.tx(() => {
      for (const r of this.list<Run>('run'))
        if (['QUEUED', 'RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING'].includes(r.state)) {
          this.put('run', r.id, {
            ...r,
            state: 'INTERRUPTED',
            updatedAt: now(),
            business: '待核对：上次运行中断，未自动重放',
          });
          this.event(r.id, 'state', '', {
            state: 'INTERRUPTED',
            reason: 'host-restarted',
          });
        }
      for (const a of this.list<any>('template-effect'))
        if (a.state === 'submitting') {
          this.put('template-effect', a.id, { ...a, state: 'unknown' });
          this.templateEffectAttention(a, '上次运行中断，操作结果未确认。');
        }
      for (const receipt of this.list<any>('desktop-effect'))
        if (receipt.status === 'unknown')
          this.attention(
            'unknown-result',
            '应用修改结果待核对',
            { runId: receipt.runId, nodeId: receipt.nodeId },
            'desktop:' + receipt.runId + ':' + receipt.nodeId,
          );
    });
  }
  templateEffectAttention(effect: { id: string; runId: string }, reason: string) {
    return this.attention(
      'unknown-result',
      '操作结果待核对',
      { effectId: effect.id, runId: effect.runId, reason },
      'unknown:' + effect.id,
    );
  }
  private attentionWithKey(key: string): any {
    // A rolled-back write must never become the source for a later dedupe decision.
    if (this.inTransaction) return this.list<any>('attention').find((a) => a.dedupeKey === key);
    const externalVersion = () =>
      (this.db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
    const before = externalVersion();
    if (this.attentionKeyIndex?.externalVersion === before) {
      const id = this.attentionKeyIndex.ids.get(key);
      if (id === undefined) return undefined;
      const item = this.get<any>('attention', id);
      if (item?.dedupeKey === key) return item;
    }
    this.attentionKeyIndex = undefined;
    const documents = this.db
        .prepare('SELECT id,payload FROM documents WHERE kind=? ORDER BY rowid')
        .all('attention') as { id: string; payload: string }[],
      rows = documents.map((row) => this.open(row.payload)),
      ids = new Map<string, string>();
    let bytes = 0,
      reusable = true;
    for (const [position, row] of rows.entries()) {
      if (
        typeof row.dedupeKey !== 'string' ||
        typeof row.id !== 'string' ||
        !row.id ||
        row.id !== documents[position].id
      ) {
        reusable = false;
        break;
      }
      // list() preserves rowid order, including reminders currently in the recycle bin.
      if (!ids.has(row.dedupeKey)) {
        ids.set(row.dedupeKey, row.id);
        bytes += Buffer.byteLength(row.dedupeKey, 'utf8') + Buffer.byteLength(row.id, 'utf8');
        if (bytes > 4 * 1024 * 1024) {
          reusable = false;
          break;
        }
      }
    }
    if (reusable && externalVersion() === before)
      this.attentionKeyIndex = { externalVersion: before, ids };
    return rows.find((a) => a.dedupeKey === key);
  }
  attention(
    kind: string,
    title: string,
    detail: any,
    key: string,
    origin?: TemplateAttentionOrigin,
  ) {
    if (kind === 'template' && !isTemplateAttentionOrigin(origin))
      throw new Error('模板提醒缺少有效宿主来源');
    const old = this.attentionWithKey(key);
    if (old) return old;
    const item = {
      id: crypto.randomUUID(),
      kind,
      title,
      detail,
      dedupeKey: key,
      read: false,
      time: now(),
      ...(kind === 'template' ? { origin } : {}),
    };
    this.put('attention', item.id, item);
    return item;
  }
  close() {
    this.protectedRows.clear();
    this.protectedRowsWeight = 0;
    this.db.close();
    this.key?.fill(0);
  }
}
