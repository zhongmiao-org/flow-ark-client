import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
// This small supervisor never parses documents. EOF/deadline can kill a busy parser.
let child: ChildProcess | undefined,
  started = false,
  closing = false;
let deadline: NodeJS.Timeout | undefined;
const stop = async (message?: any) => {
  if (closing) return;
  closing = true;
  clearTimeout(deadline);
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>((resolve) => child!.once('exit', () => resolve()));
    child.kill('SIGKILL');
    await exited;
  }
  if (message && process.connected)
    await new Promise<void>((resolve) => process.send!(message, () => resolve()));
  if (process.connected) process.disconnect();
};
process.on('disconnect', () => {
  void stop();
});
process.on('message', (m: any) => {
  if (m?.cancel) {
    void stop({ error: '资料解析已取消' });
    return;
  }
  if (started || closing) return;
  started = true;
  if (
    !m ||
    !Number.isSafeInteger(m.timeoutMs) ||
    m.timeoutMs < 1 ||
    m.timeoutMs > 30000 ||
    typeof m.data !== 'string' ||
    m.data.length > 12 * 1024 * 1024 ||
    !['text', 'pdf', 'docx'].includes(m.format)
  ) {
    void stop({ error: '资料解析监护输入无效' });
    return;
  }
  child = fork(join(__dirname, 'document-parser.mjs'), [], {
    execPath: process.execPath,
    execArgv: ['--max-old-space-size=256', '--disallow-code-generation-from-strings'],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  deadline = setTimeout(() => void stop({ error: '资料解析超过期限；未重试或截断' }), m.timeoutMs);
  child.once('message', (result: any) => {
    void stop(result);
  });
  child.once('error', () => {
    void stop({ error: '资料解析进程无法启动' });
  });
  child.once('exit', () => {
    if (!closing) void stop({ error: '资料解析进程意外退出，未采用部分输出' });
  });
  child.send({ format: m.format, data: m.data }, (error) => {
    if (error) void stop({ error: '资料解析进程连接失败' });
  });
});
