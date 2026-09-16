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
  constructor(
    private dir: string,
    private executable: string,
    private dataPath: string,
  ) {}
  async use(binding: BrowserBinding, runId: string, command: BrowserCommand) {
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
      return await s.rpc.call('perform', command, (command.timeoutMs ?? 15000) + 5000);
    } catch (e) {
      await this.close(binding.id);
      throw e;
    }
  }
  async release(runId: string, destroy = false) {
    for (const [id, s] of this.sessions)
      if (s.owner === runId) {
        if (destroy) await this.close(id);
        else s.owner = undefined;
      }
  }
  async close(id: string) {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    try {
      await s.rpc.call('close', {}, 2500);
    } catch {}
    await killOwnedTree(s.child);
    s.rpc.close();
  }
  async shutdown() {
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
  }
}
