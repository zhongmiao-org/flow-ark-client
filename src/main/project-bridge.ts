import { createServer, type Server } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, lstat, chmod, unlink, writeFile } from 'node:fs/promises';
import { projectMethods } from '../shared/project';

/** Local paired development transport; never forwards arbitrary host methods. */
export class ProjectBridge {
  private server?: Server;
  private sessions = new Map<string, string>();
  private sockets = new Set<import('node:net').Socket>();
  readonly path: string;
  constructor(dataPath: string, private call: (method: string, args: any) => Promise<any>) {
    this.path = join(dataPath, 'developer.sock');
  }
  async start() {
    if (process.platform !== 'darwin') return;
    try {
      const stat = await lstat(this.path);
      if (!stat.isSocket() || stat.uid !== process.getuid?.()) throw Error('开发接口路径被其他对象占用');
      await unlink(this.path);
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    this.server = createServer(socket => {
      if (this.sockets.size >= 16) { socket.destroy(); return; }
      this.sockets.add(socket); socket.setTimeout(15 * 60 * 1000, () => socket.destroy());
      socket.on('close', () => this.sockets.delete(socket));
      let data = '', pending = false;
      socket.setEncoding('utf8'); socket.on('error', () => {});
      socket.on('data', chunk => {
        data += chunk;
        if (Buffer.byteLength(data) > 2 * 1024 * 1024 || pending) { socket.destroy(); return; }
        const end = data.indexOf('\n'); if (end < 0) return;
        if (data.slice(end + 1).trim()) { socket.destroy(); return; }
        pending = true;
        void (async () => {
          try {
            const request = JSON.parse(data.slice(0, end));
            if (typeof request.token !== 'string' || request.token.length !== 64) throw Error('开发连接尚未配对');
            const token = [...this.sessions.keys()].find(t => timingSafeEqual(Buffer.from(t), Buffer.from(request.token)));
            const id = token && this.sessions.get(token);
            if (!id) throw Error('开发连接已失效，请在客户端重新连接工程');
            const allowed = new Set(['project.get', 'project.read', 'project.check', 'project.write', 'project.transaction', 'project.rollback',
              'project.prepare', 'project.instance', 'project.configure', 'project.run.history', 'project.run.preview', 'project.run.request', 'project.run.status', 'project.run.control']);
            if (!allowed.has(request.method)) throw Error('开发方法未授权');
            if (request.args?.id !== undefined && request.args.id !== id) throw Error('工程身份不一致');
            const args = projectMethods[request.method as keyof typeof projectMethods].parse({ ...request.args, id });
            const result = await this.call(request.method, args);
            socket.end(JSON.stringify({ ok: true, result }) + '\n');
          } catch (error) { socket.end(JSON.stringify({ ok: false, error: { code: 'developer-bridge', message: error instanceof Error ? error.message : '开发请求失败' } }) + '\n'); }
        })();
      });
    });
    await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(this.path, resolve); });
    await chmod(this.path, 0o600);
  }
  async pair(id: string, root: string) {
    if (!this.server) throw Error('本机开发连接当前仅在macOS启用');
    const local = join(root, '.flowark'); await mkdir(local, { recursive: true, mode: 0o700 });
    if ((await lstat(local)).isSymbolicLink()) throw Error('工程本机目录不允许符号链接');
    const descriptor = join(local, 'connection.json');
    try { if ((await lstat(descriptor)).isSymbolicLink()) throw Error('开发连接文件不允许符号链接'); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    const token = randomBytes(32).toString('hex');
    await writeFile(descriptor, JSON.stringify({ version: 1, projectId: id, socket: this.path, token }), { mode: 0o600 });
    await chmod(descriptor, 0o600);
    for (const [existing, projectId] of this.sessions) if (projectId === id) this.sessions.delete(existing);
    this.sessions.set(token, id);
  }
  close() { this.sessions.clear(); for (const s of this.sockets) s.destroy(); this.server?.close(); }
}
