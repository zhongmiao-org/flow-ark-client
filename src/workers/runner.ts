import { Rpc } from '../shared/rpc';
import { execute } from '../core/engine';
import { RunControl } from '../core/run-control';
import { runScript } from '../adapters/script';
import { fileOperation } from '../adapters/files';
import type { Step } from '../shared/types';
import {
  SCRIPT_CLEANUP_TIMEOUT_MS,
  SCRIPT_EXECUTE_RPC_TIMEOUT_MS,
} from '../shared/script-supervision';
const abort = new AbortController();
let control: RunControl | undefined;
let pendingPause = false;
const rpc = new Rpc(
  (m) => process.send?.(m),
  async (method, args) => {
    if (method !== 'execute') throw new Error('未知 Worker 方法');
    const emit = async (type: string, nodeInstance: string, data: any) =>
      rpc.call('event', { type, nodeInstance, data });
    control = new RunControl(Boolean(args.debug), abort.signal, (state, data) =>
      rpc.call('state', { state, ...data }),
    );
    if (pendingPause) control.control('pause');
    return execute(args.flow, args.parameters, {
      signal: abort.signal,
      captureResults: Boolean(args.debug),
      boundary: (instance, node, signal) =>
        control!.boundary(
          { nodeInstance: instance, nodeName: String(node.name || node.id) },
          signal,
        ),
      emit,
      human: (message, signal) => control!.human(message, signal),
      perform: async (n: Step, resolved: any, instance: string, signal: AbortSignal) => {
        const timeout = n.timeoutMs ?? 60000;
        signal.throwIfAborted();
        if (args.bindings.template)
          await rpc.call('node.authorize', { id: n.id, binding: resolved.binding });
        if (n.type === 'http') {
          const u = new URL(resolved.url);
          if (!['http:', 'https:'].includes(u.protocol)) throw new Error('HTTP 节点仅支持 HTTP(S)');
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
          return fileOperation(resolved, args.bindings, (path) => {
            signal.throwIfAborted();
            return rpc.call('artifact.register', { path });
          });
        if (n.type === 'browser') return rpc.call('browser', resolved, timeout + 5000);
        if (n.type === 'script')
          return runScript({
            nodeId: n.id,
            nodeInstance: instance,
            input: resolved.input,
            signal,
            call: (method, value) =>
              rpc.call(
                method,
                value,
                method === 'script.execute'
                  ? SCRIPT_EXECUTE_RPC_TIMEOUT_MS
                  : SCRIPT_CLEANUP_TIMEOUT_MS + 1000,
              ),
          });
        throw new Error('节点不支持');
      },
    });
  },
);
process.on('message', (m: any) => {
  if (m.control === 'cancel') {
    abort.abort(new Error('用户取消'));
  } else if (['pause', 'resume', 'step'].includes(m.control)) {
    if (m.control === 'pause' && !control) pendingPause = true;
    control?.control(m.control);
  } else void rpc.receive(m);
});
process.on('disconnect', () => {
  rpc.close();
  abort.abort(new Error('运行宿主已断开'));
  // Script supervisors belong to Host and receive EOF independently of this Worker.
  setTimeout(() => process.exit(1), 1800).unref();
});
