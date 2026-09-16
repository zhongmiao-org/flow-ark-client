import { join } from 'node:path';
import { child, killOwnedTree } from '../host/processes';
import { Rpc } from '../shared/rpc';
export async function runScript(options: {
  compiled: string;
  sha256: string;
  input: any;
  dir: string;
  executable: string;
  signal: AbortSignal;
  call: (method: string, args: any) => Promise<any>;
}) {
  options.signal.throwIfAborted();
  const proc = child(join(options.dir, 'script.cjs'), options.executable);
  const rpc = new Rpc((m) => proc.send(m), options.call);
  proc.on('message', (m) => void rpc.receive(m as any));
  proc.on('exit', () => rpc.close());
  proc.on('error', () => rpc.close());
  const cancel = () => {
    if (proc.connected) proc.send({ control: 'cancel' }, () => {});
    void killOwnedTree(proc);
  };
  process.once('disconnect', cancel);
  options.signal.addEventListener('abort', cancel, { once: true });
  try {
    return await rpc.call(
      'execute',
      { path: options.compiled, sha256: options.sha256, input: options.input },
      3600000,
    );
  } finally {
    options.signal.removeEventListener('abort', cancel);
    process.removeListener('disconnect', cancel);
    await killOwnedTree(proc);
    rpc.close();
  }
}
