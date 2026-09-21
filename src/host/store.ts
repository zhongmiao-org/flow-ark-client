import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { now, redact } from '../shared/utils';
import type { Event, Run, RunState } from '../shared/types';

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
  private key: Buffer;
  fault?: string;
  constructor(path: string, key: Buffer) {
    if (key.length !== 32) throw new Error('受保护的数据密钥不可用');
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
  }
  private seal(v: any): string {
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
    const b = Buffer.from(s, 'base64');
    const c = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12));
    c.setAuthTag(b.subarray(-16));
    return JSON.parse(Buffer.concat([c.update(b.subarray(12, -16)), c.final()]).toString('utf8'));
  }
  tx<T>(fn: () => T): T {
    if (this.fault) throw new Error(this.fault);
    this.write(() => this.db.exec('BEGIN IMMEDIATE'));
    try {
      const r = fn();
      this.write(() => this.db.exec('COMMIT'));
      return r;
    } catch (e) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        this.fault = '本地存储回滚失败，已停止新运行';
      }
      throw e;
    }
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
    try {
      this.db
        .prepare(
          'INSERT INTO documents VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload',
        )
        .run(kind, id, this.seal(value));
    } catch (e) {
      this.fault = '本地存储写入失败，已停止新运行';
      throw e;
    }
  }
  get<T = any>(kind: string, id: string): T | undefined {
    const row = this.db
      .prepare('SELECT payload FROM documents WHERE kind=? AND id=?')
      .get(kind, id) as any;
    return row ? this.open(row.payload) : undefined;
  }
  list<T = any>(kind: string): T[] {
    return (
      this.db
        .prepare('SELECT payload FROM documents WHERE kind=? ORDER BY rowid')
        .all(kind) as any[]
    ).map((r) => this.open(r.payload));
  }
  remove(kind: string, id: string) {
    this.write(() => this.db.prepare('DELETE FROM documents WHERE kind=? AND id=?').run(kind, id));
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
    const sequence = Number(
      (
        this.db
          .prepare('SELECT COALESCE(MAX(seq),0)+1 n FROM events WHERE run_id=?')
          .get(runId) as any
      ).n,
    );
    const event = {
      runId,
      sequence,
      time: now(),
      type,
      nodeInstance,
      data: redact(data),
    };
    this.write(() =>
      this.db.prepare('INSERT INTO events VALUES(?,?,?)').run(runId, sequence, this.seal(event)),
    );
    return event;
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
          this.attention('unknown-result', '操作结果待核对', { effectId: a.id }, 'unknown:' + a.id);
        }
    });
  }
  attention(kind: string, title: string, detail: any, key: string) {
    const old = this.list<any>('attention').find((a) => a.dedupeKey === key);
    if (old) return old;
    const item = {
      id: crypto.randomUUID(),
      kind,
      title,
      detail,
      dedupeKey: key,
      read: false,
      time: now(),
    };
    this.put('attention', item.id, item);
    return item;
  }
  close() {
    this.db.close();
    this.key.fill(0);
  }
}
