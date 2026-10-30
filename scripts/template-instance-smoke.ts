import { debugMkdtemp as mkdtemp, debugEvidenceRoot } from '../src/host/debug-files.mjs';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import electronPath from 'electron';
import type { ElectronApplication, Page } from 'playwright-core';
import { desktopElectron, readDesktopMains } from './desktop-session.mjs';
import { exportDefinition } from '../src/templates/export';
import { writeArchive } from '../src/templates/archive';
import { canonical, sha256, manifestDigest } from '../contracts/package-format';
const data = await mkdtemp('flowark-template-instance-ui-');
const appPath = await mkdtemp(resolve(`${debugEvidenceRoot()}/template-instance-app-`));
const faultPath = join(data, 'save-fault'),
  savesPath = join(data, 'save-calls');
const evidence: any = {
  passed: false,
  checks: [],
  layouts: [],
  sessions: [],
  data,
  boundary:
    'real Renderer/Main/Host and SQLite; save delay/failure and native chooser results are explicit fixtures; no model or workflow execution',
};
await cp('dist', join(appPath, 'dist'), { recursive: true });
await cp('contracts', join(appPath, 'contracts'), { recursive: true });
await writeFile(
  join(appPath, 'package.json'),
  JSON.stringify({ name: 'template-instance-fixture', version: '0.3.0', main: 'dist/main.cjs' }),
);
await writeFile(savesPath, '');
await build({
  entryPoints: ['src/host/entry.ts'],
  outfile: join(appPath, 'dist/host.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  packages: 'external',
  plugins: [
    {
      name: 'explicit-save-response-fixture',
      setup(build) {
        build.onLoad({ filter: /src\/templates\/service\.ts$/ }, async (args) => ({
          loader: 'ts',
          contents:
            (await readFile(args.path, 'utf8')) +
            `
const originalSave = Templates.prototype.save;
Templates.prototype.save = async function(args) {
  const {appendFile} = await import('node:fs/promises');
  await appendFile(${JSON.stringify(savesPath)}, JSON.stringify({id: args.id, inputs: Object.keys(args.inputs)}) + '\\n');
  let mode = ''; try { mode = await readFile(${JSON.stringify(faultPath)}, 'utf8'); } catch {}
  if (mode === 'failure') throw new Error('fixture template storage reply failed');
  while (mode === 'hold') { await new Promise(r => setTimeout(r, 20)); try { mode = await readFile(${JSON.stringify(faultPath)}, 'utf8'); } catch { mode = ''; } }
  return originalSave.call(this, args);
};`,
        }));
      },
    },
  ],
});
const pkg = await exportDefinition(
  {
    id: 'fixture',
    name: '通用多入口实例',
    description: '虚构字段与本机选择夹具',
    formatVersion: '1.0',
    parameters: { topic: '原始主题', summary: '原始资料', count: 0 },
    requiredCapabilities: ['value'],
    steps: [{ id: 'read', type: 'value', version: 1, value: { $ref: 'params.topic' } }],
  } as any,
  {
    schema: {
      type: 'object',
      properties: {
        shared: { type: 'string', title: '共享文本', default: '原始共享值' },
        label: { type: 'string', title: '字段标签', default: '原始标签' },
        enabled: { type: 'boolean', title: '启用选项', default: false },
      },
      required: ['shared', 'label', 'enabled'],
      additionalProperties: false,
    },
  },
);
const first = pkg.manifest.entries[0];
pkg.files.set(
  first.inputSchema,
  Buffer.from(
    JSON.stringify({
      type: 'object',
      properties: {
        count: { type: 'integer', title: '次数', default: 0 },
        topic: { type: 'string', title: '主题', default: '原始主题' },
        summary: { type: 'string', title: '资料摘要', default: '原始资料', maxLength: 2000 },
      },
      required: ['topic', 'summary', 'count'],
      additionalProperties: false,
    }),
  ),
);
const flow = JSON.parse(pkg.files.get(first.flow)!.toString());
flow.parameters = { topic: '原始主题', summary: '原始资料', count: 0 };
pkg.files.set(first.flow, Buffer.from(canonical(flow)));
pkg.manifest.resources = [
  { id: 'output', name: '输出目录', kind: 'directory', access: 'write', required: true },
  { id: 'model', name: 'AI 资源', kind: 'ai', access: 'use', required: false },
];
pkg.manifest.actions = [
  { id: 'write', name: '写入输出', description: '虚构动作声明，不在此验证中执行', default: 'deny' },
];
pkg.manifest.entries = [
  { ...first, id: 'read', name: '只读查看', resources: [], actions: [] },
  { ...first, id: 'archive', name: '整理输出', resources: ['output'], actions: ['write'] },
];
const seal = () => {
  pkg.manifest.files = [...pkg.files]
    .filter(([path]) => path !== 'manifest.json')
    .map(([path, bytes]) => ({ path, size: bytes.length, sha256: sha256(bytes) }));
  pkg.manifest.contentDigest = manifestDigest(pkg.manifest);
  pkg.files.set('manifest.json', Buffer.from(canonical(pkg.manifest)));
};
seal();
const zip = join(data, 'fixture.zip');
await writeArchive(pkg, zip);
pkg.manifest.version = '2.0.0';
seal();
const zip2 = join(data, 'fixture-v2.zip');
await writeArchive(pkg, zip2);
let app: ElectronApplication | undefined, page!: Page;
const button = (name: string) => page.getByRole('button', { name, exact: true });
const field = (name: string) =>
  page
    .locator('.template-instance-host')
    .getByLabel(name, { exact: true })
    .filter({ visible: true });
const entry = () => page.locator('.template-entry-pane:visible');
const call = (method: string, args: any = {}): Promise<any> =>
  page.evaluate(({ method, args }) => window.flowark.request(method, args), { method, args });
const note = (text: string) => {
  evidence.checks.push(text);
  console.log('PASS ' + text);
};
const until = async (fn: () => Promise<any>, label: string) => {
  for (let i = 0; i < 150; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('wait failed: ' + label);
};
const countSaves = async () =>
  (await readFile(savesPath, 'utf8')).trim().split('\n').filter(Boolean).length;
async function launch() {
  app = await desktopElectron.launch({
    executablePath: String(electronPath),
    args: [appPath],
    env: { ...process.env, FLOWARK_DATA_DIR: join(data, 'user') },
  });
  evidence.sessions.push({ pid: app.process().pid, closed: false });
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => (evidence.pageErrors ??= []).push(error.message));
  await page.waitForFunction(() => Boolean(window.flowark));
  await resize(1440);
}
async function close() {
  if (!app) return;
  await app.close();
  evidence.sessions.at(-1).closed = true;
  app = undefined;
  assert.deepEqual(readDesktopMains(), []);
}
async function resize(width: number) {
  await app!.evaluate(
    ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 1080),
    width,
  );
  await page.waitForFunction((width) => innerWidth === width, width);
  await page.evaluate(() => document.fonts.ready);
}
async function shot(name: string) {
  for (const width of [1440, 1920, 1040]) {
    await resize(width);
    await page.evaluate(async () => {
      await new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      );
      await Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      );
    });
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      cards: [...document.querySelectorAll('.template-instance-columns > .ai-task-card')]
        .filter((e) => (e as HTMLElement).offsetParent)
        .map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }),
    }));
    assert.equal(layout.overflow, false);
    assert.equal(layout.cards.length, 2);
    if (width === 1440) {
      assert.equal(layout.cards[0].x, 256);
      assert.equal(layout.cards[1].x, 1008);
      assert.equal(layout.cards[0].y, 294);
      assert.equal(layout.cards[0].width, 728);
      assert.equal(layout.cards[1].width, 400);
      assert.ok(layout.cards.every((card) => card.height >= 652));
    }
    if (width === 1040) assert.equal(layout.cards[0].width, 904);
    evidence.layouts.push({ name, width, ...layout });
    await page.screenshot({ path: join(data, `${name}-${width}.png`) });
  }
  await resize(1440);
}
async function openEntry(id: string) {
  await button('操作入口').click();
  await entry().getByLabel('操作入口', { exact: true }).selectOption(id);
}
try {
  await launch();
  const install = async (path: string) => {
    await app!.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, path);
    return call('template.install', { token: (await call('template.inspect')).token });
  };
  const installed = await install(zip),
    newer = await install(zip2);
  const a = await call('template.create', { key: installed.key }),
    b = await call('template.create', { key: installed.key });
  const baseline = await call('template.detail', { id: a.id });
  await button('模板库').click();
  await button(`通用多入口实例 · ${a.id.slice(0, 8)}`).click();
  await until(async () => button('保存配置').isEnabled(), 'initial source');
  await shot('configuration');
  await field('实例名称').fill('本地草稿实例');
  await field('共享文本').fill('本地共享草稿');
  await button('资源与动作授权').click();
  await app!.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await button('选择目录').click();
  assert.equal(await field('输出目录').inputValue(), '');
  assert.equal(await field('写入输出授权').inputValue(), 'deny');
  await field('AI 资源供应商').selectOption('deepseek');
  await field('AI 资源供应商').selectOption('');
  const directory = join(data, 'output');
  await mkdir(directory);
  await app!.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, directory);
  await button('选择目录').click();
  await until(async () => (await field('输出目录').inputValue()) === directory, 'directory draft');
  assert.equal(await field('写入输出授权').inputValue(), 'deny');
  await button('每次确认').click();
  await shot('resources');
  await button('管理 AI 配置').click();
  await button('← 返回实例授权').click();
  assert.equal(await field('输出目录').inputValue(), directory);
  assert.equal(await field('写入输出授权').inputValue(), 'confirm');
  await button('管理 AI 配置').click();
  await button('我的流程').click();
  await page.getByRole('dialog').waitFor();
  await button('继续编辑').click();
  assert.equal(await field('写入输出授权').inputValue(), 'confirm');
  await openEntry('read');
  await entry().getByLabel('主题', { exact: true }).fill('第一入口草稿');
  await entry().getByLabel('操作入口', { exact: true }).selectOption('archive');
  await entry().getByLabel('主题', { exact: true }).fill('第二入口草稿');
  await entry().getByLabel('操作入口', { exact: true }).selectOption('read');
  assert.equal(await entry().getByLabel('主题', { exact: true }).inputValue(), '第一入口草稿');
  await entry().getByLabel('次数', { exact: true }).fill('');
  await button('共享配置').click();
  await button('取消更改').click();
  await field('实例名称').fill('本地草稿实例');
  await field('共享文本').fill('本地共享草稿');
  await openEntry('read');
  assert.equal(await entry().getByLabel('次数', { exact: true }).inputValue(), '');
  await button('← 返回模板库').click();
  await button('保存并离开').click();
  await page.getByRole('dialog').getByText('请先修正未完成的字段值，其他草稿仍保留。').waitFor();
  await button('继续编辑').click();
  await entry().getByLabel('次数', { exact: true }).fill('2');
  await button('来源与版本').click();
  await shot('source');
  assert.equal(await page.getByLabel('采用模板版本').locator('option').count(), 2);
  assert.deepEqual(await call('template.detail', { id: a.id }), baseline);
  note(
    'four tabs retain shared/resource/action and multiple entry drafts; cancelled chooser does not bind or grant; AI subtask returns to authorization; three-size layouts',
  );
  await button('共享配置').click();
  await field('共享文本').focus();
  await button('我的流程').click();
  await page.getByRole('dialog').waitFor();
  await button('继续编辑').click();
  await until(
    async () => field('共享文本').evaluate((el) => el === document.activeElement),
    'restored field focus',
  );
  assert.equal(await field('共享文本').inputValue(), '本地共享草稿');
  await writeFile(faultPath, 'failure');
  await page.getByRole('link', { name: '模板库', exact: true }).click();
  await button('保存并离开').click();
  await page.getByRole('dialog').getByRole('alert').waitFor();
  assert.deepEqual(await call('template.detail', { id: a.id }), baseline);
  await writeFile(faultPath, 'hold');
  const beforeSave = await countSaves();
  await button('保存并离开').click();
  await until(async () => await button('保存并离开').isDisabled(), 'save in progress');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 1);
  assert.equal(await countSaves(), beforeSave + 1);
  await writeFile(faultPath, '');
  await page.getByRole('heading', { name: '模板库', exact: true }).waitFor();
  const saved = await call('template.detail', { id: a.id });
  assert.equal(saved.instance.name, '本地草稿实例');
  assert.equal(saved.instance.configuration.shared, '本地共享草稿');
  assert.equal(saved.instance.resources.output.path, directory);
  assert.equal(saved.instance.resources.model, undefined);
  assert.equal(saved.instance.grants.write, 'confirm');
  assert.deepEqual(
    saved.entries.map((e: any) => e.values.topic),
    ['第一入口草稿', '第二入口草稿'],
  );
  assert.equal(await countSaves(), beforeSave + 1);
  assert.equal((await call('bootstrap')).runs.length, 0);
  note(
    'all dirty fields save in one request; failure retains source and original breadcrumb destination; busy Escape cannot abandon save; continue restores field focus',
  );
  await button(`本地草稿实例 · ${a.id.slice(0, 8)}`).click();
  await openEntry('read');
  await until(async () => await button('运行此入口').isEnabled(), 'clean saved entry');
  await entry().getByLabel('次数', { exact: true }).fill('');
  await until(
    async () => await button('运行此入口').isDisabled(),
    'incomplete number blocks execution',
  );
  assert.equal((await call('bootstrap')).runs.length, 0);
  await entry().getByLabel('次数', { exact: true }).fill('2');
  await until(async () => await button('运行此入口').isEnabled(), 'restored saved number');
  await button('共享配置').click();
  await field('共享文本').fill('仍未保存的配置');
  await button('资源与动作授权').click();
  await button('配置范围内自动').click();
  await button('保存授权').click();
  await until(
    async () => (await call('template.detail', { id: a.id })).instance.grants.write === 'auto',
    'resource-only save',
  );
  await button('共享配置').click();
  assert.equal(await field('共享文本').inputValue(), '仍未保存的配置');
  assert.equal(
    (await call('template.detail', { id: a.id })).instance.configuration.shared,
    '本地共享草稿',
  );
  await button('← 返回模板库').click();
  await button('不保存离开').click();
  await button(`本地草稿实例 · ${a.id.slice(0, 8)}`).click();
  assert.equal(await field('共享文本').inputValue(), '本地共享草稿');
  await field('共享文本').fill('切换实例时放弃');
  await button('查看其他实例').click();
  await button(`通用多入口实例 · ${b.id.slice(0, 8)}`).click();
  await button('继续编辑').click();
  await button(`通用多入口实例 · ${b.id.slice(0, 8)}`).click();
  await button('不保存离开').click();
  await page.getByRole('heading', { name: '通用多入口实例', exact: true }).waitFor();
  assert.equal(await field('共享文本').inputValue(), '原始共享值');
  await button('← 返回模板库').click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await button(`本地草稿实例 · ${a.id.slice(0, 8)}`).click();
  await field('共享文本').fill('键盘离开草稿');
  await button('共享配置').click();
  await page.keyboard.press('Alt+ArrowLeft');
  await button('不保存离开').click();
  await page.getByRole('heading', { name: '模板库', exact: true }).waitFor();
  note(
    'authorization save preserves config draft; back and instance switch discard only unsaved fields; clean return is immediate; application keyboard back shares the guard',
  );
  await button(`本地草稿实例 · ${a.id.slice(0, 8)}`).click();
  await field('共享文本').fill('侧栏完整保存');
  await button('我的流程').click();
  await button('保存并离开').click();
  await page.getByRole('heading', { name: '我的流程', exact: true }).waitFor();
  assert.equal(
    (await call('template.detail', { id: a.id })).instance.configuration.shared,
    '侧栏完整保存',
  );
  await button('模板库').click();
  await button(`本地草稿实例 · ${a.id.slice(0, 8)}`).click();
  await field('共享文本').fill('冲突仍保留');
  const fresh = await call('template.detail', { id: a.id });
  await call('template.save', {
    id: a.id,
    revision: fresh.revision,
    name: fresh.instance.name,
    configuration: { ...fresh.instance.configuration, shared: '外部新配置' },
    resources: fresh.instance.resources,
    grants: fresh.instance.grants,
    inputs: {},
  });
  await button('资源与动作授权').click();
  await button('管理 AI 配置').click();
  await button('← 返回实例授权').click();
  await page.locator('.template-source-error').waitFor();
  assert.equal(await button('保存授权').isDisabled(), true);
  await button('共享配置').click();
  assert.equal(await field('共享文本').inputValue(), '冲突仍保留');
  assert.equal(await button('保存配置').isDisabled(), true);
  await button('来源与版本').click();
  assert.equal(await button('创建新版实例').isDisabled(), true);
  await button('放弃未保存内容并重新读取实例').click();
  await button('共享配置').click();
  await until(async () => await button('保存配置').isEnabled(), 'source reload');
  assert.equal(await field('共享文本').inputValue(), '外部新配置');
  note(
    'sidebar save reaches the requested module; changed source blocks writes across every tab and explicit reload is required without losing the draft implicitly',
  );
  await field('共享文本').fill('为新版保存');
  await button('来源与版本').click();
  await page.getByLabel('采用模板版本').selectOption(newer.key);
  await button('创建新版实例').click();
  await button('保存并离开').click();
  await until(async () => (await call('bootstrap')).instances.length === 3, 'new isolated version');
  const created = (await call('bootstrap')).instances.find((i: any) => i.packageKey === newer.key);
  await page.getByRole('heading', { name: '通用多入口实例', exact: true }).waitFor();
  const newDetail = await call('template.detail', { id: created.id });
  assert.equal(newDetail.instance.configuration.shared, '为新版保存');
  assert.deepEqual(newDetail.instance.resources, {});
  assert.equal(newDetail.instance.grants.write, 'deny');
  assert.deepEqual(
    newDetail.entries.map((e: any) => e.values.topic),
    ['原始主题', '原始主题'],
  );
  assert.equal((await call('template.detail', { id: a.id })).instance.packageKey, installed.key);
  assert.equal((await call('bootstrap')).runs.length, 0);
  note(
    'adopting another installed version uses the leave guard, creates an isolated instance, and leaves old version and inputs unchanged',
  );
  await close();
  await launch();
  assert.equal((await call('bootstrap')).instances.length, 3);
  assert.equal((await call('bootstrap')).runs.length, 0);
  assert.equal(
    (await call('template.detail', { id: a.id })).instance.configuration.shared,
    '为新版保存',
  );
  await close();
  assert.deepEqual(evidence.pageErrors ?? [], []);
  note(
    'reopen retains three instances and zero runs; every desktop main exits before the next launch',
  );
  evidence.passed = true;
} catch (error) {
  if (page) await page.screenshot({ path: join(data, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await writeFile(faultPath, '').catch(() => {});
  await close();
  await mkdir(`${debugEvidenceRoot()}/figma`, { recursive: true });
  await writeFile(
    `${debugEvidenceRoot()}/figma/template-instance-summary.json`,
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence));
}
