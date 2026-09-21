import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { child, killOwnedTree } from './processes';
import { Rpc } from '../shared/rpc';
import type { BrowserBinding, BrowserCommand } from '../shared/types';
import { errorText } from '../shared/utils';
import { sameWebPage, type TaskWebTarget, type WebPageIdentity } from '../shared/task-web-target';
import {
  EMBEDDED_CLOSE_RPC_TIMEOUT_MS,
  type CleanupResult,
  type EmbeddedLostNotice,
} from '../shared/embedded-lifecycle';
type Session = {
  child: ChildProcess;
  rpc: Rpc;
  owner?: string;
  ready: Promise<any>;
};
type EmbeddedSession = {
  token: string;
  resourceId?: string;
  owner?: string;
  lastOwner?: string;
  ready: Promise<void>;
  stop: AbortController;
  phase: 'starting' | 'ready' | 'closing' | 'closed' | 'unknown';
  lost?: boolean;
  closing?: Promise<CleanupResult>;
  cleanup?: CleanupResult;
};

function resourceId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}

function abortable<T>(promise: Promise<T>, signals: (AbortSignal | undefined)[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const active = signals.filter((signal): signal is AbortSignal => !!signal);
    const cleanup = () => {
      for (const signal of active) signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(active.find((signal) => signal.aborted)?.reason);
    };
    for (const signal of active) signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
    if (active.some((signal) => signal.aborted)) abort();
  });
}

function combined(results: CleanupResult[]): CleanupResult {
  const errors = results.filter((result) => !result.confirmed).map((result) => result.error);
  const warnings = results.flatMap((result) => result.warnings ?? []);
  return {
    confirmed: errors.length === 0,
    ...(errors.length ? { error: errors.filter(Boolean).join('；') || '资源回收未确认' } : {}),
    ...(warnings.length ? { warnings: [...new Set(warnings)] } : {}),
  };
}
export class Sessions {
  private selectedPages = new Map<string, WebPageIdentity>();
  selectedPage(runId: string) {
    return this.selectedPages.get(runId);
  }
  private sessions = new Map<string, Session>();
  private closing = new Map<string, { session: Session; done: Promise<void> }>();
  private stopping = false;
  private embedded?: EmbeddedSession;
  private embeddedRuns = new Map<string, EmbeddedSession>();
  private embeddedRecoveryError?: string;
  constructor(
    private dir: string,
    private executable: string,
    private dataPath: string,
    private system: (method: string, args: any) => Promise<any> = async () => {
      throw new Error('内置网页需要桌面运行环境');
    },
  ) {}
  get recoveryError() {
    return this.embeddedRecoveryError;
  }
  async use(
    binding: BrowserBinding,
    runId: string,
    command: BrowserCommand,
    signal?: AbortSignal,
    target?: TaskWebTarget,
  ) {
    const check = () => {
      signal?.throwIfAborted();
      if (this.stopping) throw new Error('浏览器会话管理器正在退出');
      if (this.recoveryError) throw new Error(this.recoveryError);
    };
    check();
    if (target && binding.product !== 'embedded')
      throw new Error('所选网页必须使用原内置浏览器绑定');
    if (binding.product === 'embedded') {
      if (this.embedded?.closing) await this.embedded.closing;
      check();
      let session = this.embedded;
      if (session?.owner && session.owner !== runId)
        throw new Error('浏览器会话已被另一个运行占用');
      if (session?.lost) throw new Error('内置网页会话已失效，正在回收');
      if (!session) {
        const token = randomUUID();
        session = {
          token,
          owner: runId,
          lastOwner: runId,
          ready: Promise.resolve(),
          stop: new AbortController(),
          phase: 'starting',
        };
        this.embedded = session;
        this.embeddedRuns.set(runId, session);
        session.ready = this.startEmbedded(session);
      }
      if (session.lastOwner && session.lastOwner !== runId)
        this.embeddedRuns.delete(session.lastOwner);
      session.owner = runId;
      session.lastOwner = runId;
      this.embeddedRuns.set(runId, session);
      try {
        await abortable(session.ready, [signal, session.stop.signal]);
        check();
        if (this.embedded !== session || session.owner !== runId || session.phase !== 'ready')
          throw new Error('浏览器会话租约已失效');
        const expected = target ? (this.selectedPages.get(runId) ?? target.page) : undefined;
        const result = await abortable(
          this.system(expected ? 'browser.embedded.perform.selected' : 'browser.embedded.perform', {
            token: session.token,
            command,
            ...(expected ? { expected } : {}),
          }),
          [signal, session.stop.signal],
        );
        check();
        if (this.embedded !== session || session.owner !== runId || session.lost)
          throw new Error('浏览器会话租约已失效');
        if (expected) {
          if (
            !result?.page ||
            result.page.resourceId !== expected.resourceId ||
            result.page.url !== expected.url ||
            (command.operation !== 'navigate' && !sameWebPage(result.page, expected))
          )
            throw new Error('所选网页在操作期间改变，结果未采用');
          this.selectedPages.set(runId, result.page);
          return result.result;
        }
        return result;
      } catch (error) {
        if (this.ownsEmbedded(session, runId)) await this.closeEmbedded(session);
        throw error;
      }
    }
    // The old process must release its dedicated profile before another run opens it.
    await this.closing.get(binding.id)?.done;
    check();
    let s = this.sessions.get(binding.id);
    if (s?.owner && s.owner !== runId) throw new Error('浏览器会话已被另一个运行占用');
    if (!s) {
      const proc = child(join(this.dir, 'browser.cjs'), this.executable);
      const rpc = new Rpc(
        (m) => proc.send(m),
        async () => {
          throw new Error('会话请求不在白名单');
        },
      );
      proc.on('message', (m) => void rpc.receive(m as any));
      proc.on('error', () => rpc.close());
      s = {
        child: proc,
        rpc,
        owner: runId,
        ready: rpc.call(
          'start',
          {
            binding,
            executable: this.executable,
            appPath: join(this.dir, '..'),
            visible: false,
            profile: join(this.dataPath, 'browser-profiles', binding.id),
          },
          30000,
        ),
      };
      this.sessions.set(binding.id, s);
      const own = s;
      proc.on('exit', () => {
        rpc.close();
        if (this.sessions.get(binding.id) === own) this.sessions.delete(binding.id);
      });
    }
    s.owner = runId;
    try {
      await s.ready;
      check();
      if (this.sessions.get(binding.id) !== s || s.owner !== runId)
        throw new Error('浏览器会话租约已失效');
      return await s.rpc.call('perform', command, (command.timeoutMs ?? 15000) + 5000);
    } catch (e) {
      await this.close(binding.id, s);
      throw e;
    }
  }
  async release(runId: string, destroy = false): Promise<CleanupResult> {
    const results: CleanupResult[] = [];
    const embedded = this.embeddedRuns.get(runId);
    if (embedded && this.ownsEmbedded(embedded, runId)) {
      if (destroy || embedded.lost || embedded.phase !== 'ready')
        results.push(await this.closeEmbedded(embedded));
      else embedded.owner = undefined;
    }
    for (const [id, s] of this.sessions)
      if (s.owner === runId) {
        if (destroy) results.push(await this.cleanup(() => this.close(id, s)));
        else s.owner = undefined;
      }
    if (destroy)
      results.push(
        ...(await Promise.all(
          [...this.closing.values()]
            .filter((c) => c.session.owner === runId)
            .map((c) => this.cleanup(() => c.done)),
        )),
      );
    return combined(results);
  }
  finishRun(runId: string) {
    this.selectedPages.delete(runId);
    const session = this.embeddedRuns.get(runId);
    if (!session || session.phase === 'unknown' || session.phase === 'closing') return;
    this.embeddedRuns.delete(runId);
    if (!session.owner && session.lastOwner === runId) session.lastOwner = undefined;
  }
  private async cleanup(operation: () => Promise<unknown>): Promise<CleanupResult> {
    try {
      await operation();
      return { confirmed: true };
    } catch (error) {
      return { confirmed: false, error: errorText(error) };
    }
  }
  async close(id: string, expected = this.sessions.get(id)) {
    const closing = this.closing.get(id);
    if (closing && (!expected || expected === closing.session)) return closing.done;
    if (!expected || this.sessions.get(id) !== expected) return;
    this.sessions.delete(id);
    const done = (async () => {
      try {
        await expected.rpc.call('close', {}, 2500);
      } catch {}
      await killOwnedTree(expected.child);
      expected.rpc.close();
    })();
    const own = { session: expected, done };
    this.closing.set(id, own);
    try {
      await done;
    } finally {
      if (this.closing.get(id) === own) this.closing.delete(id);
    }
  }
  private ownsEmbedded(session: EmbeddedSession, runId: string) {
    return session.owner === runId || (!session.owner && session.lastOwner === runId);
  }
  private async startEmbedded(session: EmbeddedSession) {
    const receipt = await this.system('browser.embedded.start', { token: session.token });
    if (
      receipt?.state !== 'ready' ||
      receipt.token !== session.token ||
      !resourceId(receipt.resourceId) ||
      (session.resourceId !== undefined && session.resourceId !== receipt.resourceId)
    )
      throw new Error('内置网页启动回执身份无效');
    session.resourceId = receipt.resourceId;
    if (session.phase === 'starting') session.phase = 'ready';
  }
  private closeEmbedded(expected = this.embedded): Promise<CleanupResult> {
    if (!expected) return Promise.resolve({ confirmed: true });
    if (expected.closing) return expected.closing;
    expected.phase = 'closing';
    // Register the shared cleanup before aborting commands, whose catch paths also join it.
    expected.closing = Promise.resolve().then(() => this.confirmEmbeddedClose(expected));
    expected.stop.abort(new Error('网页会话已关闭'));
    return expected.closing;
  }
  private async confirmEmbeddedClose(expected: EmbeddedSession): Promise<CleanupResult> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const receipt = await Promise.race([
        this.system('browser.embedded.close', {
          token: expected.token,
          ...(expected.resourceId ? { resourceId: expected.resourceId } : {}),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('内置网页关闭确认超时')),
            EMBEDDED_CLOSE_RPC_TIMEOUT_MS,
          );
        }),
      ]);
      if (
        receipt?.token !== expected.token ||
        !resourceId(receipt.resourceId) ||
        (expected.resourceId !== undefined && receipt.resourceId !== expected.resourceId)
      )
        throw new Error('内置网页关闭回执身份无效');
      if (receipt.state !== 'closed')
        throw new Error(
          receipt.state === 'unknown' && typeof receipt.error === 'string'
            ? receipt.error
            : '内置网页关闭回执未确认销毁',
        );
      expected.resourceId = receipt.resourceId;
      const warnings = Array.isArray(receipt.warnings)
        ? receipt.warnings.filter((value: unknown): value is string => typeof value === 'string')
        : [];
      expected.cleanup = { confirmed: true, ...(warnings.length ? { warnings } : {}) };
      expected.phase = 'closed';
      if (this.embedded === expected) this.embedded = undefined;
      return expected.cleanup;
    } catch (error) {
      const message = '内置网页回收未确认：' + errorText(error);
      // This gate is synchronous and sticky, including after a late native destruction.
      this.embeddedRecoveryError ??= message;
      expected.phase = 'unknown';
      expected.cleanup = { confirmed: false, error: message };
      return expected.cleanup;
    } finally {
      clearTimeout(timer);
    }
  }
  embeddedLost(notice: EmbeddedLostNotice) {
    const session = this.embedded;
    if (
      !session ||
      !notice.token ||
      notice.token !== session.token ||
      !resourceId(notice.resourceId) ||
      (session.resourceId !== undefined && session.resourceId !== notice.resourceId)
    )
      return;
    session.resourceId = notice.resourceId;
    session.lost = true;
    session.stop.abort(new Error(notice.reason || '内置网页会话意外丢失'));
    const owner = session.owner ?? session.lastOwner;
    // A completed Run may leave a healthy page for reuse without retaining Run
    // ownership. Still obtain its close receipt before another Run can acquire it.
    if (!owner) void this.closeEmbedded(session);
    return owner;
  }
  embeddedVisibility(visible: boolean) {
    if (visible && this.recoveryError) return Promise.reject(new Error(this.recoveryError));
    return this.system('browser.embedded.visibility', { visible });
  }
  embeddedStatus() {
    return this.system('browser.embedded.status', {});
  }
  async shutdown(): Promise<CleanupResult> {
    this.stopping = true;
    const results = await Promise.all([
      this.closeEmbedded(),
      ...[...this.sessions.keys()].map((id) => this.cleanup(() => this.close(id))),
      ...[...this.closing.values()].map((c) => this.cleanup(() => c.done)),
    ]);
    return combined(results);
  }
}
