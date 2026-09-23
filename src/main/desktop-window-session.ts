import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Rpc } from '../shared/rpc';

const reply = z
  .object({ rpc: z.string().uuid(), reply: z.literal(true), result: z.unknown() })
  .strict();
export class DesktopWindowSession {
  readonly id = randomUUID();
  readonly expiresAt = Date.now() + 5 * 60 * 1000;
  readonly windows = new Map<string, string>();
  readonly titles = new Map<string, string>();
  private exited = false;
  closed = false;
  private child: ChildProcessWithoutNullStreams;
  private rpc: Rpc;
  private timer: NodeJS.Timeout;
  constructor(
    executable: string,
    private readonly closedCallback: () => void = () => {},
  ) {
    this.child = spawn(executable, [], { stdio: 'pipe' });
    this.rpc = new Rpc(
      (message) => {
        if (this.closed) throw new Error('窗口会话已关闭');
        this.child.stdin.write(JSON.stringify(message) + '\n');
      },
      async () => {
        throw new Error('不支持原生主动请求');
      },
      () => '窗口读取未完成',
    );
    this.timer = setTimeout(() => this.stop(), 5 * 60 * 1000);
    this.timer.unref();
    this.child.on('error', () => {
      this.exited = !this.child.pid;
      this.stop();
    });
    this.child.on('exit', () => {
      this.exited = true;
      this.stop();
    });
    this.child.stdin.on('error', () => this.stop());
    this.child.stderr.resume();
    let buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      if (this.closed) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 256 * 1024) return this.stop();
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          void this.rpc.receive(reply.parse(JSON.parse(line))).catch(() => this.stop());
        } catch {
          this.stop();
          return;
        }
      }
    });
  }
  async call(
    method: 'list' | 'preview' | 'inspect' | 'bind' | 'verify' | 'replace',
    args: {
      windowId?: string;
      bindingId?: string;
      text?: string;
      replacement?: string;
      range?: { location: number; length: number };
    } = {},
  ) {
    if (this.closed || Date.now() >= this.expiresAt) throw new Error('窗口会话已失效');
    try {
      return await this.rpc.call(method, args, 8000);
    } catch (error) {
      this.stop();
      throw error;
    }
  }
  async stopConfirmed() {
    this.stop();
    if (this.exited) return true;
    return new Promise<boolean>((resolve) => {
      const finished = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.child.off('exit', finished);
        resolve(this.exited);
      }, 2000);
      this.child.once('exit', finished);
      if (this.exited) {
        this.child.off('exit', finished);
        finished();
      }
    });
  }
  stop() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.windows.clear();
    this.titles.clear();
    this.rpc.close();
    this.child.kill('SIGKILL');
    this.closedCallback();
  }
}
