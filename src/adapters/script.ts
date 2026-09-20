import { uid } from '../shared/utils';
export async function runScript(options: {
  nodeId: string;
  nodeInstance: string;
  input: any;
  signal: AbortSignal;
  call: (method: string, args: any) => Promise<any>;
}) {
  options.signal.throwIfAborted();
  const invocationId = uid();
  const cancel = () => {
    void options.call('script.cancel', { invocationId }).catch(() => {});
  };
  options.signal.addEventListener('abort', cancel, { once: true });
  try {
    options.signal.throwIfAborted();
    return await options.call('script.execute', {
      invocationId,
      nodeId: options.nodeId,
      nodeInstance: options.nodeInstance,
      input: options.input,
    });
  } catch (error) {
    // An RPC timeout only stops waiting locally. Revoke this exact invocation;
    // Host also closes all of the Run's supervisors when the Worker disappears.
    cancel();
    throw error;
  } finally {
    options.signal.removeEventListener('abort', cancel);
  }
}
