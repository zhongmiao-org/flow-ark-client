import { connect } from 'node:net';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { ProjectDiagnostic } from './configuration';
export async function desktopProjectRequest(root: string, method: string, args: object = {}) {
  root = await realpath(root);
  const directory = join(root, '.flowark'), path = join(directory, 'connection.json');
  if ((await lstat(directory)).isSymbolicLink() || (await lstat(path)).isSymbolicLink()) throw new ProjectDiagnostic('connection-path', '开发连接不允许符号链接');
  const stat = await lstat(path);
  if (stat.size > 8192 || (stat.mode & 0o077) !== 0) throw new ProjectDiagnostic('connection-permissions', '连接文件须为仅本人可读写的有界文件');
  const descriptor = JSON.parse(await readFile(path, 'utf8'));
  if (descriptor.version !== 1 || typeof descriptor.socket !== 'string' || !/^[a-f0-9]{64}$/.test(descriptor.token))
    throw new ProjectDiagnostic('connection-invalid', '请在FlowArk中重新连接工程');
  return new Promise<any>((resolve, reject) => {
    const socket = connect(descriptor.socket); let buffer = '';
    const fail = (error: unknown) => { socket.destroy(); reject(error); };
    socket.setTimeout(10 * 60 * 1000, () => fail(new ProjectDiagnostic('connection-timeout', '客户端请求超时；先核对原操作，不自动重试')));
    socket.on('connect', () => socket.write(JSON.stringify({ token: descriptor.token, method, args: { ...args, id: descriptor.projectId } }) + '\n'));
    socket.on('error', () => fail(new ProjectDiagnostic('connection-unavailable', '本机FlowArk连接不可用，请打开客户端并重新连接工程')));
    socket.setEncoding('utf8'); socket.on('data', chunk => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 16 * 1024 * 1024) return fail(new ProjectDiagnostic('connection-result-size', '开发结果超过读取范围'));
      const end = buffer.indexOf('\n'); if (end < 0) return;
      try { const response = JSON.parse(buffer.slice(0, end)); socket.end();
        response.ok ? resolve(response.result) : reject(new ProjectDiagnostic(response.error.code, response.error.message));
      } catch { fail(new ProjectDiagnostic('connection-response', '开发响应无法核对，不自动重试')); }
    });
    socket.on('end', () => { if (!buffer.includes('\n')) reject(new ProjectDiagnostic('connection-disconnected', '连接中断，先核对原操作结果')); });
  });
}
