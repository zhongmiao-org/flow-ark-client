import { Rpc } from '../shared/rpc';
import { execute } from '../core/engine';
import { runScript } from '../adapters/script';
import { fileOperation } from '../adapters/files';
import { runRecruitingBatch } from '../recruiting/batch';
import { dirname } from 'node:path';
import type { Step } from '../shared/types';
const abort = new AbortController();
let paused = false;
let waiting: (() => void) | undefined;
const rpc = new Rpc(
  (m) => process.send?.(m),
  async (method, args) => {
    if (method !== 'execute') throw new Error('未知 Worker 方法');
    const emit = async (type: string, nodeInstance: string, data: any) =>
      rpc.call('event', { type, nodeInstance, data });
    return execute(args.flow, args.parameters, {
      signal: abort.signal,
      boundary: async () => {
        if (paused) {
          await rpc.call('state', { state: 'PAUSED' });
          await new Promise<void>((resolve, reject) => {
            waiting = resolve;
            abort.signal.addEventListener('abort', () => reject(abort.signal.reason), {
              once: true,
            });
          });
          abort.signal.throwIfAborted();
          await rpc.call('state', { state: 'RUNNING' });
        }
      },
      emit,
      human: async (message) => {
        await rpc.call('state', { state: 'WAITING_INPUT', message });
        await new Promise<void>((resolve, reject) => {
          waiting = resolve;
          abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true });
        });
        abort.signal.throwIfAborted();
        await rpc.call('state', { state: 'RUNNING' });
        return { confirmed: true };
      },
      perform: async (n: Step, resolved: any, instance: string) => {
        const timeout = n.timeoutMs ?? 60000;
        const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(timeout)]);
        const work = async () => {
          if (n.type === 'http') {
            const u = new URL(resolved.url);
            if (!['http:', 'https:'].includes(u.protocol))
              throw new Error('HTTP 节点仅支持 HTTP(S)');
            const response = await fetch(u, {
              method: n.method,
              headers: resolved.headers,
              body:
                n.method === 'GET'
                  ? undefined
                  : typeof resolved.body === 'string'
                    ? resolved.body
                    : JSON.stringify(resolved.body),
              signal,
              redirect: 'error',
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const text = await response.text();
            if (text.length > 10 * 1024 * 1024) throw new Error('HTTP 响应超过上限');
            try {
              return JSON.parse(text);
            } catch {
              return text;
            }
          }
          if (n.type === 'file' || n.type === 'excel')
            return fileOperation(resolved, args.bindings, (path) =>
              rpc.call('artifact.register', { path }),
            );
          if (n.type === 'browser') return rpc.call('browser', resolved, timeout + 5000);
          if (n.type === 'script')
            return runScript({
              compiled: args.scripts[n.id],
              input: resolved.input,
              dir: dirname(process.argv[1]),
              executable: args.executable,
              signal,
              call: async (method, value) => {
                if (method === 'log' || method === 'progress') {
                  await emit(method === 'log' ? 'log' : 'progress', instance, value);
                  return true;
                }
                if (method === 'artifact') return rpc.call('artifact.create', value);
                if (method === 'credential') return rpc.call('credential', value);
                throw new Error('脚本能力不在白名单');
              },
            });
          if (n.type === 'recruiting')
            return runRecruitingBatch(
              n.platform,
              n.batchLimit,
              { request: (m, a) => rpc.call(m, a, 65000) },
              signal,
            );
          throw new Error('节点不支持');
        };
        let timer: NodeJS.Timeout | undefined;
        try {
          return await Promise.race([
            work(),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error('节点超时：' + n.id)), timeout);
              signal.addEventListener('abort', () => reject(new Error('节点已取消或超时')), {
                once: true,
              });
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      },
    });
  },
);
process.on('message', (m: any) => {
  if (m.control === 'cancel') {
    abort.abort(new Error('用户取消'));
    waiting?.();
  } else if (m.control === 'pause') paused = true;
  else if (m.control === 'resume') {
    paused = false;
    waiting?.();
    waiting = undefined;
  } else void rpc.receive(m);
});
process.on('disconnect', () => {
  rpc.close();
  abort.abort(new Error('运行宿主已断开'));
  // Allow the script adapter to terminate its owned child before leaving.
  setTimeout(() => process.exit(1), 1800).unref();
});
