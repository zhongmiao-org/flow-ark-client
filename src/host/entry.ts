import { Runtime } from './runtime';
import { workspaceStorage } from './workspace-storage';
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
      const workspace = await workspaceStorage(args.dataPath);
      if (workspace ? args.storageMode !== workspace.format || args.databasePath !== workspace.path : args.storageMode !== undefined && args.storageMode !== 'encrypted')
        throw new Error('宿主存储策略与已启用的工作区不一致，未回退或重建');
      if (!workspace && (typeof args.key !== 'string' || Buffer.from(args.key, 'base64').length !== 32))
        throw new Error('原加密工作区密钥不可用，未重建');
      runtime = new Runtime(
        args.dataPath,
        dirname(process.argv[1]),
        args.executable,
        workspace ? null : Buffer.from(args.key, 'base64'),
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
                    m.startsWith('tool.credentials.') ||
                    m.startsWith('ai.configuration.') ||
                    m === 'credentials.get'
                  ? 55000
                  : 65000,
          ),
        workspace ?? undefined,
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
