import { fork, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export function child(entry: string, executable: string): ChildProcess {
  return fork(entry, [], {
    execPath: executable,
    execArgv: [],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      SE_AVOID_BROWSER_DOWNLOAD: 'true',
      SE_OFFLINE: 'true',
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
    },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    detached: true,
  });
}
export async function killOwnedTree(proc: ChildProcess) {
  if (!proc.pid || proc.exitCode !== null || proc.signalCode !== null) return;
  const target = proc.pid;
  // Capture only descendants of this owned process. Never kill by executable name.
  const pids = [target];
  try {
    const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid=']);
    const rows = stdout
      .trim()
      .split('\n')
      .map((r) => r.trim().split(/\s+/).map(Number));
    for (let i = 0; i < pids.length; i++)
      for (const [pid, parent] of rows)
        if (parent === pids[i] && !pids.includes(pid)) pids.push(pid);
  } catch {}
  for (const pid of pids.reverse()) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
  if (proc.exitCode === null && proc.signalCode === null)
    await new Promise<void>((resolve) => {
      proc.once('exit', () => resolve());
      setTimeout(resolve, 1500).unref();
    });
}
