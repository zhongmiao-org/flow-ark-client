import { Runtime } from './runtime';
import { Rpc } from '../shared/rpc';
import { redactedErrorText } from '../shared/utils';
import { dirname } from 'node:path';
import { EMBEDDED_CLOSE_RPC_TIMEOUT_MS } from '../shared/embedded-lifecycle';
const port = (process as any).parentPort;
let runtime: Runtime | undefined;
const send = (m: any) => (port ? port.postMessage(m) : process.send?.(m));
const rpc = new Rpc(
  send,
  async (method, args) => {
    if (method === 'init') {
      if (runtime) throw new Error('宿主已初始化');
      runtime = new Runtime(
        args.dataPath,
        dirname(process.argv[1]),
        args.executable,
        Buffer.from(args.key, 'base64'),
        (m, a) =>
          rpc.call(
            m,
            a,
            m === 'browser.embedded.perform'
              ? (a.command.timeoutMs ?? 15000) + 5000
              : m === 'browser.embedded.close'
                ? EMBEDDED_CLOSE_RPC_TIMEOUT_MS
                : m === 'task.output.directory' ||
                    m.startsWith('task.attachment.') ||
                    m.startsWith('tool.credentials.')
                  ? 55000
                  : 65000,
          ),
      );
      await runtime.ready;
      return true;
    }
    if (!runtime) throw new Error('宿主尚未就绪');
    return runtime.request(method, args);
  },
  (error) => (runtime ? runtime.redactError(error) : redactedErrorText(error)),
);
if (port) {
  port.on('message', (e: any) => void rpc.receive(e.data));
  port.on('close', () => {
    rpc.close();
    void runtime?.shutdown().catch(() => {});
  });
} else {
  process.on('message', (m) => void rpc.receive(m as any));
  process.on('disconnect', () => {
    rpc.close();
    void runtime?.shutdown().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
