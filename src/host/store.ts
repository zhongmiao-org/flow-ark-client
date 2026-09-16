import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { now, redact } from '../shared/utils';
import type { Event, Run, RunState } from '../shared/types';
export class Store {
  private db: DatabaseSync;
  private key: Buffer;
  fault?: string;
  constructor(path: string, key: Buffer) {
    if (key.length !== 32) throw new Error('受保护的数据密钥不可用');
    this.key = key;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = (this.db.prepare('PRAGMA user_version').get() as any).user_version;
    if (version > 1) throw new Error('数据库版本比客户端新，已阻止打开；未删除数据');
    if (version === 0)
      this.tx(() =>
        this.db.exec(
          `CREATE TABLE documents(kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE events(run_id TEXT NOT NULL,seq INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(run_id,seq)); PRAGMA user_version=1;`,
        ),
      );
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
      for (const a of this.list<any>('action'))
        if (a.state === 'SUBMITTING') {
          this.put('action', a.id, { ...a, state: 'UNKNOWN' });
          this.attention('unknown-result', '外发结果待核对', { actionId: a.id }, 'unknown:' + a.id);
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
