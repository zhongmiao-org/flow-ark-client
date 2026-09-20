import { uid, redactedErrorText } from './utils';
type Message = {
  rpc?: string;
  method?: string;
  args?: any;
  result?: any;
  error?: string;
  reply?: boolean;
};
export class Rpc {
  private closed = false;
  private pending = new Map<
    string,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  constructor(
    private send: (m: any) => void,
    private handler: (method: string, args: any) => Promise<any>,
    private formatError: (error: unknown) => string = redactedErrorText,
  ) {}
  async receive(m: Message) {
    if (this.closed || !m?.rpc) return;
    if (m.reply) {
      const p = this.pending.get(m.rpc);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(m.rpc);
        m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
      }
      return;
    }
    let reply: Message;
    try {
      reply = { rpc: m.rpc, reply: true, result: await this.handler(m.method!, m.args) };
    } catch (e) {
      reply = {
        rpc: m.rpc,
        reply: true,
        error: this.formatError(e),
      };
    }
    if (!this.closed) {
      try {
        this.send(reply);
      } catch {
        this.close();
      }
    }
  }
  call(method: string, args: any = {}, timeoutMs = 65000): Promise<any> {
    if (this.closed) return Promise.reject(new Error('进程已断开'));
    const id = uid();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(this.formatError(new Error('进程请求超时：' + method))));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ rpc: id, method, args });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  close() {
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('进程已断开'));
    }
    this.pending.clear();
  }
}
