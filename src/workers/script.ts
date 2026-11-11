import { pathToFileURL } from 'node:url';
import { readTableRange } from './desktop-table-range';
import { Rpc } from '../shared/rpc';
import { verifyScriptBundle } from '../adapters/script-bundle';
const abort = new AbortController();
// Match the existing supervisor total bound; chained human confirmations do not reset it.
const TEMPLATE_RPC_TIMEOUT_MS = 610000;
const templateCall = (request: any, timeoutMs = TEMPLATE_RPC_TIMEOUT_MS) => rpc.call('template', request, timeoutMs);
const rpc = new Rpc(
  (m) => process.send?.(m),
  async (method, args) => {
    if (method !== 'execute') throw new Error('未知脚本方法');
    await verifyScriptBundle(args.path, args.sha256);
    const module = await import(pathToFileURL(args.path).href);
    if (typeof module.default !== 'function')
      throw new Error('脚本必须 default export 一个 async 函数');
    const pending: Promise<any>[] = [];
    const desktop = {
      readSelection: (request: any) => templateCall({ operation: 'desktop', request: { operation: 'readSelection', ...request } }),
      decide: (request: any) => templateCall({ operation: 'desktop', request: { operation: 'decide', ...request } }, 130000),
      observe: (options: any = {}) => templateCall({ operation: 'desktop', request: { operation: 'observe', ...options } }),
      act: (request: any) => templateCall({ operation: 'desktop', request: { operation: 'act', ...request } }),
    };
    const result = await module.default({
      input: args.input,
      desktop: {...desktop, readTableRange: (request: any) => readTableRange(desktop,request,abort.signal)},
      template: {
        configuration: () => templateCall({ operation: 'configuration' }),
        resource: (path: string) => templateCall({ operation: 'resource', path }),
        validate: (path: string, value: any) =>
          templateCall({ operation: 'validate', path, value }),
        browser: (resourceId: string, command: any) =>
          templateCall({ operation: 'browser', resourceId, command }),
        file: (resourceId: string, request: any) =>
          templateCall({ operation: 'file', resourceId, request }),
        ai: (resourceId: string, request: any) =>
          templateCall({ operation: 'ai', resourceId, request }),
        state: {
          get: () => templateCall({ operation: 'state.get' }),
          set: (value: any) => templateCall({ operation: 'state.set', value }),
        },
        human: (request: any) => templateCall({ operation: 'human', request }, 610000),
        attention: (request: any) => templateCall({ operation: 'attention', request }),
        effect: {
          prepare: (request: any) =>
            templateCall({ operation: 'effect.prepare', request }, 610000),
          resolve: (request: any) => templateCall({ operation: 'effect.resolve', request }),
        },
        result: (value: any) => templateCall({ operation: 'result', value }),
      },
      signal: abort.signal,
      logger: {
        info: (value: any) => {
          pending.push(rpc.call('log', { value }));
        },
      },
      progress: (completed: number, total?: number) => {
        pending.push(rpc.call('progress', { completed, total }));
      },
      artifact: (name: string, content: string) => rpc.call('artifact', { name, content }),
      credential: (id: string) => rpc.call('credential', { id }),
    });
    await Promise.all(pending);
    return result ?? null;
  },
);
process.on('message', (m: any) => {
  if (m.control === 'cancel') { abort.abort(); rpc.close(); }
  else void rpc.receive(m);
});
process.on('disconnect', () => process.exit(1));
