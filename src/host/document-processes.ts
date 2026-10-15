import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, sep } from 'node:path';
import { fork } from 'node:child_process';
import { killOwnedTree } from './processes';
import {
  documentName,
  assertDocumentResult,
  DOCUMENT_BYTES,
  type DocumentNode,
  type DocumentResult,
} from '../shared/document';
import type { CleanupResult } from '../shared/embedded-lifecycle';
const textExtensions = ['txt', 'md', 'csv', 'tsv', 'json', 'log', 'yaml', 'yml', 'xml'];
type Call = { abort: AbortController; done?: Promise<DocumentResult>; identity?: string };
export class DocumentProcesses {
  recoveryError?: string;
  private calls = new Map<string, Map<string, Call>>();
  constructor(
    private dir: string,
    private executable: string,
  ) {}
  private call(run: string, invocation: string) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(invocation)) throw new Error('资料解析身份无效');
    let entries = this.calls.get(run);
    if (!entries) this.calls.set(run, (entries = new Map()));
    let call = entries.get(invocation);
    if (!call) {
      if (entries.size >= 10000) throw new Error('资料解析调用超限');
      entries.set(invocation, (call = { abort: new AbortController() }));
    }
    return call;
  }
  cancel(run: string, invocation: string) {
    this.call(run, invocation).abort.abort(new Error('资料解析已取消'));
  }
  extract(
    run: string,
    invocation: string,
    node: DocumentNode,
    root: string,
    name: unknown,
    signal: AbortSignal,
    check: () => void,
  ) {
    if (this.recoveryError) throw new Error(this.recoveryError);
    documentName(name);
    const call = this.call(run, invocation);
    const identity = `${node.id}\0${node.binding}\0${name}`;
    if (call.identity && call.identity !== identity)
      throw new Error('资料请求身份已经使用，不能更换来源');
    call.identity = identity;
    call.done ??= this.perform(
      node,
      root,
      name,
      AbortSignal.any([
        signal,
        call.abort.signal,
        AbortSignal.timeout(Math.min(30000, node.timeoutMs ?? 60000)),
      ]),
      check,
    );
    return call.done;
  }
  private async perform(
    node: DocumentNode,
    root: string,
    name: unknown,
    signal: AbortSignal,
    check: () => void,
  ): Promise<DocumentResult> {
    const valid = () => {
      if (signal.aborted && signal.reason?.name === 'TimeoutError')
        throw new Error('资料解析超过期限，未采用部分输出');
      signal.throwIfAborted();
      check();
    };
    const started = performance.now();
    valid();
    documentName(name);
    const ext = extname(name).slice(1).toLowerCase();
    const format =
      ext === 'pdf'
        ? 'pdf'
        : ext === 'docx'
          ? 'docx'
          : textExtensions.includes(ext)
            ? 'text'
            : undefined;
    if (!format) throw new Error('资料格式不支持，请选择PDF、DOCX或UTF-8文本');
    let bytes: Buffer;
    try {
      const base = await realpath(root),
        target = join(base, name),
        parent = await realpath(join(target, '..'));
      const directoryIdentity = await stat(base, { bigint: true });
      if (parent !== base && !parent.startsWith(base + sep))
        throw new Error('资料路径超出已绑定目录');
      valid();
      const handle = await open(
        join(parent, name.split('/').at(-1)!),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || before.size > BigInt(DOCUMENT_BYTES))
          throw new Error('资料必须是8MiB以内的普通文件');
        bytes = Buffer.alloc(Number(before.size) + 1);
        let size = 0;
        while (size < bytes.length) {
          valid();
          const r = await handle.read(bytes, size, bytes.length - size, size);
          if (!r.bytesRead) break;
          size += r.bytesRead;
        }
        const after = await handle.stat({ bigint: true });
        const currentPath = await realpath(target);
        const currentFile = await stat(currentPath, { bigint: true });
        const currentDirectory = await stat(base, { bigint: true });
        valid();
        if (
          !currentPath.startsWith(base + sep) ||
          (await realpath(root)) !== base ||
          currentFile.dev !== before.dev ||
          currentFile.ino !== before.ino ||
          currentDirectory.dev !== directoryIdentity.dev ||
          currentDirectory.ino !== directoryIdentity.ino ||
          size !== Number(before.size) ||
          ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(
            (k) => (before as any)[k] !== (after as any)[k],
          )
        )
          throw new Error('读取期间资料已变化，请重新核对');
        bytes = bytes.subarray(0, size);
      } finally {
        await handle.close();
      }
    } catch (e) {
      valid();
      if ((e as NodeJS.ErrnoException).code)
        throw new Error('资料不可读取，请核对目录、普通文件、链接与访问权限');
      throw e;
    }
    valid();
    const remaining = Math.floor(
      Math.min(30000, node.timeoutMs ?? 60000) - (performance.now() - started),
    );
    if (remaining < 1) throw new Error('资料解析超过期限');
    const proc = fork(join(this.dir, 'document-supervisor.cjs'), [], {
      execPath: this.executable,
      execArgv: [],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      detached: true,
    });
    let timer: NodeJS.Timeout | undefined;
    let reply: any,
      cancelled = false;
    const cancel = () => {
      cancelled = true;
      try {
        if (proc.connected) proc.send({ cancel: true }, () => {});
      } catch {}
      timer ??= setTimeout(() => {
        void killOwnedTree(proc);
      }, 1500);
    };
    try {
      await new Promise<void>((resolve, reject) => {
        proc.on('message', (message) => {
          if (reply === undefined) reply = message;
        });
        proc.once('error', () => reject(new Error('资料解析监护进程无法启动')));
        proc.once('exit', (code) =>
          code === 0 || reply !== undefined || cancelled
            ? resolve()
            : reject(new Error('资料解析监护异常退出')),
        );
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
        else
          proc.send({ format, data: bytes.toString('base64'), timeoutMs: remaining }, (e) => {
            if (e) reject(new Error('资料解析连接失败'));
          });
      });
      valid();
      if (!reply || typeof reply !== 'object' || reply.error || !reply.result)
        throw new Error(
          typeof reply?.error === 'string' ? reply.error.slice(0, 600) : '资料解析没有返回完整结果',
        );
      const result = {
        ...reply.result,
        version: 1,
        source: {
          binding: node.binding,
          name,
          format,
          byteLength: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      };
      assertDocumentResult(result);
      valid();
      return result;
    } finally {
      signal.removeEventListener('abort', cancel);
      clearTimeout(timer);
      await killOwnedTree(proc);
      if (proc.pid && proc.exitCode === null && proc.signalCode === null) {
        this.recoveryError = '资料解析进程回收未确认，请保留记录并重启后核对';
        throw new Error(this.recoveryError);
      }
    }
  }
  async release(run: string): Promise<CleanupResult> {
    const entries = this.calls.get(run);
    if (!entries)
      return this.recoveryError
        ? { confirmed: false, error: this.recoveryError }
        : { confirmed: true };
    for (const call of entries.values()) call.abort.abort(new Error('运行已结束'));
    let timer: NodeJS.Timeout;
    const completed = await Promise.race([
      Promise.allSettled([...entries.values()].map((c) => c.done)).then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), 3500);
      }),
    ]);
    clearTimeout(timer!);
    if (completed) this.calls.delete(run);
    if (!completed) this.recoveryError = '资料解析回收尚未确认，请保留记录并重启后核对';
    return completed && !this.recoveryError
      ? { confirmed: true }
      : { confirmed: false, error: this.recoveryError };
  }
}
