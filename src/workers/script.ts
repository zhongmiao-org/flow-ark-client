import { pathToFileURL } from 'node:url';
import { Rpc } from '../shared/rpc';
import { verifyScriptBundle } from '../adapters/script-bundle';
const abort = new AbortController();
const rpc = new Rpc(
  (m) => process.send?.(m),
  async (method, args) => {
    if (method !== 'execute') throw new Error('未知脚本方法');
    await verifyScriptBundle(args.path, args.sha256);
    const module = await import(pathToFileURL(args.path).href);
    if (typeof module.default !== 'function')
      throw new Error('脚本必须 default export 一个 async 函数');
    const pending: Promise<any>[] = [];
    const result = await module.default({
      input: args.input,
      template: {
        configuration: () => rpc.call('template', { operation: 'configuration' }),
        resource: (path: string) => rpc.call('template', { operation: 'resource', path }),
        validate: (path: string, value: any) =>
          rpc.call('template', { operation: 'validate', path, value }),
        browser: (resourceId: string, command: any) =>
          rpc.call('template', { operation: 'browser', resourceId, command }),
        file: (resourceId: string, request: any) =>
          rpc.call('template', { operation: 'file', resourceId, request }),
        ai: (resourceId: string, request: any) =>
          rpc.call('template', { operation: 'ai', resourceId, request }),
        state: {
          get: () => rpc.call('template', { operation: 'state.get' }),
          set: (value: any) => rpc.call('template', { operation: 'state.set', value }),
        },
        human: (request: any) => rpc.call('template', { operation: 'human', request }, 610000),
        attention: (request: any) => rpc.call('template', { operation: 'attention', request }),
        effect: {
          prepare: (request: any) =>
            rpc.call('template', { operation: 'effect.prepare', request }, 610000),
          resolve: (request: any) => rpc.call('template', { operation: 'effect.resolve', request }),
        },
        result: (value: any) => rpc.call('template', { operation: 'result', value }),
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
  if (m.control === 'cancel') abort.abort();
  else void rpc.receive(m);
});
process.on('disconnect', () => process.exit(1));
