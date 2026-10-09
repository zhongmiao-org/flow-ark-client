import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import {
  ReadBuffer,
  serializeMessage,
  type JSONRPCMessage,
  type Transport,
} from '@modelcontextprotocol/client';

// Own the process explicitly. The SDK's base stdio transport creates a second
// probe process even in pinned modern mode; this transport never does so.
export class McpStdio implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private child?: ChildProcessWithoutNullStreams;
  private buffer = new ReadBuffer({ maxBufferSize: 2 * 1024 * 1024 });
  private started = false;
  private closed = false;
  private closing?: Promise<void>;
  constructor(
    private command: string,
    private args: string[],
  ) {}
  get pid() {
    return this.child?.pid;
  }
  get stderr() {
    return null;
  }
  async start() {
    if (this.started) throw new Error('连接程序已经启动');
    this.started = true;
    await access(this.command, constants.X_OK);
    if (!(await stat(this.command)).isFile()) throw new Error('请选择可执行的普通文件');
    if (this.closed) throw new Error('连接已取消');
    const child = (this.child = spawn(this.command, this.args, {
      shell: false,
      detached: process.platform !== 'win32',
      cwd: dirname(this.command),
      env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
    }));
    // Drain without retaining or logging third-party stderr.
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk) => {
      try {
        this.buffer.append(chunk);
        let message: JSONRPCMessage | null;
        while ((message = this.buffer.readMessage()) !== null) this.onmessage?.(message);
      } catch {
        this.onerror?.(new Error('MCP 程序返回无效或过大的消息'));
        void this.close().catch(() => {});
      }
    });
    child.on('exit', () => {
      this.onclose?.();
    });
    child.on('error', () => {
      this.onerror?.(new Error('MCP 程序无法启动或已失效'));
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', () => reject(new Error('MCP 程序无法启动')));
    });
  }
  async send(message: JSONRPCMessage) {
    if (!this.child || this.closed) throw new Error('MCP 程序未连接');
    await new Promise<void>((resolve, reject) => {
      this.child!.stdin.write(serializeMessage(message), (error) =>
        error ? reject(new Error('MCP 程序通信已断开')) : resolve(),
      );
    });
  }
  close(): Promise<void> {
    return (this.closing ??= this.stop());
  }
  private async stop() {
    this.closed = true;
    const child = this.child;
    if (!child?.pid) return;
    child.stdin.end();
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        const done = () => {
          clearTimeout(timer);
          child.off('exit', done);
          resolve();
        };
        const timer = setTimeout(done, ms);
        child.once('exit', done);
      });
    await wait(250);
    // A dedicated process group belongs exclusively to this launch, including
    // helpers that retain pipes after their parent exits.
    try {
      process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM');
    } catch (e: any) {
      if (e.code !== 'ESRCH') throw new Error('MCP 程序回收失败');
    }
    await wait(500);
    try {
      process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL');
    } catch (e: any) {
      if (e.code !== 'ESRCH') throw new Error('MCP 程序回收失败');
    }
    await wait(1500);
    child.stdout.destroy();
    child.stderr.destroy();
    if (child.exitCode === null && child.signalCode === null)
      throw new Error('无法确认 MCP 程序已经退出');
  }
}
