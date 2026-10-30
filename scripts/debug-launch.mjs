import { debugMkdtemp } from '../src/host/debug-files.mjs';
import { open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

// Explicit developer launcher: records only diagnostics, never copies formal data or keys.
const executable = process.argv[2];
if (!executable)
  throw new Error('Usage: node scripts/debug-launch.mjs /path/to/FlowArk [arguments...]');
const directory = await debugMkdtemp('flowark-debug-', {
  category: 'log',
  purpose: '显式调试启动的进程日志与采样',
});
const log = await open(join(directory, 'application.log'), 'wx', 0o600);
console.log('调试文件位置：', directory);
const child = spawn(executable, process.argv.slice(3), {
  env: { ...process.env, FLOWARK_DEBUG_SESSION: directory },
  stdio: ['inherit', log.fd, log.fd],
});
await log.close();
child.once('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    child.kill(signal);
  });
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
