import { Runtime } from './runtime';
import { Rpc } from '../shared/rpc';
import { dirname } from 'node:path';
const port = (process as any).parentPort;
let runtime: Runtime | undefined;
const send = (m: any) => (port ? port.postMessage(m) : process.send?.(m));
const rpc = new Rpc(send, async (method, args) => {
  if (method === 'init') {
    if (runtime) throw new Error('宿主已初始化');
    runtime = new Runtime(
      args.dataPath,
      dirname(process.argv[1]),
      args.executable,
      Buffer.from(args.key, 'base64'),
      (m, a) => rpc.call(m, a),
    );
    return true;
  }
  if (!runtime) throw new Error('宿主尚未就绪');
  return runtime.request(method, args);
});
if (port) {
  port.on('message', (e: any) => void rpc.receive(e.data));
  port.on('close', () => void runtime?.shutdown());
} else {
  process.on('message', (m) => void rpc.receive(m as any));
  process.on('disconnect', () => void runtime?.shutdown().finally(() => process.exit(0)));
}
