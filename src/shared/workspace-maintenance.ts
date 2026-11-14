import { randomUUID } from 'node:crypto';

// Internal lifecycle admission only. No request arguments or persistent state.
export class WorkspaceMaintenanceGate {
  private pending = new Map<symbol, string>();
  private nonce?: string;
  get held() { return this.nonce !== undefined; }
  get pendingCount() { return this.pending.size; }
  enter(method: string): () => void {
    if (this.held) throw Error('工作区维护中，请等待核对完成');
    const token = Symbol();
    this.pending.set(token, method);
    return () => { this.pending.delete(token); };
  }
  hold(check: () => void): string {
    if (this.held || this.pending.size) throw Error('仍有本地请求正在处理，请完成后再维护工作区');
    check();
    return this.nonce = randomUUID();
  }
  assert(nonce: string, check: () => void) {
    if (!this.nonce || nonce !== this.nonce) throw Error('工作区维护许可无效');
    if (this.pending.size) throw Error('仍有本地请求正在处理');
    check();
  }
  release(nonce: string) {
    this.assert(nonce, () => {});
    this.nonce = undefined;
  }
}
