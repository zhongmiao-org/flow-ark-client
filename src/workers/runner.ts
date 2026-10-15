import { randomUUID } from 'node:crypto';
import { Rpc } from '../shared/rpc';
import { execute } from '../core/engine';
import { RunControl } from '../core/run-control';
import { runScript } from '../adapters/script';
import { fileOperation } from '../adapters/files';
import { validateCreatedText } from '../shared/file-create';
import { OUTPUT_BINDING } from '../shared/task-output';
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
      boundary: async (instance, node, signal) => {
        await control!.boundary(
          { nodeInstance: instance, nodeName: String(node.name || node.id) },
          signal,
        );
        if (args.webTarget) await rpc.call('web-target.boundary', {});
        if (args.outputTarget) await rpc.call('output-target.boundary', {});
        signal.throwIfAborted();
      },
      emit,
      human: (message, signal) => control!.human(message, signal),
      perform: async (n: Step, resolved: any, instance: string, signal: AbortSignal) => {
        const timeout = n.timeoutMs ?? 60000;
        signal.throwIfAborted();
        if (args.bindings.template)
          await rpc.call('node.authorize', { id: n.id, binding: resolved.binding });
        if (n.type === 'skill') {
          signal.throwIfAborted();
          return rpc.call(
            'skill.node',
            { nodeId: n.id, nodeInstance: instance, input: resolved },
            timeout + 5000,
          );
        }
        if (n.type === 'document') {
          const invocationId = randomUUID();
          const cancel = () => {
            void rpc.call('document.cancel', { invocationId }).catch(() => {});
          };
          signal.addEventListener('abort', cancel, { once: true });
          try {
            signal.throwIfAborted();
            return await rpc.call(
              'document.extract',
              { nodeId: n.id, nodeInstance: instance, invocationId, file: resolved.file },
              Math.min(timeout, 30000) + 6000,
            );
          } catch (e) {
            cancel();
            throw e;
          } finally {
            signal.removeEventListener('abort', cancel);
          }
        }
        if (n.type === 'conversation')
          return await rpc.call('conversation.open', {
            nodeId: n.id,
            input: resolved.input,
            key: resolved.key,
          });
        if (n.type === 'ai') {
          const invocationId = randomUUID();
          const cancel = () => {
            void rpc.call('ai.cancel', { invocationId }).catch(() => {});
          };
          signal.addEventListener('abort', cancel, { once: true });
          try {
            signal.throwIfAborted();
            return await rpc.call(
              'ai.call',
              { nodeId: n.id, nodeInstance: instance, invocationId, input: resolved.input },
              timeout + 10000,
            );
          } finally {
            signal.removeEventListener('abort', cancel);
          }
        }
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
        if (args.outputTarget && n.type === 'file' && n.binding === OUTPUT_BINDING)
          validateCreatedText(resolved.content);
        if (n.type === 'file' || n.type === 'excel')
          return fileOperation(
            resolved,
            args.bindings,
            (path) => {
              signal.throwIfAborted();
              return rpc.call('artifact.register', { path });
            },
            signal,
          );
        if (n.type === 'browser') return rpc.call('browser', resolved, timeout + 5000);
        if (n.type === 'mcp') {
          const cancel = () => {
            void rpc.call('mcp.cancel', { nodeInstance: instance }, 65000).catch(() => {});
          };
          signal.addEventListener('abort', cancel, { once: true });
          try {
            signal.throwIfAborted();
            return await rpc.call(
              'mcp.call',
              { nodeId: n.id, nodeInstance: instance, arguments: resolved.arguments },
              timeout + 10000,
            );
          } finally {
            signal.removeEventListener('abort', cancel);
          }
        }
        if (n.type === 'desktop')
          return rpc.call(
            'desktop.replace',
            { nodeId: n.id, nodeInstance: instance },
            timeout + 10000,
          );
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
