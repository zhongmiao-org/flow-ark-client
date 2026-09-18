import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { child, killOwnedTree } from './processes';
import { Rpc } from '../shared/rpc';
import type { BrowserBinding, BrowserCommand } from '../shared/types';
type Session = {
  child: ChildProcess;
  rpc: Rpc;
  owner?: string;
  ready: Promise<any>;
};
export class Sessions {
  private sessions = new Map<string, Session>();
  private closing = new Map<string, { session: Session; done: Promise<void> }>();
  private stopping = false;
  private embedded?: { token: string; owner?: string; ready: Promise<any> };
  private embeddedClosing: Promise<any> = Promise.resolve();
  constructor(
    private dir: string,
    private executable: string,
    private dataPath: string,
    private system: (method: string, args: any) => Promise<any> = async () => {
      throw new Error('内置网页需要桌面运行环境');
    },
  ) {}
  async use(binding: BrowserBinding, runId: string, command: BrowserCommand, signal?: AbortSignal) {
    const check = () => {
      signal?.throwIfAborted();
      if (this.stopping) throw new Error('浏览器会话管理器正在退出');
    };
    check();
    if (binding.product === 'embedded') {
      await this.embeddedClosing;
      check();
      let session = this.embedded;
      if (session?.owner && session.owner !== runId)
        throw new Error('浏览器会话已被另一个运行占用');
      if (!session) {
        const token = randomUUID();
        session = { token, owner: runId, ready: this.system('browser.embedded.start', { token }) };
        this.embedded = session;
      }
      session.owner = runId;
      try {
        await session.ready;
        check();
        if (this.embedded !== session) throw new Error('浏览器会话租约已失效');
        return await this.system('browser.embedded.perform', { token: session.token, command });
      } catch (error) {
        await this.closeEmbedded(session);
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
  async release(runId: string, destroy = false) {
    if (this.embedded?.owner === runId) {
      if (destroy) await this.closeEmbedded(this.embedded);
      else this.embedded.owner = undefined;
    }
    for (const [id, s] of this.sessions)
      if (s.owner === runId) {
        if (destroy) await this.close(id, s);
        else s.owner = undefined;
      }
    if (destroy)
      await Promise.all(
        [...this.closing.values()].filter((c) => c.session.owner === runId).map((c) => c.done),
      );
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
  private async closeEmbedded(expected = this.embedded) {
    if (!expected || this.embedded !== expected) return this.embeddedClosing;
    this.embedded = undefined;
    this.embeddedClosing = expected.ready
      .catch(() => {})
      .then(() => this.system('browser.embedded.close', { token: expected.token }))
      .catch(() => {});
    return this.embeddedClosing;
  }
  embeddedLost(token?: string) {
    if (!token || this.embedded?.token !== token) return;
    const owner = this.embedded.owner;
    this.embedded = undefined;
    return owner;
  }
  embeddedVisibility(visible: boolean) {
    return this.system('browser.embedded.visibility', { visible });
  }
  embeddedStatus() {
    return this.system('browser.embedded.status', {});
  }
  async shutdown() {
    this.stopping = true;
    await this.closeEmbedded();
    await this.system('browser.embedded.close', {}).catch(() => {});
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
    await Promise.all([...this.closing.values()].map((c) => c.done));
  }
}
