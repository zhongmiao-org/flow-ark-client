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
const data = await mkdtemp('flowark-template-entry-ui-');
const appPath = await mkdtemp(resolve(`${debugEvidenceRoot()}/template-entry-app-`));
const faultPath = join(data, 'save-fault'),
  savesPath = join(data, 'save-calls');
const evidence: any = {
  passed: false,
  checks: [],
  layouts: [],
  sessions: [],
  data,
  boundary:
    'real Renderer/Main/Host and SQLite; save delay/failure and native chooser results are explicit fixtures; no real model request; real debug and manual Worker execution',
};
await cp('dist', join(appPath, 'dist'), { recursive: true });
await cp('contracts', join(appPath, 'contracts'), { recursive: true });
await writeFile(
  join(appPath, 'package.json'),
  JSON.stringify({ name: 'template-entry-fixture', version: '0.3.0', main: 'dist/main.cjs' }),
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
      name: 'explicit-plan-reply-fixture',
      setup(build) {
        build.onLoad({ filter: /src\/host\/runtime\.ts$/ }, async (args) => ({
          loader: 'ts',
          contents:
            (await readFile(args.path, 'utf8')) +
            `
const originalRequest = Runtime.prototype.request;
Runtime.prototype.request = async function(method, args = {}) {
  if (method === 'schedule.save') {
    const {appendFile, readFile} = await import('node:fs/promises');
    await appendFile(${JSON.stringify(savesPath)}, 'plan\\n');
    let mode=''; try {mode=await readFile(${JSON.stringify(faultPath)},'utf8');} catch {}
    if(mode==='failure')throw new Error('fixture schedule storage failed');
    while(mode==='hold'){await new Promise(r=>setTimeout(r,20));try{mode=await readFile(${JSON.stringify(faultPath)},'utf8');}catch{mode='';}}
  }
  return originalRequest.call(this,method,args);
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
    steps: [
      { id: 'read', type: 'value', version: 1, value: { $ref: 'params.topic' } },
      { id: 'last', type: 'value', version: 1, value: { $ref: 'params.topic' } },
    ],
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
  {
    ...first,
    id: 'archive',
    name: '整理输出',
    resources: ['output'],
    actions: ['write'],
    schedulable: false,
  },
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
  page.locator('.template-entry-host').getByLabel(name, { exact: true }).filter({ visible: true });
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
  for (const run of (await call('bootstrap')).runs)
    if (['QUEUED', 'RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING'].includes(run.state))
      await call('run.control', { id: run.id, action: 'cancel' });
  await until(async () => !(await call('bootstrap')).execution.active, 'owned run exit');
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
      cards: [...document.querySelectorAll('.template-schedule-columns > .ai-task-card')]
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
      assert.equal(layout.cards[1].x, 952);
      assert.equal(layout.cards[0].y, 230);
      assert.equal(layout.cards[0].width, 672);
      assert.equal(layout.cards[1].width, 456);
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
  await app!.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, zip);
  const installed = await call('template.install', {
    token: (await call('template.inspect')).token,
  });
  const a = await call('template.create', { key: installed.key }),
    b = await call('template.create', { key: installed.key });
  await button('模板库').click();
  await button(`通用多入口实例 · ${a.id.slice(0, 8)}`).click();
  await openEntry('read');
  await until(async () => button('逐步调试').isEnabled(), 'source readiness');
  assert.equal(await page.getByText('此入口还没有运行记录。', { exact: true }).count(), 1);
  await button('逐步调试').click();
  await page.getByLabel('调试位置').getByText('下一步：read', { exact: true }).waitFor();
  const run = (await call('bootstrap')).runs[0];
  assert.equal(run.flowId, a.entryFlows.read);
  assert.equal(run.debug, true);
  const paused = await call('run.detail', { id: run.id });
  assert.equal(paused.events.filter((e: any) => e.type === 'node-start').length, 0);
  assert.equal(
    await page.locator('.sidebar nav [aria-current="page"]').getAttribute('aria-label'),
    '运行记录',
  );
  await button('← 返回模板入口').click();
  await until(
    async () => (await page.evaluate(() => document.activeElement?.textContent)) === '逐步调试',
    'debug source focus',
  );
  await until(async () => button('查看最近入口运行').isVisible(), 'recent active');
  assert.equal(await entry().getByLabel('操作入口', { exact: true }).inputValue(), 'read');
  assert.equal((await call('bootstrap')).runs.length, 1);
  await button('查看最近入口运行').click();
  await page.getByLabel('调试位置').getByText('下一步：read', { exact: true }).waitFor();
  await button('执行下一步').click();
  await page.getByLabel('调试位置').getByText('下一步：last', { exact: true }).waitFor();
  await button('继续').click();
  await until(
    async () => (await call('run.detail', { id: run.id })).run.state === 'SUCCEEDED',
    'debug completion',
  );
  await page.getByRole('tab', { name: '输出与产物', exact: true }).click();
  await page
    .getByLabel('运行输出')
    .getByText(/原始主题/)
    .waitFor();
  await button('← 返回运行详情').click();
  await page.keyboard.press('Alt+ArrowLeft');
  assert.equal((await call('bootstrap')).runs.length, 1);
  note(
    'real debug pauses before first node, steps and resumes to actual output; source return and active-result reopening neither cancel nor replay',
  );

  await entry().getByLabel('主题', { exact: true }).fill('暂存本次输入');
  await button('查看上次入口结果').click();
  await page
    .getByLabel('运行输出')
    .getByText(/原始主题/)
    .waitFor();
  await button('我的流程').click();
  await page.getByRole('dialog').waitFor();
  await button('继续编辑').click();
  assert.equal(await entry().getByLabel('主题', { exact: true }).inputValue(), '暂存本次输入');
  await button('保存入口参数').click();
  await until(async () => button('创建本机计划').isEnabled(), 'saved source');
  await entry().getByLabel('操作入口', { exact: true }).selectOption('archive');
  assert.equal(await button('创建本机计划').isDisabled(), true);
  await entry().getByLabel('操作入口', { exact: true }).selectOption('read');
  await until(async () => button('创建本机计划').isEnabled(), 'independent schedulable entry');
  note(
    'latest result is tied to the entry; result-to-sidebar uses the owner draft guard, and an unsupported entry cannot create plans',
  );

  await button('创建本机计划').click();
  await page.getByLabel('绑定入口').waitFor();
  assert.match(await page.getByLabel('绑定入口').inputValue(), new RegExp(a.id.slice(0, 8)));
  assert.equal((await call('bootstrap')).schedules.length, 0);
  assert.equal((await call('bootstrap')).runs.length, 1);
  await shot('schedule-create');
  assert.equal(
    await page.locator('.sidebar nav [aria-current="page"]').getAttribute('aria-label'),
    '本机计划',
  );
  await button('创建计划').click();
  await page.getByText('请确认固定当前已保存版本与入口。', { exact: true }).waitFor();
  await page.getByLabel('固定当前已保存版本与入口', { exact: true }).check();
  await page.getByLabel('创建间隔分钟').fill('90');
  await writeFile(faultPath, 'failure');
  await button('创建计划').click();
  await page
    .locator('.template-schedule-form')
    .getByRole('alert')
    .filter({ hasText: 'fixture schedule storage failed' })
    .waitFor();
  assert.equal(await page.getByLabel('创建间隔分钟').inputValue(), '90');
  assert.equal((await call('bootstrap')).schedules.length, 0);
  await button('← 返回模板入口').click();
  await page.getByRole('dialog').waitFor();
  await button('继续编辑').click();
  const calls = await countSaves();
  await writeFile(faultPath, 'hold');
  await button('创建计划').click();
  await until(async () => (await countSaves()) === calls + 1, 'one plan request');
  await page.keyboard.press('Escape');
  assert.equal(await button('创建计划').isDisabled(), true);
  await button('我的流程').click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await writeFile(faultPath, '');
  await page.getByRole('heading', { name: '计划已创建', exact: true }).waitFor();
  const plan = (await call('bootstrap')).schedules[0];
  assert.equal(plan.flowId, a.entryFlows.read);
  assert.equal(plan.intervalMinutes, 90);
  assert.equal(plan.enabled, true);
  assert.ok(plan.nextAt > Date.now() + 89 * 60000);
  assert.equal(await countSaves(), calls + 1);
  assert.equal((await call('bootstrap')).schedules.length, 1);
  assert.equal((await call('bootstrap')).runs.length, 1);
  await button('返回模板入口').click();
  await until(
    async () => (await page.evaluate(() => document.activeElement?.textContent)) === '创建本机计划',
    'plan source focus',
  );
  assert.equal(await entry().getByLabel('主题', { exact: true }).inputValue(), '暂存本次输入');
  note(
    'source plan opens without side effects; explicit confirmation, failed storage and busy navigation retain the form; one successful create fixes the entry with no immediate Run',
  );

  await button('创建本机计划').click();
  await button('取消').click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await button('创建本机计划').click();
  await page.getByLabel('创建间隔分钟').fill('91');
  await page.getByLabel('固定当前已保存版本与入口', { exact: true }).check();
  await button('我的流程').click();
  await button('保存并离开').click();
  await page.getByRole('heading', { name: '我的流程', exact: true }).waitFor();
  assert.equal((await call('bootstrap')).schedules.length, 2);
  assert.equal((await call('bootstrap')).runs.length, 1);
  await button('模板库').click();
  await button(`通用多入口实例 · ${a.id.slice(0, 8)}`).click();
  await openEntry('read');
  await until(async () => button('创建本机计划').isEnabled(), 'source reopened');
  await button('创建本机计划').click();
  await page.getByLabel('创建间隔分钟').fill('92');
  await page.getByLabel('固定当前已保存版本与入口', { exact: true }).check();
  const fresh = await call('template.detail', { id: a.id });
  await call('template.save', {
    id: a.id,
    revision: fresh.revision,
    name: fresh.instance.name,
    configuration: { ...fresh.instance.configuration, shared: '外部更改' },
    resources: fresh.instance.resources,
    grants: fresh.instance.grants,
    inputs: {},
  });
  await button('创建计划').click();
  await page.getByText('来源实例或入口已变化，请返回原入口重新核对。', { exact: true }).waitFor();
  assert.equal((await call('bootstrap')).schedules.length, 2);
  await button('← 返回模板入口').click();
  await button('不保存离开').click();
  await page.locator('.template-source-error').waitFor();
  await button('放弃未保存内容并重新读取实例').click();
  await until(async () => button('运行此入口').isEnabled(), 'fresh entry');
  note(
    'clean cancel is inert; save-and-leave reaches the requested module; actual competing instance save rejects plan creation and return preserves the original source error',
  );

  await button('← 返回模板库').click();
  await button(`通用多入口实例 · ${b.id.slice(0, 8)}`).click();
  await openEntry('read');
  await until(async () => button('运行此入口').isEnabled(), 'second instance');
  assert.equal(await page.getByText('此入口还没有运行记录。', { exact: true }).count(), 1);
  await button('运行此入口').click();
  await until(
    async () =>
      (await call('bootstrap')).runs.some(
        (r: any) => r.flowId === b.entryFlows.read && r.state === 'SUCCEEDED',
      ),
    'manual second entry',
  );
  await button('← 返回模板入口').click();
  await button('← 返回模板库').click();
  await button(`通用多入口实例 · ${a.id.slice(0, 8)}`).click();
  await openEntry('read');
  await until(async () => button('查看上次入口结果').isVisible(), 'first result');
  await button('查看上次入口结果').click();
  assert.match(await page.locator('.run-detail-heading').innerText(), new RegExp(run.id));
  assert.equal((await call('bootstrap')).runs.length, 2);
  note(
    'normal launch opens its actual Run; another instance never replaces this entry latest result',
  );
  for (const s of (await call('bootstrap')).schedules)
    await call('schedule.toggle', { id: s.id, enabled: false });
  await close();
  await launch();
  assert.equal((await call('bootstrap')).runs.length, 2);
  assert.equal((await call('bootstrap')).schedules.length, 2);
  assert.ok((await call('bootstrap')).schedules.every((s: any) => !s.enabled));
  await close();
  assert.deepEqual(evidence.pageErrors ?? [], []);
  note(
    'reopen retains the two real runs and fixed plans offline without replay; both GUI sessions have exited',
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
    `${debugEvidenceRoot()}/figma/template-entry-summary.json`,
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence));
}
