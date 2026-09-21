import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import electronPath from 'electron';
import type { ElectronApplication, Page } from 'playwright-core';
import { desktopElectron, readDesktopMains } from './desktop-session.mjs';
import { exportDefinition } from '../src/templates/export';
import { writeArchive } from '../src/templates/archive';
import { canonical, sha256, manifestDigest } from '../contracts/package-format';

const data = await mkdtemp('/private/tmp/flowark-template-ai-ui-');
const appPath = await mkdtemp(resolve('test-results/template-ai-app-'));
const faultPath = join(data, 'detail-fault');
const evidence: any = {
  passed: false,
  checks: [],
  layouts: [],
  sessions: [],
  data,
  boundary:
    'real Main/Host/Renderer, system protection and Worker; file picker and explicit read/write failures are fixtures; no real model request',
};
let requests = 0;
const server = createServer((_request, response) => {
  requests++;
  response.writeHead(500).end();
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${(server.address() as any).port}`;
await cp('dist', join(appPath, 'dist'), { recursive: true });
await cp('contracts', join(appPath, 'contracts'), { recursive: true });
await writeFile(
  join(appPath, 'package.json'),
  JSON.stringify({ name: 'template-ai-fixture', version: '0.3.0', main: 'dist/main.cjs' }),
);
await build({
  entryPoints: ['src/host/entry.ts'],
  outfile: join(appPath, 'dist/host.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  packages: 'external',
  banner: {
    js: `const fixtureFetch = globalThis.fetch; globalThis.fetch = (url, init) => {
    if (!['https://api.deepseek.com/chat/completions', 'https://api.openai.com/v1/responses'].includes(String(url))) throw new Error('Unexpected fixture network');
    return fixtureFetch(${JSON.stringify(url)}, init);
  };`,
  },
  plugins: [
    {
      name: 'explicit-source-read-fault',
      setup(build) {
        build.onLoad({ filter: /src\/templates\/service\.ts$/ }, async (args) => ({
          loader: 'ts',
          contents:
            (await readFile(args.path, 'utf8')) +
            `
const originalDetail = Templates.prototype.detail;
Templates.prototype.detail = async function(id) {
  let fault = ''; try { fault = await readFile(${JSON.stringify(faultPath)}, 'utf8'); } catch {}
  if (fault === 'unavailable') throw new Error('fixture source temporarily unavailable');
  const detail = await originalDetail.call(this, id);
  if (fault === 'identity') detail.instance.entryFlows.draft = 'fixture-replaced-flow';
  return detail;
};`,
        }));
      },
    },
  ],
});
const pkg = await exportDefinition(
  {
    id: 'fixture',
    name: 'AI 来源核对',
    description: '独立测试包的虚构字段',
    formatVersion: '1.0',
    parameters: { topic: '虚构原值', summary: '虚构摘要' },
    requiredCapabilities: ['value'],
    steps: [{ id: 'read', type: 'value', version: 1, value: { $ref: 'params.topic' } }],
  } as any,
  {
    schema: {
      type: 'object',
      properties: { shared: { type: 'string', title: '共享文本', default: '原始共享值' } },
      required: ['shared'],
      additionalProperties: false,
    },
  },
);
const input = {
  type: 'object',
  properties: {
    topic: { type: 'string', title: '主题', default: '原始主题', maxLength: 100 },
    summary: { type: 'string', title: '资料摘要', default: '虚构资料', maxLength: 2000 },
  },
  required: ['topic', 'summary'],
  additionalProperties: false,
};
const first = pkg.manifest.entries[0];
pkg.files.set(first.inputSchema, Buffer.from(JSON.stringify(input)));
const fixtureFlow = JSON.parse(pkg.files.get(first.flow)!.toString());
fixtureFlow.parameters = { topic: '原始主题', summary: '虚构资料' };
pkg.files.set(first.flow, Buffer.from(canonical(fixtureFlow)));
pkg.manifest.resources = [
  { id: 'model', name: 'AI 资源', kind: 'ai', access: 'use', required: true },
];
pkg.manifest.entries = [
  { ...first, id: 'draft', name: '生成草稿', resources: ['model'] },
  { ...first, id: 'read', name: '只读查看', resources: [] },
];
pkg.manifest.files = [...pkg.files]
  .filter(([path]) => path !== 'manifest.json')
  .map(([path, bytes]) => ({ path, size: bytes.length, sha256: sha256(bytes) }));
pkg.manifest.contentDigest = manifestDigest(pkg.manifest);
pkg.files.set('manifest.json', Buffer.from(canonical(pkg.manifest)));
const archive = join(data, 'fixture.zip');
await writeArchive(pkg, archive);
let app: ElectronApplication | undefined, page!: Page;
const button = (name: string) => page.getByRole('button', { name, exact: true });
const call = (method: string, args: any = {}): Promise<any> =>
  page.evaluate(({ method, args }) => window.flowark.request(method, args), { method, args });
const note = (name: string) => {
  evidence.checks.push(name);
  console.log('PASS ' + name);
};
async function wait(check: () => Promise<boolean>, label: string) {
  const until = Date.now() + 20000;
  while (!(await check())) {
    if (Date.now() > until) throw new Error(label);
    await new Promise((r) => setTimeout(r, 50));
  }
}
async function launch() {
  assert.equal(app, undefined);
  app = await desktopElectron.launch({
    executablePath: String(electronPath),
    args: [appPath],
    env: { ...process.env, FLOWARK_DATA_DIR: data },
  });
  evidence.sessions.push({ pid: app.process().pid, closed: false });
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (e) => (evidence.pageErrors ??= []).push(e.message));
  await page.getByRole('heading', { name: '你想完成什么？' }).waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setTitle('FlowArk · 模板 AI 返回验证（自动退出）');
  });
}
async function close() {
  if (!app) return;
  await app.evaluate(({ safeStorage }) => {
    if ((globalThis as any).encryptOriginal)
      safeStorage.encryptStringAsync = (globalThis as any).encryptOriginal;
  });
  for (const run of (await call('bootstrap')).runs)
    if (['QUEUED', 'RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING'].includes(run.state))
      await call('run.control', { id: run.id, action: 'cancel' });
  await wait(async () => !(await call('bootstrap')).execution.active, 'owned run still active');
  const child = app.process();
  await app.close();
  assert.equal(child.exitCode, 0);
  evidence.sessions.at(-1).closed = true;
  app = undefined;
  assert.deepEqual(readDesktopMains(), []);
}
async function size(width: number) {
  await app!.evaluate(
    ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 1080),
    width,
  );
  await page.waitForFunction((width) => window.innerWidth === width, width);
  await page.evaluate(() => document.fonts.ready);
}
async function screenshot(name: string) {
  for (const width of [1440, 1920, 1040]) {
    await size(width);
    await page.evaluate(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      await Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      );
    });
    assert.equal(await page.locator('.sidebar nav [aria-current="page"]').count(), 1);
    assert.equal(
      await page.locator('.sidebar nav [aria-current="page"]').getAttribute('aria-label'),
      name === 'settings-template' ? '本地设置' : '模板库',
    );
    await page.screenshot({ path: join(data, `${name}-${width}.png`) });
    const layout = await page.evaluate(() => {
      const cards = [
        ...document.querySelectorAll(
          '.template-entry-columns > section, .ai-settings-host:not([hidden]) .ai-settings-columns > section',
        ),
      ].filter((e) => (e as HTMLElement).offsetParent);
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        cards: cards.map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }),
      };
    });
    assert.equal(layout.overflow, false);
    if (width === 1440) {
      assert.equal(layout.cards[0].x, 256);
      assert.equal(layout.cards[1].x, 1008);
      assert.equal(layout.cards[0].y, 294);
    }
    evidence.layouts.push({ name, width, ...layout });
  }
  await size(1440);
}
try {
  await launch();
  await app!.evaluate(({ dialog }, archive) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [archive] });
  }, archive);
  const install = await call('template.install', { token: (await call('template.inspect')).token });
  const instance = await call('template.create', { key: install.key });
  const other = await call('template.create', { key: install.key });
  await button('模板库').click();
  await button(`AI 来源核对 · ${instance.id.slice(0, 8)}`).click();
  await page.getByLabel('共享文本', { exact: true }).fill('未保存共享值');
  await button('打开 生成草稿').click();
  await page.getByLabel('主题', { exact: true }).fill('未保存的本次主题');
  await page.getByLabel('资料摘要', { exact: true }).fill('未保存的虚构资料摘要');
  await wait(async () => await button('去配置 DeepSeek').isEnabled(), 'resource load');
  assert.equal(await button('运行此入口').isDisabled(), true);
  await screenshot('entry-missing');
  await button('去配置 DeepSeek').click();
  await page.getByRole('heading', { name: 'AI 服务', exact: true }).waitFor();
  await page.getByLabel('API Key', { exact: true }).fill('fictional-template-key-2K8M');
  await page.getByLabel('模型 ID', { exact: true }).fill('fixture-template-model');
  await button('← 返回模板入口').click();
  await button('继续编辑').click();
  assert.equal(
    await page.getByLabel('API Key', { exact: true }).inputValue(),
    'fictional-template-key-2K8M',
  );
  await app!.evaluate(({ safeStorage }) => {
    (globalThis as any).encryptOriginal = safeStorage.encryptStringAsync;
    safeStorage.encryptStringAsync = async () => {
      throw new Error('fixture protected write failed');
    };
  });
  await button('← 返回模板入口').click();
  await button('保存并离开').click();
  await page.getByRole('dialog').getByRole('alert').waitFor();
  assert.equal(
    await page.getByLabel('API Key', { exact: true }).inputValue(),
    'fictional-template-key-2K8M',
  );
  assert.equal((await call('ai.configuration.get', { provider: 'deepseek' })).configured, false);
  await app!.evaluate(({ safeStorage }) => {
    safeStorage.encryptStringAsync = (globalThis as any).encryptOriginal;
  });
  await button('继续编辑').click();
  await button('保存配置').click();
  await wait(
    async () => (await call('ai.configuration.get', { provider: 'deepseek' })).configured,
    'configuration save',
  );
  await button('返回模板入口').click();
  await wait(async () => await button('管理 AI 配置').isEnabled(), 'return to template');
  assert.equal(await page.getByLabel('主题', { exact: true }).inputValue(), '未保存的本次主题');
  assert.equal(
    await page.getByLabel('资料摘要', { exact: true }).inputValue(),
    '未保存的虚构资料摘要',
  );
  const before = await call('template.detail', { id: instance.id });
  assert.equal(before.instance.configuration.shared, '原始共享值');
  assert.deepEqual(before.instance.resources, {});
  assert.equal(before.entries.find((e: any) => e.id === 'draft').values.topic, '原始主题');
  assert.equal((await call('bootstrap')).runs.length, 0);
  assert.equal(requests, 0);
  assert.match(await page.locator('.template-entry-resources').innerText(), /2K8M/);
  note(
    'same instance, entry and unsaved shared/input retained; protected save failure stays; return performs no template mutation, HTTP or run',
  );
  await screenshot('entry-configured');
  await size(1040);
  await button('管理 AI 配置').scrollIntoViewIfNeeded();
  const sourceScroll = await page.locator('main').evaluate((e) => e.scrollTop);
  assert.ok(sourceScroll > 0);
  await button('管理 AI 配置').click();
  await button('← 返回模板入口').click();
  await wait(async () => await button('管理 AI 配置').isEnabled(), 'narrow source return');
  assert.equal(await page.locator('main').evaluate((e) => e.scrollTop), sourceScroll);
  await size(1440);
  await button('使用 DeepSeek · fixture-template-model').click();
  await button('保存实例配置').click();
  await button('保存入口参数').click();
  await wait(async () => await button('运行此入口').isEnabled(), 'saved entry readiness');
  const saved = await call('template.detail', { id: instance.id });
  assert.equal(saved.instance.configuration.shared, '未保存共享值');
  assert.deepEqual(saved.instance.resources.model, {
    provider: 'deepseek',
    model: 'fixture-template-model',
  });
  assert.equal(saved.entries.find((e: any) => e.id === 'draft').values.topic, '未保存的本次主题');
  assert.deepEqual((await call('template.detail', { id: other.id })).instance.resources, {});
  assert.equal((await call('bootstrap')).runs.length, 0);
  assert.equal(requests, 0);
  note(
    'binding requires explicit use and save, both drafts persist independently and another instance remains unchanged',
  );
  await button('管理 AI 配置').click();
  await screenshot('settings-template');
  await button('替换 Key').click();
  await page
    .getByPlaceholder('输入新 Key，留空则保留原 Key')
    .fill('fictional-discard-template-key');
  await button('← 返回模板入口').click();
  await button('不保存离开').click();
  await wait(async () => await button('管理 AI 配置').isEnabled(), 'discard return');
  assert.equal((await call('ai.configuration.get', { provider: 'deepseek' })).tail, '2K8M');
  // A transient source failure must retain the draft; a changed entry identity must not redirect or allow running.
  await page.getByLabel('主题', { exact: true }).fill('返回失效时保留的输入');
  await button('管理 AI 配置').click();
  await writeFile(faultPath, 'unavailable');
  await button('返回模板入口').click();
  await page.getByRole('alert').waitFor();
  assert.equal(await button('运行此入口').isDisabled(), true);
  assert.equal(await page.getByLabel('主题', { exact: true }).inputValue(), '返回失效时保留的输入');
  await writeFile(faultPath, 'identity');
  await button('重新读取状态').click();
  await page.getByText('原实例或入口已变化。当前输入仍保留，不会自动打开另一个入口。').waitFor();
  assert.equal(await button('运行此入口').isDisabled(), true);
  await writeFile(faultPath, '');
  await button('重新读取状态').click();
  await wait(async () => await button('管理 AI 配置').isEnabled(), 'source recovery');
  assert.equal(await page.getByLabel('主题', { exact: true }).inputValue(), '返回失效时保留的输入');
  assert.equal(requests, 0);
  assert.equal((await call('bootstrap')).runs.length, 0);
  note(
    'discard retains key; transient/changed source blocks writes and run while retaining input, retry restores same entry',
  );
  await button('← 返回模板库').click();
  await button(`AI 来源核对 · ${other.id.slice(0, 8)}`).click();
  await button('打开 只读查看').click();
  await wait(
    async () => await button('运行此入口').isEnabled(),
    'read-only entry must not depend on AI',
  );
  assert.match(await page.locator('.template-entry-resources').innerText(), /此入口不需要 AI/);
  assert.equal(await button('去配置 DeepSeek').count(), 0);
  await button('运行此入口').click();
  await wait(
    async () => (await call('bootstrap')).runs[0]?.state === 'SUCCEEDED',
    'real read-only Worker',
  );
  const run = (await call('bootstrap')).runs[0];
  assert.equal(run.flowId, other.entryFlows.read);
  assert.equal(requests, 0);
  note('entry without AI runs via real Worker despite unbound required AI in another entry');
  await close();
  await launch();
  assert.equal((await call('bootstrap')).runs.length, 1);
  assert.equal(requests, 0);
  await button('模板库').click();
  await button(`AI 来源核对 · ${instance.id.slice(0, 8)}`).click();
  await button('打开 生成草稿').click();
  await wait(async () => await button('管理 AI 配置').isEnabled(), 'reopen entry');
  assert.equal(await page.getByLabel('主题', { exact: true }).inputValue(), '未保存的本次主题');
  assert.match(await page.locator('.template-entry-resources').innerText(), /2K8M/);
  assert.equal(requests, 0);
  await close();
  note(
    'reopen reads saved source and protected mask offline, neither unsaved draft nor prior run is replayed; all GUI sessions closed serially',
  );
  assert.deepEqual(evidence.pageErrors ?? [], []);
  evidence.passed = true;
} finally {
  try {
    await close();
  } finally {
    evidence.requests = requests;
    await mkdir('test-results/figma', { recursive: true });
    await writeFile(
      'test-results/figma/template-ai-summary.json',
      JSON.stringify(evidence, null, 2),
    );
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    console.log(JSON.stringify(evidence));
  }
}
