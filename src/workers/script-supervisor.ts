import { fork, execFile, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { Rpc } from '../shared/rpc';
import {
  SCRIPT_READY_TIMEOUT_MS,
  SCRIPT_EXECUTE_RPC_TIMEOUT_MS,
  SCRIPT_COOPERATIVE_STOP_MS,
  type ScriptSupervisorMessage,
} from '../shared/script-supervision';
import { errorText } from '../shared/utils';

let nonce: string | undefined;
let ready = false;
let stopping = false;
let executing = false;
let child: ChildProcess | undefined;
let childRpc: Rpc | undefined;
let resultReceived = false;
let group: number | undefined;
let groupChecked = false;

function send(message: ScriptSupervisorMessage) {
  if (!process.connected) return stop();
  try {
    process.send?.(message, (error) => {
      if (error) stop();
    });
  } catch {
    stop();
  }
}

// Only this still-live group leader sends a terminating group signal. No owner
// sends a signal to a numeric group remembered from an earlier process lifetime.
function killGroup() {
  if (!groupChecked) return;
  if (group !== process.pid) {
    // No user process can have been created before group verification.
    process.exit(1);
  }
  try {
    process.kill(-process.pid, 'SIGKILL');
  } catch (error) {
    if (nonce && process.connected) {
      try {
        process.send?.({
          kind: 'script-fault',
          nonce,
          error: '脚本进程组停止失败：' + errorText(error),
        });
      } catch {}
    }
    // Staying alive preserves the group anchor; the Host records unknown.
    setInterval(() => {}, 1000);
  }
}

function stop(cooperative = true) {
  if (stopping) return;
  stopping = true;
  clearTimeout(readyTimer);
  if (cooperative && child?.connected) {
    // Start the force timer before sending; neither the send callback nor user
    // code can postpone the bound. This is included in the Host cleanup budget.
    setTimeout(killGroup, SCRIPT_COOPERATIVE_STOP_MS);
    try {
      child.send({ control: 'cancel' }, () => {});
    } catch {}
  } else killGroup();
}

const rpc = new Rpc(
  (message) => send({ kind: 'script-rpc', nonce: nonce!, message }),
  async (method, args) => {
    if (method !== 'execute' || !ready || stopping || executing || !process.connected)
      throw new Error('脚本执行许可无效');
    executing = true;
    clearTimeout(readyTimer);
    child = fork(join(dirname(process.argv[1]), 'script.cjs'), [], {
      execPath: process.execPath,
      execArgv: [],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      detached: false,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    childRpc = new Rpc(
      (message) => child!.send(message),
      async (capability, value) => {
        if (stopping || !process.connected) throw new Error('脚本调用已停止');
        if (!['log', 'progress', 'artifact', 'credential', 'template'].includes(capability))
          throw new Error('脚本能力不在白名单');
        return rpc.call(capability, value, capability === 'template' ? 610000 : 65000);
      },
    );
    child.on('message', (message) => {
      if (!stopping) void childRpc!.receive(message as any);
    });
    const lost = (reason: string) => {
      if (!stopping && !resultReceived && nonce)
        send({ kind: 'script-fault', nonce, error: reason });
      childRpc?.close();
    };
    child.once('error', (error) => lost('脚本进程启动失败：' + errorText(error)));
    child.once('exit', () => lost('脚本进程意外退出'));
    child.once('disconnect', () => lost('脚本进程通信意外断开'));
    try {
      const result = await childRpc.call('execute', args, SCRIPT_EXECUTE_RPC_TIMEOUT_MS);
      resultReceived = true;
      return result;
    } catch (error) {
      // A user throw is an ordinary node failure, and is still followed by group
      // cleanup. Native child loss is reported separately by the handlers above.
      resultReceived = true;
      throw error;
    }
  },
);

process.on('message', (message: ScriptSupervisorMessage) => {
  if (!message || typeof message.nonce !== 'string') return;
  if (message.kind === 'script-stop' && (!nonce || nonce === message.nonce)) {
    nonce ??= message.nonce;
    stop(Boolean(message.cooperative));
    return;
  }
  if (stopping) return;
  if (message.kind === 'script-init' && !nonce) {
    nonce = message.nonce;
    if (groupChecked && group === process.pid) announceReady();
    return;
  }
  if (nonce && nonce === message.nonce && message.kind === 'script-rpc')
    void rpc.receive(message.message as any);
});
process.once('disconnect', stop);
process.once('error', () => stop());
const readyTimer = setTimeout(stop, SCRIPT_READY_TIMEOUT_MS);

function announceReady() {
  if (!nonce || stopping || ready || !process.connected) return;
  ready = true;
  send({ kind: 'script-ready', nonce, pid: process.pid, pgid: group! });
}

// This helper is controlled code. It runs before importing any user module and
// is bounded independently from script execution and Host acknowledgements.
execFile(
  '/bin/ps',
  ['-o', 'pgid=', '-p', String(process.pid)],
  {
    timeout: SCRIPT_READY_TIMEOUT_MS,
  },
  (error, stdout) => {
    groupChecked = true;
    const value = Number(stdout.trim());
    if (!error && Number.isSafeInteger(value) && value > 0) group = value;
    if (stopping) return killGroup();
    if (group !== process.pid || !process.connected) return stop();
    announceReady();
  },
);
if (!process.connected) stop();
