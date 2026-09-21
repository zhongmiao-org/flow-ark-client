import { fork, execFile, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Store } from './store';
import { Rpc } from '../shared/rpc';
import { uid, now, errorText } from '../shared/utils';
import {
  SCRIPT_READY_TIMEOUT_MS,
  SCRIPT_CLEANUP_TIMEOUT_MS,
  SCRIPT_RECOVERY_TIMEOUT_MS,
  SCRIPT_EXECUTE_RPC_TIMEOUT_MS,
  SCRIPT_LEASE_KIND,
  ScriptProcessInterruptedError,
  type ScriptOwner,
  type ScriptExecution,
  type ScriptCall,
  type ScriptLease,
  type ScriptCleanupResult,
  type ScriptSupervisorMessage,
} from '../shared/script-supervision';

export type ScriptProcessesOptions = {
  store: Store;
  dir: string;
  executable: string;
  assertOwner: (owner: ScriptOwner) => void;
  call: (owner: ScriptOwner, method: ScriptCall, args: any) => Promise<unknown>;
};

// Unit tests can supply deterministic process handles and read-only probes.
// Production constructs this manager without a system override.
export type ScriptProcessSystem = {
  platform: NodeJS.Platform;
  bootId: () => Promise<string>;
  spawn: (entry: string, executable: string) => ChildProcess;
  groupExists: (pgid: number) => boolean;
};

function bounded<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const keyOf = (runId: string, invocationId: string) => runId + '\0' + invocationId;

export async function scriptBootId(): Promise<string> {
  if (process.platform === 'linux') {
    const value = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))
      throw new Error('无法识别系统启动身份');
    return 'linux:' + value.toLowerCase();
  }
  if (process.platform === 'darwin') {
    const value = await new Promise<string>((resolve, reject) => {
      execFile(
        '/usr/sbin/sysctl',
        ['-n', 'kern.boottime'],
        { timeout: SCRIPT_RECOVERY_TIMEOUT_MS },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
    });
    const match = value.match(/\bsec\s*=\s*(\d+)\s*,\s*usec\s*=\s*(\d+)\b/);
    if (
      !match ||
      !Number.isSafeInteger(Number(match[1])) ||
      Number(match[1]) <= 0 ||
      Number(match[2]) >= 1000000
    )
      throw new Error('无法识别系统启动身份');
    return `darwin:${Number(match[1])}:${Number(match[2])}`;
  }
  throw new Error('当前平台尚不支持可确认回收的脚本监护');
}

const nativeSystem: ScriptProcessSystem = {
  platform: process.platform,
  bootId: scriptBootId,
  spawn: (entry, executable) =>
    fork(entry, [], {
      execPath: executable,
      execArgv: [],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      detached: true,
    }),
  groupExists: (pgid) => {
    try {
      process.kill(-pgid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
      throw error;
    }
  },
};

export function validScriptLease(value: unknown): value is ScriptLease {
  if (!value || typeof value !== 'object') return false;
  const v = value as ScriptLease;
  return (
    v.recordVersion === 1 &&
    ['nonce', 'runId', 'invocationId', 'nodeId', 'nodeInstance', 'bootId', 'createdAt'].every(
      (field) =>
        typeof (v as any)[field] === 'string' &&
        Boolean((v as any)[field]) &&
        !(v as any)[field].includes('\0'),
    ) &&
    validBootId(v.bootId) &&
    Number.isFinite(Date.parse(v.createdAt)) &&
    ['allocating', 'registered', 'executing', 'closing', 'unknown'].includes(v.phase) &&
    ((v.pid === undefined &&
      v.pgid === undefined &&
      ['allocating', 'closing', 'unknown'].includes(v.phase)) ||
      (Number.isSafeInteger(v.pid) && v.pid! > 1 && v.pid === v.pgid))
  );
}

export function validBootId(value: string): boolean {
  if (/^linux:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value)) return true;
  const match = /^darwin:([1-9]\d*):(0|[1-9]\d*)$/.exec(value);
  return Boolean(
    match &&
      Number.isSafeInteger(Number(match[1])) &&
      Number.isSafeInteger(Number(match[2])) &&
      Number(match[2]) < 1000000,
  );
}

type Invocation = {
  owner: ScriptOwner;
  request?: ScriptExecution;
  lease?: ScriptLease;
  child?: ChildProcess;
  rpc?: Rpc;
  promise?: Promise<unknown>;
  close?: Promise<ScriptCleanupResult>;
  readyResolve: () => void;
  readyReject: (error: Error) => void;
  ready: Promise<void>;
  stopping: boolean;
  cancelled: boolean;
  authorized: boolean;
  exited: boolean;
  spawnFailed: boolean;
  unexpected?: string;
  interrupted?: string;
  confirmed: boolean;
  settled: boolean;
  retired?: boolean;
};

export class ScriptProcesses {
  readonly ready: Promise<void>;
  private block?: string;
  private boot?: string;
  private bootPromise?: Promise<string>;
  private stopping = false;
  private stoppedRuns = new Set<string>();
  private cancelled = new Set<string>();
  private recoveryRuns = new Set<string>();
  private invocations = new Map<string, Invocation>();
  private shutdownPromise?: Promise<ScriptCleanupResult>;

  constructor(
    private options: ScriptProcessesOptions,
    private system = nativeSystem,
  ) {
    this.ready = this.recover();
    // Callers still observe the original rejection; avoid an unhandled rejection
    // while Runtime is being constructed before its asynchronous init await.
    void this.ready.catch(() => {});
  }
  get recoveryError() {
    return this.block;
  }

  private blockExecution(message: string) {
    this.block ??= message;
  }
  private ownerValid(record: Invocation) {
    if (
      this.stopping ||
      this.stoppedRuns.has(record.owner.runId) ||
      record.cancelled ||
      this.cancelled.has(keyOf(record.owner.runId, record.owner.invocationId))
    )
      throw new Error('脚本调用已取消');
    if (this.block) throw new ScriptProcessInterruptedError(this.block);
    if (this.options.store.fault) throw new Error(this.options.store.fault);
    this.options.assertOwner(record.owner);
  }
  private live(record: Invocation) {
    this.ownerValid(record);
    if (record.stopping) throw new Error('脚本调用已停止');
  }

  private getBoot(): Promise<string> {
    this.bootPromise ??= bounded(
      this.system.bootId(),
      SCRIPT_RECOVERY_TIMEOUT_MS,
      '系统启动身份读取超时',
    ).then((boot) => {
      if (!validBootId(boot)) throw new Error('系统启动身份不可用');
      return (this.boot = boot);
    });
    return this.bootPromise;
  }

  private async recover() {
    const leases = this.options.store.list<unknown>(SCRIPT_LEASE_KIND);
    for (const item of leases) {
      const runId = (item as any)?.runId;
      if (typeof runId === 'string') this.recoveryRuns.add(runId);
    }
    if (!leases.length) return;
    const deadline = performance.now() + SCRIPT_RECOVERY_TIMEOUT_MS;
    try {
      this.boot = await this.getBoot();
    } catch (error) {
      this.blockExecution('脚本资源无法核对：' + errorText(error));
      return;
    }
    const unresolved: ScriptLease[] = [];
    for (const item of leases) {
      if (!validScriptLease(item)) {
        this.blockExecution('遗留脚本租约格式无效，已停止新运行');
        continue;
      }
      if (item.bootId !== this.boot) this.options.store.remove(SCRIPT_LEASE_KIND, item.nonce);
      else if (!item.pgid) this.blockExecution('遗留脚本启动身份不完整；请重启系统后核对运行结果');
      else unresolved.push(item);
    }
    while (unresolved.length) {
      for (let i = unresolved.length - 1; i >= 0; i--) {
        let exists: boolean;
        try {
          exists = this.system.groupExists(unresolved[i].pgid!);
        } catch (error) {
          this.blockExecution('遗留脚本进程组无法核对：' + errorText(error));
          unresolved.splice(i, 1);
          continue;
        }
        if (!exists) {
          this.options.store.remove(SCRIPT_LEASE_KIND, unresolved[i].nonce);
          unresolved.splice(i, 1);
        }
      }
      if (!unresolved.length) break;
      if (performance.now() >= deadline) {
        this.blockExecution('遗留脚本资源尚未确认退出；请重启系统后核对运行结果');
        break;
      }
      await delay(Math.min(25, Math.max(1, deadline - performance.now())));
    }
    this.recoveryRuns.clear();
    for (const item of this.options.store.list<any>(SCRIPT_LEASE_KIND))
      if (typeof item?.runId === 'string') this.recoveryRuns.add(item.runId);
  }

  execute(request: ScriptExecution): Promise<unknown> {
    // After Runtime retires a Run, late handlers cannot recreate a map entry or
    // start a process even though its short-lived deduplication records are gone.
    try {
      this.options.assertOwner(request);
    } catch (error) {
      return Promise.reject(error);
    }
    const key = keyOf(request.runId, request.invocationId);
    const existing = this.invocations.get(key);
    if (existing) return existing.promise!;
    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    void ready.catch(() => {});
    const record: Invocation = {
      owner: {
        runId: request.runId,
        invocationId: request.invocationId,
        nodeId: request.nodeId,
        nodeInstance: request.nodeInstance,
      },
      request,
      ready,
      readyResolve,
      readyReject,
      stopping: false,
      cancelled: this.cancelled.has(key),
      authorized: false,
      exited: false,
      spawnFailed: false,
      confirmed: false,
      settled: false,
    };
    this.invocations.set(key, record);
    record.promise = this.run(record).finally(() => {
      record.settled = true;
      record.request = undefined;
      if (record.retired && record.confirmed) this.invocations.delete(key);
    });
    return record.promise;
  }

  private async run(record: Invocation) {
    let result: unknown;
    let failure: unknown;
    try {
      await this.ready;
      this.live(record);
      if (!['darwin', 'linux'].includes(this.system.platform))
        throw new Error('当前平台尚不支持可确认回收的脚本监护');
      await this.getBoot();
      this.live(record);
      record.lease = {
        ...record.owner,
        recordVersion: 1,
        nonce: uid(),
        bootId: this.boot!,
        createdAt: now(),
        phase: 'allocating',
      };
      this.options.store.put(SCRIPT_LEASE_KIND, record.lease.nonce, record.lease);
      this.live(record);
      try {
        record.child = this.system.spawn(
          join(this.options.dir, 'script-supervisor.cjs'),
          this.options.executable,
        );
      } catch (error) {
        record.spawnFailed = true;
        throw error;
      }
      this.attach(record);
      const pid = record.child.pid;
      if (!Number.isSafeInteger(pid) || pid! <= 1) {
        await bounded(record.ready, SCRIPT_READY_TIMEOUT_MS, '脚本监护进程未能启动');
        throw new Error('脚本监护进程身份不可用');
      }
      record.lease = { ...record.lease, pid, pgid: pid, phase: 'registered' };
      this.options.store.put(SCRIPT_LEASE_KIND, record.lease.nonce, record.lease);
      this.live(record);
      this.send(record, { kind: 'script-init', nonce: record.lease.nonce });
      await bounded(record.ready, SCRIPT_READY_TIMEOUT_MS, '脚本监护进程准备超时');
      this.live(record);
      record.lease = { ...record.lease, phase: 'executing' };
      this.options.store.put(SCRIPT_LEASE_KIND, record.lease.nonce, record.lease);
      this.live(record);
      record.authorized = true;
      result = await record.rpc!.call(
        'execute',
        {
          path: record.request!.compiled,
          sha256: record.request!.sha256,
          input: record.request!.input,
        },
        SCRIPT_EXECUTE_RPC_TIMEOUT_MS,
      );
    } catch (error) {
      failure = error;
    }
    const cleanup = await this.close(record);
    if (!cleanup.confirmed)
      throw new ScriptProcessInterruptedError(
        [errorText(failure ?? ''), cleanup.error].filter(Boolean).join('\n'),
      );
    if (record.interrupted) throw new ScriptProcessInterruptedError(record.interrupted);
    if (failure) throw failure;
    if (cleanup.error) throw new Error(cleanup.error);
    this.ownerValid(record);
    return result;
  }

  private attach(record: Invocation) {
    const child = record.child!;
    record.rpc = new Rpc(
      (message) => this.send(record, { kind: 'script-rpc', nonce: record.lease!.nonce, message }),
      async (method, args) => {
        this.live(record);
        if (!['log', 'progress', 'artifact', 'credential', 'template'].includes(method))
          throw new Error('脚本能力不在白名单');
        const result = await this.options.call(record.owner, method as ScriptCall, args);
        this.live(record);
        return result;
      },
    );
    child.on('message', (message: ScriptSupervisorMessage) => {
      if (!message || message.nonce !== record.lease!.nonce) return;
      if (message.kind === 'script-ready') {
        if (record.stopping) return;
        if (
          message.pid !== child.pid ||
          message.pgid !== child.pid ||
          !Number.isSafeInteger(message.pid) ||
          message.pid <= 1
        ) {
          record.readyReject(new Error('脚本监护进程组身份不匹配'));
          return;
        }
        record.readyResolve();
      } else if (message.kind === 'script-fault') {
        record.interrupted ??= message.error;
        record.readyReject(new ScriptProcessInterruptedError(message.error));
        record.rpc?.close();
      } else if (message.kind === 'script-rpc' && !record.stopping) {
        void record.rpc!.receive(message.message as any);
      }
    });
    child.once('exit', () => {
      record.exited = true;
      if (!record.stopping) {
        record.unexpected = '脚本监护进程意外退出';
        record.interrupted ??= record.unexpected;
      }
      record.readyReject(new ScriptProcessInterruptedError(record.unexpected ?? '脚本调用已停止'));
      record.rpc?.close();
    });
    child.once('error', (error) => {
      if (!child.pid) record.spawnFailed = true;
      else if (!record.stopping) record.interrupted ??= '脚本监护进程错误：' + errorText(error);
      record.readyReject(error);
      record.rpc?.close();
    });
    child.once('disconnect', () => {
      if (!record.stopping) record.interrupted ??= '脚本监护通信意外断开';
      record.readyReject(new ScriptProcessInterruptedError('脚本监护通信已断开'));
      record.rpc?.close();
    });
  }

  private send(record: Invocation, message: ScriptSupervisorMessage) {
    const child = record.child;
    if (!child?.connected) throw new Error('脚本监护通信已断开');
    child.send(message, (error) => {
      if (error) {
        record.readyReject(error);
        record.rpc?.close();
      }
    });
  }

  private close(record: Invocation): Promise<ScriptCleanupResult> {
    if (record.close) return record.close;
    record.stopping = true;
    record.readyReject(new Error('脚本调用已停止'));
    record.rpc?.close();
    record.close = this.closeRecord(record);
    return record.close;
  }

  private async closeRecord(record: Invocation): Promise<ScriptCleanupResult> {
    const deadline = performance.now() + SCRIPT_CLEANUP_TIMEOUT_MS;
    let storageError: string | undefined;
    // Send before synchronous SQLite writes: a busy database must not postpone
    // the supervisor's independent cancellation timer or self-group stop.
    if (record.child?.connected) {
      try {
        this.send(record, {
          kind: 'script-stop',
          nonce: record.lease!.nonce,
          cooperative:
            record.cancelled || this.stoppedRuns.has(record.owner.runId) || this.stopping,
        });
      } catch {
        /* EOF also stops the controlled supervisor; confirm actual exit below. */
      }
    }
    if (record.lease) {
      record.lease = { ...record.lease, phase: 'closing' };
      try {
        this.options.store.put(SCRIPT_LEASE_KIND, record.lease.nonce, record.lease);
      } catch (error) {
        storageError = '脚本回收记录写入失败：' + errorText(error);
      }
    }
    let cleanupError: string | undefined;
    while (true) {
      if (!record.child || record.spawnFailed) {
        record.confirmed = !record.authorized;
        break;
      }
      if (record.exited) {
        const pgid = record.lease?.pgid;
        if (!pgid && !record.authorized) {
          record.confirmed = true;
          break;
        }
        if (pgid) {
          try {
            if (!this.system.groupExists(pgid)) {
              record.confirmed = true;
              break;
            }
          } catch (error) {
            cleanupError = '脚本进程组无法核对：' + errorText(error);
            break;
          }
        }
      }
      if (performance.now() >= deadline) break;
      await delay(Math.min(25, Math.max(1, deadline - performance.now())));
    }
    if (record.confirmed) {
      if (record.lease) {
        try {
          this.options.store.remove(SCRIPT_LEASE_KIND, record.lease.nonce);
        } catch (error) {
          storageError ??= '脚本回收租约无法清除：' + errorText(error);
        }
      }
      return { confirmed: true, ...(storageError ? { error: storageError } : {}) };
    }
    cleanupError ??= '脚本进程组尚未确认退出，请重启系统后核对运行结果';
    this.blockExecution(cleanupError);
    if (record.lease) {
      record.lease = { ...record.lease, phase: 'unknown', error: cleanupError };
      try {
        this.options.store.put(SCRIPT_LEASE_KIND, record.lease.nonce, record.lease);
      } catch (error) {
        storageError ??= '脚本回收诊断无法保存：' + errorText(error);
      }
    }
    return { confirmed: false, error: [cleanupError, storageError].filter(Boolean).join('\n') };
  }

  cancel(runId: string, invocationId: string, _reason?: string): Promise<ScriptCleanupResult> {
    const key = keyOf(runId, invocationId);
    this.cancelled.add(key);
    const record = this.invocations.get(key);
    if (!record) return Promise.resolve({ confirmed: true });
    record.cancelled = true;
    return this.close(record);
  }

  stopRun(runId: string, _reason?: string): Promise<ScriptCleanupResult> {
    this.stoppedRuns.add(runId);
    return this.closeAll(
      [...this.invocations.values()].filter((record) => record.owner.runId === runId),
    );
  }

  hasRun(runId: string): boolean {
    return (
      this.recoveryRuns.has(runId) ||
      [...this.invocations.values()].some(
        (record) => record.owner.runId === runId && (!record.settled || !record.confirmed),
      )
    );
  }

  // Runtime calls only after revoking this Run's owner and clearing Active.
  finishRun(runId: string): void {
    this.stoppedRuns.delete(runId);
    for (const key of this.cancelled) if (key.startsWith(runId + '\0')) this.cancelled.delete(key);
    for (const [key, record] of this.invocations) {
      if (record.owner.runId !== runId) continue;
      record.retired = true;
      if (record.confirmed && record.settled) this.invocations.delete(key);
    }
  }

  shutdown(): Promise<ScriptCleanupResult> {
    this.stopping = true;
    this.shutdownPromise ??= this.closeAll([...this.invocations.values()]);
    return this.shutdownPromise;
  }

  private async closeAll(records: Invocation[]): Promise<ScriptCleanupResult> {
    const results = await Promise.all(records.map((record) => this.close(record)));
    const errors = [...new Set(results.flatMap((result) => (result.error ? [result.error] : [])))];
    if (this.block) errors.push(this.block);
    return {
      confirmed: !this.block && results.every((result) => result.confirmed),
      ...(errors.length ? { error: errors.join('\n') } : {}),
    };
  }
}
