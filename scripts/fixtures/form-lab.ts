import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { packageFlow } from '../../src/recruiting/templates';
import { formLabFlow, formText } from './form-lab-flow';

export async function startFormLab(port = 0) {
  const state = { accepted: [] as any[], rejected: 0, attempts: 0 };
  const files: Record<string, [string, string]> = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/lab.css': ['lab.css', 'text/css; charset=utf-8'],
    '/lab.js': ['lab.js', 'text/javascript; charset=utf-8'],
  };
  const server = createServer(async (req, res) => {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(data));
    };
    try {
      const base = `http://127.0.0.1:${(server.address() as any).port}`;
      const url = new URL(req.url ?? '/', base);
      if (req.headers.origin && req.headers.origin !== base)
        return json(403, { error: '仅接受本地页面提交' });
      if (req.method === 'GET' && files[url.pathname]) {
        const [name, type] = files[url.pathname];
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        res.end(
          await readFile(
            fileURLToPath(new URL(`../../fixtures/form-lab/${name}`, import.meta.url)),
          ),
        );
        return;
      }
      if (req.method === 'GET' && url.pathname === '/example.template.json')
        return json(200, packageFlow(formLabFlow(base), 'flowark-form-lab', undefined, '1.0.0'));
      if (req.method === 'GET' && url.pathname === '/fictional.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(formText);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/cities') {
        await new Promise((resolve) => setTimeout(resolve, 180));
        const options: Record<string, { value: string; label: string }[]> = {
          zhejiang: [
            { value: 'hangzhou', label: '杭州' },
            { value: 'ningbo', label: '宁波' },
          ],
          jiangsu: [
            { value: 'nanjing', label: '南京' },
            { value: 'suzhou', label: '苏州' },
          ],
        };
        return json(200, options[url.searchParams.get('province') ?? ''] ?? []);
      }
      if (req.method === 'POST' && url.pathname === '/api/submit') {
        let bytes = 0;
        const parts: Buffer[] = [];
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 256 * 1024) return json(413, { error: '测试内容超过 256 KB' });
          parts.push(chunk);
        }
        const payload = JSON.parse(Buffer.concat(parts).toString('utf8'));
        const fields = payload.fields;
        state.attempts++;
        const reject = (error: string) => {
          state.rejected++;
          json(422, { status: 'rejected', error });
        };
        if (payload.reject === true) return reject('模拟拒绝：本次请求未被接受');
        if (
          !fields ||
          typeof fields.fullName !== 'string' ||
          !fields.fullName.trim() ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email ?? '') ||
          fields.passwordLength < 8 ||
          !['email', 'phone', 'none'].includes(fields.channel) ||
          !['engineering', 'design', 'operations'].includes(fields.department) ||
          fields.agreement !== true
        )
          return reject('服务端校验未通过：必填项或格式错误');
        if (
          !fields.startDate ||
          !fields.endDate ||
          fields.startDate > fields.endDate ||
          Number(fields.quantity) < 1 ||
          Number(fields.quantity) > 99
        )
          return reject('服务端校验未通过：日期或数量范围错误');
        const cities: Record<string, string[]> = {
          zhejiang: ['hangzhou', 'ningbo'],
          jiangsu: ['nanjing', 'suzhou'],
        };
        if (
          !cities[fields.province]?.includes(fields.city) ||
          (fields.invoice && !fields.invoiceTitle?.trim())
        )
          return reject('服务端校验未通过：联动字段错误');
        if ('disabledField' in fields || 'password' in fields || fields.readonlyCode !== 'LAB-2026')
          return reject('服务端校验未通过：不可提交字段被修改');
        const file = fields.attachment;
        if (
          file &&
          (typeof file.content !== 'string' ||
            typeof file.name !== 'string' ||
            !file.name.endsWith('.txt') ||
            Buffer.byteLength(file.content) > 65536 ||
            Buffer.byteLength(file.content) !== file.size)
        )
          return reject('服务端校验未通过：文件不符合约束');
        const receipt = {
          status: 'accepted',
          receiptId: `FORM-${String(state.accepted.length + 1).padStart(4, '0')}`,
          fields,
          fileSha256: file ? createHash('sha256').update(file.content).digest('hex') : null,
        };
        state.accepted.push(structuredClone(receipt));
        return json(200, receipt);
      }
      json(404, { error: '未找到测试资源' });
    } catch {
      if (!res.headersSent) json(400, { error: '请求格式无效' });
      else res.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${(server.address() as any).port}`,
    state,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
