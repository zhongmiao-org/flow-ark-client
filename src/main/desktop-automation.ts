import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Rpc } from '../shared/rpc';
import { desktopSdkRequest, desktopDiscovery, desktopObservation } from '../shared/desktop-automation';
import { z } from 'zod';
class NativeNotExecuted extends Error {}
const bindingSchema = z.object({ bindingId: z.string().uuid(), application: z.string().max(1024), title: z.string().max(4000), expiresAt: z.number().finite() }).strict();
/** Main-owned native process. Renderer can select a window; only an active host Run can act. */
export class DesktopAutomation {
  private child?: ChildProcessWithoutNullStreams;
  private rpc?: Rpc;
  private binding?: z.infer<typeof bindingSchema> & { scopeId: string; screenshotAllowed: boolean; actionsAllowed: boolean };
  private staging?: { token: symbol; scopeId: string; bindingId?: string };
  private bindingReady = false;
  private owner?: string;
  private busy = false;
  private expiry?: NodeJS.Timeout;
  constructor(private executable: string) {}
  stop() {
    clearTimeout(this.expiry); this.binding = undefined; this.staging = undefined; this.bindingReady = false; this.owner = undefined;
    this.rpc?.close(); this.rpc = undefined; this.child?.kill(); this.child = undefined;
  }
  private async call(method: string, args: unknown = {}): Promise<any> {
    if (process.platform !== 'darwin') throw Error('桌面操作当前仅支持 macOS');
    if (!this.rpc) {
      const child = this.child = spawn(this.executable, [], { stdio: 'pipe', env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' } });
      const rpc = this.rpc = new Rpc(message => { if (!child.stdin.write(JSON.stringify(message) + '\n')) { /* pipe backpressure is bounded by one request */ } }, async () => { throw Error('原生助手不能主动调用宿主'); });
      let buffer = ''; child.stdout.setEncoding('utf8'); child.stderr.resume();
      const stop = () => { if (this.child === child) this.stop(); };
      child.on('error', stop); child.on('exit', stop); child.stdin.on('error', stop);
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk; if (Buffer.byteLength(buffer) > 12 * 1024 * 1024) { stop(); return; }
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          try { const value = JSON.parse(line); if (value.reply !== true || typeof value.rpc !== 'string') throw Error(); void rpc.receive(value); }
          catch { stop(); return; }
        }
      });
    }
    const rpc = this.rpc, child = this.child;
    try {
      const result = await rpc.call(method, args, 15000);
      if (result?.error) throw new NativeNotExecuted('桌面操作未执行：' + String(result.error));
      return result;
    } catch (error) { if (this.rpc === rpc && this.child === child) this.stop(); throw error; }
  }
  permission(permission: string) { if (this.owner || this.busy || this.staging) throw Error('请先结束桌面运行或绑定准备'); return this.call('permissions', { request: permission }); }
  state(scopeId: string) {
    if (this.binding && this.binding.expiresAt <= Date.now()) this.stop();
    return this.bindingReady && !this.staging && this.binding?.scopeId === scopeId ? { ...this.binding, active: !!this.owner } : null;
  }
  async list() { if (this.owner || this.busy || this.staging) throw Error('桌面运行或绑定准备中不能重新发现或切换窗口'); this.stop(); return desktopDiscovery.parse(await this.call('list')); }
  async bind(args: { scopeId: string; windowId: string; screenshotAllowed: boolean; actionsAllowed: boolean; durationMs: number }) {
    if (this.owner || this.busy || this.staging) throw Error('桌面运行或绑定准备中不能更换绑定');
    const attempt = { token: Symbol(), scopeId: args.scopeId } as { token: symbol; scopeId: string; bindingId?: string };
    this.staging = attempt; this.bindingReady = false; this.binding = undefined; clearTimeout(this.expiry);
    try {
      const bound = bindingSchema.parse(await this.call('bind', { windowId: args.windowId, durationMs: args.durationMs }));
      if (this.staging?.token !== attempt.token) throw Error('本次窗口绑定准备已失效');
      attempt.bindingId = bound.bindingId;
      this.binding = { ...bound, scopeId: args.scopeId, screenshotAllowed: args.screenshotAllowed, actionsAllowed: args.actionsAllowed };
      this.expiry = setTimeout(() => { if (this.staging?.token === attempt.token || this.binding?.bindingId === bound.bindingId) this.stop(); }, Math.max(0, bound.expiresAt - Date.now())); this.expiry.unref();
      return { ...this.binding, active: false };
    } catch (error) { if (this.staging?.token === attempt.token) this.stop(); throw error; }
  }
  commitBinding(scopeId: string, bindingId: string) {
    if (this.staging?.scopeId !== scopeId || this.staging.bindingId !== bindingId || this.binding?.scopeId !== scopeId || this.binding.bindingId !== bindingId)
      throw Error('本次窗口绑定准备已失效');
    if (this.binding.expiresAt <= Date.now()) { this.stop(); throw Error('本次窗口绑定已过期'); }
    this.staging = undefined; this.bindingReady = true;
    const ready = this.state(scopeId); if (!ready) throw Error('本次窗口绑定未就绪'); return ready;
  }
  release(scopeId: string, bindingId?: string) { if ((this.binding?.scopeId !== scopeId && this.staging?.scopeId !== scopeId) || (bindingId !== undefined && this.binding?.bindingId !== bindingId)) return false; if (this.owner) throw Error('请先取消桌面运行'); this.stop(); return true; }
  finish(runId: string) { if (this.owner === runId) this.stop(); return { confirmed: true }; }
  async command(scopeId: string, runId: string, raw: unknown, actionId?: string) {
    const request = desktopSdkRequest.parse(raw);
    if (request.operation === 'decide') throw Error('模型调用仅由宿主处理');
    const binding = this.state(scopeId);
    if (!binding) throw Error('请在客户端为本实例重新绑定目标窗口');
    if (this.busy || (this.owner && this.owner !== runId)) throw Error('桌面已被另一运行占用');
    if (request.operation === 'act' && !binding.actionsAllowed) throw Error('本次绑定未允许桌面动作');
    if (request.operation === 'observe' && request.screenshot && !binding.screenshotAllowed) throw Error('本次绑定未允许读取窗口截图');
    this.owner = runId; this.busy = true;
    try {
      if (request.operation === 'readSelection') return z.object({ version: z.literal(1), text: z.string().max(256*1024), source: z.literal('bound-window-selection') }).strict().parse(await this.call('readSelection', { bindingId: binding.bindingId, observationId: request.observationId }));
      const result = request.operation === 'observe'
        ? desktopObservation.parse(await this.call('observe', { bindingId: binding.bindingId, screenshot: request.screenshot }))
        : await this.call('act', { bindingId: binding.bindingId, observationId: request.observationId, actionId, command: request.command });
      if (request.operation === 'act' && result?.status !== 'performed') this.stop();
      return result;
    } catch (error) {
      if (request.operation === 'act') return { status: error instanceof NativeNotExecuted ? 'not-executed' : 'unknown', reason: error instanceof NativeNotExecuted ? error.message : 'native-reply-lost' };
      throw error;
    } finally { this.busy = false; }
  }
}
