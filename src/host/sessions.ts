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
  constructor(
    private dir: string,
    private executable: string,
    private dataPath: string,
  ) {}
  async use(binding: BrowserBinding, runId: string, command: BrowserCommand, signal?: AbortSignal) {
    const check = () => {
      signal?.throwIfAborted();
      if (this.stopping) throw new Error('浏览器会话管理器正在退出');
    };
    check();
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
  async shutdown() {
    this.stopping = true;
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
    await Promise.all([...this.closing.values()].map((c) => c.done));
  }
}
