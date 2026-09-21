import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { ElectronApplication, Page } from 'playwright-core';
import electronPath from 'electron';
import { desktopElectron, readDesktopMains } from './desktop-session.mjs';

const data = await mkdtemp(join(tmpdir(), 'flowark-connection-ui-'));
const secret = 'fictional-connection-ui-key';
const control = { changed: false, stall: false };
const calls: { method: string; authorized: boolean }[] = [];
const server = createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  }
  let raw = '';
  for await (const part of req) raw += part;
  const body = JSON.parse(raw);
  const authorized = req.headers.authorization === `Bearer ${secret}`;
  calls.push({ method: body.method, authorized });
  if (!authorized) {
    res.writeHead(401).end();
    return;
  }
  if (body.method === 'tools/list' && control.stall) return;
  const result =
    body.method === 'server/discover'
      ? {
          resultType: 'complete',
          supportedVersions: ['2026-07-28'],
          capabilities: { tools: {} },
          _meta: { 'io.modelcontextprotocol/serverInfo': { name: '独立资料服务', version: '1.0' } },
        }
      : {
          resultType: 'complete',
          ttlMs: 0,
          cacheScope: 'private',
          tools: [
            {
              name: 'find_notes',
              title: '查找资料',
              description: '读取明确选定记录的标题，不代表已授权账号。',
              inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
              annotations: { readOnlyHint: true },
            },
            ...(control.changed
              ? [
                  {
                    name: 'update_note',
                    title: '更新资料',
                    description: '修改记录前需要独立任务授权。',
                    inputSchema: { type: 'object' },
                    annotations: { destructiveHint: true },
                  },
                ]
              : []),
          ],
        };
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(server.address() as any).port}/mcp`;
const evidence: any = {
  passed: false,
  data,
  checks: [],
  layouts: [],
  processes: [],
  service: 'real local HTTP fixture; fictional credential; no tools/call',
};
let app: ElectronApplication | undefined,
  child: ChildProcess | undefined,
  page: Page | undefined,
  failure: unknown;
const errors: string[] = [];
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const heading = (name: string) => page!.getByRole('heading', { name, exact: true });
const field = (name: string) => page!.getByLabel(name, { exact: true });
const call = (method: string, args: any = {}): Promise<any> =>
  page!.evaluate(({ method, args }) => window.flowark.request(method, args), { method, args });
const note = (value: string) => {
  evidence.checks.push(value);
  console.log(value);
};
async function until(check: () => Promise<boolean>, label: string) {
  const end = Date.now() + 20000;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(label);
    await new Promise((r) => setTimeout(r, 40));
  }
}
async function launch() {
  app = await desktopElectron.launch({
    executablePath: electronPath as unknown as string,
    args: ['.'],
    env: { ...process.env, FLOWARK_DATA_DIR: data },
  });
  child = app.process();
  evidence.processes.push({ pid: child.pid, closed: false });
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (e) => errors.push(e.message));
  await heading('你想完成什么？').waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1440, 1080);
    win.setTitle('FlowArk · 工具连接隔离验证（自动退出）');
  });
  await button('应用与工具').click();
  await heading('应用与工具').waitFor();
}
async function close() {
  if (!app || !child) return;
  const owned = app,
    proc = child;
  await owned.close();
  assert.ok(proc.exitCode !== null || proc.signalCode !== null);
  evidence.processes.at(-1).closed = true;
  app = undefined;
  page = undefined;
  assert.deepEqual(readDesktopMains(), []);
}
async function layouts(name: string) {
  for (const width of [1440, 1920, 1040]) {
    await app!.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0].setSize(width, width === 1040 ? 700 : 1080),
      width,
    );
    await page!.waitForFunction((w) => window.innerWidth === w, width);
    await page!.evaluate(() => document.querySelector('main')?.scrollTo({ top: 0 }));
    const layout = await page!.locator('.tools-page').evaluate((element) => ({
      width: element.clientWidth,
      scroll: element.scrollWidth,
      cards: Array.from(
        element.querySelectorAll('.tool-columns > section, .tool-presets > section'),
      ).map((card) => {
        const r = card.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    }));
    assert.ok(layout.scroll <= layout.width + 1, `${name} overflow at ${width}`);
    if (width === 1440 && name === 'review') {
      assert.ok(Math.abs(layout.cards[0].x - 256) <= 1);
      assert.ok(Math.abs(layout.cards[0].width - 650) <= 1);
      assert.ok(Math.abs(layout.cards[1].x - 930) <= 1);
      assert.ok(Math.abs(layout.cards[0].y - 230) <= 1);
    }
    evidence.layouts.push({ name, viewport: width, ...layout });
    await page!.screenshot({
      path: `test-results/figma/tools-${name}-${width}.png`,
      fullPage: true,
    });
  }
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1080));
}
const source = () => page!.getByLabel('我已核对来源、地址或程序及其运行方式');
const capability = () => page!.getByLabel('我已核对该连接的身份说明和完整工具清单');
async function discover(key?: string) {
  if (key) await page!.getByLabel(/^Bearer Token/).fill(key);
  await source().check();
  await button('发现并检查能力').click();
  await heading('检查发现的能力').waitFor();
}
try {
  await mkdir('test-results/figma', { recursive: true });
  await launch();
  assert.deepEqual(await call('tool.connection.list'), []);
  await layouts('catalog');
  await button('自定义 MCP').click();
  await field('显示名称').fill('隔离资料服务');
  await field('来源说明').fill('FlowArk 本机隔离测试服务');
  await field('服务地址').fill(url);
  await field('认证方式').selectOption('bearer');
  assert.ok(await button('发现并检查能力').isDisabled());
  await page!.getByLabel(/^Bearer Token/).fill('fictional-wrong-key');
  await source().check();
  await button('发现并检查能力').click();
  await page!.getByRole('alert').filter({ hasText: '认证失败' }).waitFor();
  assert.ok(!(await page!.getByRole('alert').innerText()).includes('flowark:request'));
  assert.deepEqual(await call('tool.connection.list'), []);
  assert.equal(await page!.getByLabel(/^Bearer Token/).inputValue(), '');
  await layouts('config');
  await discover(secret);
  assert.equal(await heading('本机应用助手').count(), 0);
  await page!.getByText('服务声明：独立资料服务 / 1.0', { exact: false }).waitFor();
  assert.ok(await button('保存这个连接').isDisabled());
  assert.deepEqual(await call('tool.connection.list'), []);
  await layouts('review');
  await button('取消，回到设置').click();
  assert.equal(await field('显示名称').inputValue(), '隔离资料服务');
  assert.deepEqual(await call('tool.connection.list'), []);
  await discover(secret);
  await capability().check();
  await button('保存这个连接').click();
  await heading('隔离资料服务 · 本次发现通过').waitFor();
  const saved = (await call('tool.connection.list'))[0];
  assert.equal(saved.tools.length, 1);
  assert.ok(saved.hasCredential);
  assert.ok(!('credentialRef' in saved));
  assert.equal((await page!.locator('.tools-host').innerText()).includes(secret), false);
  note(
    'source-review-auth-failure-cancel-preserves-form-capability-review-before-save-real-service-identity',
  );

  await button('查看连接设置').click();
  await field('服务地址').fill(url + '/other');
  await source().check();
  const previousCalls = calls.length;
  await button('发现并检查能力').click();
  await page!.getByRole('alert').filter({ hasText: '地址或认证已变化' }).waitFor();
  assert.equal(calls.length, previousCalls);
  await field('服务地址').fill(url);
  control.changed = true;
  await discover();
  await page!.getByText('服务身份或能力定义已变化', { exact: false }).waitFor();
  assert.equal((await call('tool.connection.list'))[0].tools.length, 1);
  await capability().check();
  await button('保存这个连接').click();
  await heading('隔离资料服务 · 本次发现通过').waitFor();
  assert.equal((await call('tool.connection.list'))[0].tools.length, 2);
  await button('断开连接').click();
  await page!.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await call('tool.connection.list'))[0].status, 'verified');
  await button('断开连接').click();
  await button('确认断开').click();
  await heading('隔离资料服务 · 已断开').waitFor();
  const beforeRestart = calls.length;
  await close();
  await launch();
  assert.equal(calls.length, beforeRestart);
  await page!.getByRole('button', { name: /隔离资料服务.*已断开/ }).click();
  await button('重新检查连接').click();
  await discover();
  await capability().check();
  await button('保存这个连接').click();
  await heading('隔离资料服务 · 本次发现通过').waitFor();
  const verifiedCalls = calls.length;
  await close();
  await launch();
  assert.equal(calls.length, verifiedCalls);
  assert.equal((await call('tool.connection.list'))[0].status, 'unverified');
  await page!.getByRole('button', { name: /隔离资料服务.*尚未重新测试/ }).click();
  note(
    'credential-endpoint-isolation-capability-change-reviewed-disconnect-reconnect-reopen-offline',
  );

  await button('重新检查连接').click();
  control.stall = true;
  await source().check();
  const previousLists = calls.filter((c) => c.method === 'tools/list').length;
  await button('发现并检查能力').click();
  await until(
    async () => calls.filter((c) => c.method === 'tools/list').length > previousLists,
    'stalled discovery was not reached',
  );
  await button('取消检查').click();
  await until(
    async () => !(await button('发现并检查能力').isDisabled()),
    'discovery cancel did not settle',
  );
  assert.equal((await call('tool.connection.list'))[0].status, 'unverified');
  control.stall = false;
  await field('显示名称').fill('尚未保存的修改');
  await button('我的流程').click();
  await heading('离开尚未保存的连接？').waitFor();
  await button('继续编辑').click();
  assert.equal(await field('显示名称').inputValue(), '尚未保存的修改');
  await button('我的流程').click();
  await button('放弃连接并离开').click();
  await button('应用与工具').click();
  await heading('应用与工具').waitFor();
  assert.equal((await call('tool.connection.list'))[0].config.displayName, '隔离资料服务');
  await page!.getByRole('button', { name: /隔离资料服务.*尚未重新测试/ }).click();
  await app!.evaluate(({ safeStorage }) => {
    (globalThis as any).toolTestStorageAvailable = safeStorage.isAsyncEncryptionAvailable;
    safeStorage.isAsyncEncryptionAvailable = async () => false;
  });
  await button('删除连接').click();
  await button('确认删除').click();
  await page!.getByRole('alert').filter({ hasText: '记录已保留' }).waitFor();
  assert.equal((await call('tool.connection.list')).length, 1);
  assert.ok((await readdir(join(data, 'credentials'))).some((name) => name.startsWith('mcp-')));
  await app!.evaluate(({ safeStorage }) => {
    safeStorage.isAsyncEncryptionAvailable = (globalThis as any).toolTestStorageAvailable;
    delete (globalThis as any).toolTestStorageAvailable;
  });
  await button('删除连接').click();
  await button('确认删除').click();
  await heading('应用与工具').waitFor();
  assert.deepEqual(await call('tool.connection.list'), []);
  const credentialFiles = await readdir(join(data, 'credentials'));
  assert.ok(!credentialFiles.some((name) => name.startsWith('mcp-')));
  assert.ok(credentialFiles.includes('data-key.enc'));
  assert.deepEqual((await call('bootstrap')).runs, []);
  assert.deepEqual(await call('task.list'), []);
  note('cancel-and-leave-guard-removal-failure-keeps-record-retry-removes-only-own-key-no-runs');

  await button('查看并选择网页').click();
  await heading('这次要操作哪里？').waitFor();
  assert.equal((await call('task.list')).length, 1);
  await button('管理应用与工具').click();
  await heading('应用与工具').waitFor();
  await button('查看并选择文件').click();
  await heading('描述需求，带上必要资料').waitFor();
  assert.equal((await call('task.list')).length, 1);
  assert.deepEqual(errors, []);
  assert.ok(calls.every((call) => ['server/discover', 'tools/list'].includes(call.method)));
  note('built-in-web-and-file-entry-retains-same-task-and-never-calls-tools');
  evidence.passed = true;
} catch (error) {
  failure = error;
  evidence.error = String(error);
  evidence.alerts = await page
    ?.getByRole('alert')
    .allTextContents()
    .catch(() => []);
} finally {
  try {
    await close();
  } catch (error) {
    failure ??= error;
    evidence.cleanupError = String(error);
  }
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  evidence.calls = calls;
  evidence.errors = errors;
  evidence.passed &&= !failure;
  await writeFile('test-results/tool-connections.json', JSON.stringify(evidence, null, 2));
  console.log(
    JSON.stringify({
      passed: evidence.passed,
      checks: evidence.checks,
      error: evidence.error,
      cleanupError: evidence.cleanupError,
    }),
  );
}
if (failure) throw failure;
