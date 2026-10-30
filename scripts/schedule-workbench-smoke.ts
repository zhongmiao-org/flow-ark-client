import { debugMkdtemp as mkdtemp, debugEvidenceRoot } from '../src/host/debug-files.mjs';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import electronPath from 'electron';
import type { ElectronApplication, Page } from 'playwright-core';
import { desktopElectron, readDesktopMains } from './desktop-session.mjs';
const data = await mkdtemp('flowark-schedule-workbench-ui-');
const appPath = await mkdtemp(resolve(`${debugEvidenceRoot()}/schedule-workbench-app-`));
const modeFile = join(data, 'mode'),
  callsFile = join(data, 'calls');
const evidence: any = {
  passed: false,
  checks: [],
  layouts: [],
  sessions: [],
  data,
  boundary:
    'real Renderer/Main/Host/SQLite/Worker; saved failure/delay and older log rows are explicit fixtures; due-time injection tests state presentation, not wall-clock timing',
};
await cp('dist', join(appPath, 'dist'), { recursive: true });
await cp('contracts', join(appPath, 'contracts'), { recursive: true });
await writeFile(
  join(appPath, 'package.json'),
  JSON.stringify({ name: 'schedule-workbench-fixture', version: '0.3.0', main: 'dist/main.cjs' }),
);
await writeFile(callsFile, '');
await writeFile(modeFile, '');
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
      name: 'explicit-schedule-fixtures',
      setup(build) {
        build.onLoad({ filter: /src\/host\/runtime\.ts$/ }, async (args) => ({
          loader: 'ts',
          contents:
            (await readFile(args.path, 'utf8')) +
            `
const requestBeforeFixture = Runtime.prototype.request;
Runtime.prototype.request = async function(method, args = {}) {
 const {readFile,writeFile,appendFile} = await import('node:fs/promises');
 let mode=''; try {mode=await readFile(${JSON.stringify(modeFile)},'utf8');}catch{}
 if(method==='schedule.save'||method==='schedule.update'){
  await appendFile(${JSON.stringify(callsFile)},method+'\\n');
  if(mode==='failure')throw new Error('fixture schedule save failed');
  while(mode==='hold'){await new Promise(r=>setTimeout(r,20));try{mode=await readFile(${JSON.stringify(modeFile)},'utf8');}catch{mode='';}}
 }
 if(method==='schedule.inspect'){
  if(mode==='read-failure')throw new Error('fixture schedule read failed');
  if(mode==='logs'){
   await writeFile(${JSON.stringify(modeFile)},'');
   for(let i=0;i<45;i++){
    this.store.put('schedule-log','fixture-'+i,{scheduleId:args.id,reason:i%2?'occupied':'application-restart',time:Date.now()-i*60000});
    this.store.put('schedule-log','other-fixture-'+i,{scheduleId:'unrelated',reason:'unrelated-secret',time:Date.now()});
   }
  }
  if(mode==='tick'){
   await writeFile(${JSON.stringify(modeFile)},'');
   const plan=this.store.get('schedule',args.id);this.store.put('schedule',args.id,{...plan,nextAt:Date.now()-1});
   this.lastTick=Date.now();await this.tick();
  }
 }
 return requestBeforeFixture.call(this,method,args);
};`,
        }));
      },
    },
  ],
});
let app: ElectronApplication | undefined, page!: Page;
const call = (method: string, args: any = {}): Promise<any> =>
  page.evaluate(({ method, args }) => window.flowark.request(method, args), { method, args });
const button = (name: string) => page.getByRole('button', { name, exact: true });
const form = () => page.getByRole('form', { name: '编辑本机计划', exact: true });
const guard = () => page.getByRole('dialog', { name: '保存计划更改再离开？', exact: true });
const history = () => page.getByRole('dialog', { name: /计划记录/ });
const note = (text: string) => {
  evidence.checks.push(text);
  console.log('PASS ' + text);
};
async function until(fn: () => Promise<boolean>, message: string) {
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(message);
}
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
  await page.waitForFunction(() => !!window.flowark);
  await resize(1440);
}
async function close() {
  if (!app) return;
  const boot = await call('bootstrap');
  for (const plan of boot.schedules)
    if (plan.enabled) await call('schedule.toggle', { id: plan.id, enabled: false });
  for (const run of boot.runs)
    if (!['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(run.state))
      await call('run.control', { id: run.id, action: 'cancel' });
  await until(async () => !(await call('bootstrap')).execution.active, 'owned worker exit');
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
          .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      );
      document.querySelector('main')?.scrollTo(0, 0);
    });
    const layout = await page.evaluate(() => ({
      overflow:
        document.querySelector('.schedules-page')!.scrollWidth >
        document.querySelector('.schedules-page')!.clientWidth,
      cards: [...document.querySelectorAll('.schedule-workbench > .ai-task-card')].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    }));
    assert.equal(layout.overflow, false);
    if (width === 1440) {
      assert.equal(layout.cards[0].width, 672);
      assert.equal(layout.cards[1].width, 456);
      assert.equal(layout.cards[0].y, 230);
      assert.equal(layout.cards[1].x - layout.cards[0].x - layout.cards[0].width, 24);
    }
    if (width === 1040) {
      assert.equal(layout.cards[0].width, 904);
      assert.equal(layout.cards[1].width, 904);
      assert.ok(layout.cards[1].y > layout.cards[0].y);
    }
    evidence.layouts.push({ name, width, ...layout });
    await page.screenshot({ path: join(data, `${name}-${width}.png`) });
  }
  await resize(1440);
}
const counts = async () =>
  (await readFile(callsFile, 'utf8')).trim().split('\n').filter(Boolean).length;
let firstId = '',
  secondId = '';
const plan = async (id = firstId) =>
  (await call('bootstrap')).schedules.find((item: any) => item.id === id);
const editPlan = async (id = firstId) => {
  await page
    .locator(`[data-schedule-id="${id}"]`)
    .getByRole('button', { name: '编辑计划', exact: true })
    .click();
  await form().waitFor();
};
try {
  await launch();
  const first = await call('flow.create');
  const original = await call('flow.save', {
    flow: {
      ...first.flow,
      name: '固定来源 A',
      steps: [
        { id: 'value', type: 'value', version: 1, value: 'old' },
        { id: 'human', type: 'human', version: 1, message: '虚构只读暂停' },
      ],
    },
    bindings: { files: {}, credentials: [] },
  });
  const second = await call('flow.create');
  await call('flow.save', {
    flow: { ...second.flow, name: '固定来源 B' },
    bindings: { files: {}, credentials: [] },
  });
  await button('本机计划').click();
  await page
    .getByLabel('计划流程', { exact: true })
    .getByRole('option', { name: /固定来源 A/ })
    .waitFor({ state: 'attached' });
  await page.getByLabel('计划流程', { exact: true }).selectOption(first.id);
  await button('创建计划').click();
  await page.getByRole('alert').filter({ hasText: '请选择已保存' }).waitFor();
  assert.equal((await call('bootstrap')).schedules.length, 0);
  await page.getByLabel('固定当前已保存版本与入口', { exact: true }).check();
  await button('创建计划').click();
  await until(async () => (await call('bootstrap')).schedules.length === 1, 'created');
  firstId = (await call('bootstrap')).schedules[0].id;
  assert.equal((await call('bootstrap')).runs.length, 0);
  await button('暂停计划').click();
  await until(async () => !(await plan()).enabled, 'paused');
  await call('flow.save', {
    flow: { ...original.flow, name: '当前来源 A 已更新' },
    bindings: original.bindings,
  });
  await editPlan();
  assert.equal(
    await page.getByLabel('采用当前已保存的流程版本', { exact: true }).isChecked(),
    false,
  );
  await form()
    .getByText(new RegExp(original.updatedAt.slice(0, 4)))
    .first()
    .waitFor();
  const before = await plan();
  const fixed = await call('schedule.inspect', { id: firstId });
  assert.equal(fixed.version.name, '固定来源 A');
  await shot('plan-edit');
  await page.getByLabel('计划间隔分钟', { exact: true }).fill('75');
  await button('本地设置').click();
  await guard().waitFor();
  await guard().getByRole('button', { name: '继续编辑', exact: true }).click();
  await until(
    () =>
      page
        .getByLabel('计划间隔分钟', { exact: true })
        .evaluate((el) => el === document.activeElement),
    'form focus',
  );
  assert.equal(await page.getByLabel('计划间隔分钟', { exact: true }).inputValue(), '75');
  await button('取消编辑').click();
  await guard().getByRole('button', { name: '不保存离开', exact: true }).click();
  assert.deepEqual(await plan(), before);
  note(
    'Figma two-column and compact layouts; creation requires confirmation and no immediate Run; original fixed version stays distinct; cancel and continue preserve saved state/focus',
  );
  await editPlan();
  await page.getByLabel('计划间隔分钟', { exact: true }).fill('77');
  await button('本地设置').click();
  await writeFile(modeFile, 'failure');
  await guard().getByRole('button', { name: '保存并离开', exact: true }).click();
  await guard().getByRole('alert').filter({ hasText: 'fixture schedule save failed' }).waitFor();
  assert.equal(await page.getByLabel('计划间隔分钟', { exact: true }).inputValue(), '77');
  assert.deepEqual(await plan(), before);
  await writeFile(modeFile, 'hold');
  const start = await counts();
  await guard().getByRole('button', { name: '保存并离开', exact: true }).click();
  await until(async () => (await counts()) === start + 1, 'one pending save');
  await page.keyboard.press('Escape');
  assert.equal(await guard().isVisible(), true);
  assert.equal(
    await guard().getByRole('button', { name: '不保存离开', exact: true }).isDisabled(),
    true,
  );
  await writeFile(modeFile, '');
  await page.getByRole('heading', { name: '连接你的本机能力', exact: true }).waitFor();
  assert.equal(await counts(), start + 1);
  assert.equal((await plan()).intervalMinutes, 77);
  assert.equal((await plan()).versionId, before.versionId);
  assert.equal((await plan()).enabled, false);
  note(
    'failed save retains input and original destination; busy Escape cannot abandon save; one successful save leaves to the requested module without changing fixed version or paused state',
  );
  await button('本机计划').click();
  await button('新建本机计划').click();
  await page.getByLabel('计划流程', { exact: true }).selectOption(second.id);
  await page.getByLabel('固定当前已保存版本与入口', { exact: true }).check();
  await button('创建计划').click();
  await until(async () => (await call('bootstrap')).schedules.length === 2, 'second created');
  secondId = (await call('bootstrap')).schedules.find((item: any) => item.id !== firstId).id;
  await call('schedule.toggle', { id: secondId, enabled: false });
  await editPlan();
  await page.getByLabel('计划间隔分钟', { exact: true }).fill('78');
  await page
    .locator(`[data-schedule-id="${secondId}"]`)
    .getByRole('button', { name: '编辑计划', exact: true })
    .click();
  await guard().getByRole('button', { name: '不保存离开', exact: true }).click();
  await until(
    () =>
      page
        .getByLabel('绑定入口', { exact: true })
        .inputValue()
        .then((value) => value === '固定来源 B'),
    'exact second plan',
  );
  assert.equal((await plan()).intervalMinutes, 77);
  await editPlan();
  await page.getByLabel('计划时区', { exact: true }).fill('Unknown/Zone');
  await button('保存计划').click();
  await form().getByRole('alert').filter({ hasText: '有效时区' }).waitFor();
  await page.getByLabel('计划时区', { exact: true }).fill('UTC');
  await call('schedule.toggle', { id: firstId, enabled: true });
  await form().getByRole('alert').filter({ hasText: '已改变' }).waitFor();
  assert.equal(await button('保存计划').isDisabled(), true);
  assert.equal(await page.getByLabel('计划时区', { exact: true }).inputValue(), 'UTC');
  await button('放弃更改并重新核对').click();
  await guard().getByRole('button', { name: '不保存离开', exact: true }).click();
  await form().waitFor();
  assert.equal(await button('保存计划').isDisabled(), false);
  note(
    'switching plans applies the same draft guard; validation and actual competing toggle preserve input and require explicit rechecking',
  );
  await writeFile(modeFile, 'logs');
  await button('查看错过 / 占用跳过').click();
  await until(
    async () => (await history().locator('.schedule-history-records article').count()) === 20,
    'first log page',
  );
  await history().getByRole('button', { name: '读取更早记录', exact: true }).click();
  await until(
    async () => (await history().locator('.schedule-history-records article').count()) === 40,
    'second log page',
  );
  await history().getByRole('button', { name: '读取更早记录', exact: true }).click();
  await until(
    async () => (await history().locator('.schedule-history-records article').count()) === 45,
    'last log page',
  );
  assert.equal(await history().getByText('unrelated-secret').count(), 0);
  await writeFile(modeFile, 'read-failure');
  await history().getByRole('button', { name: '刷新记录', exact: true }).click();
  await history().getByRole('alert').filter({ hasText: 'fixture schedule read failed' }).waitFor();
  assert.equal(await history().locator('.schedule-history-records article').count(), 45);
  await writeFile(modeFile, 'tick');
  await history().getByRole('button', { name: '刷新记录', exact: true }).click();
  await until(
    async () =>
      (await call('bootstrap')).runs.some(
        (r: any) => r.scheduleId === firstId && r.state === 'WAITING_INPUT',
      ),
    'real planned Worker wait',
  );
  await writeFile(modeFile, 'tick');
  await history().getByRole('button', { name: '刷新记录', exact: true }).click();
  await history().getByRole('button', { name: '查看活动运行', exact: true }).waitFor();
  assert.equal((await call('bootstrap')).runs.length, 1);
  await history().getByRole('button', { name: '查看活动运行', exact: true }).click();
  await button('← 返回本机计划').waitFor();
  const activeRun = (await call('bootstrap')).runs[0];
  await button('← 返回本机计划').click();
  await history().waitFor();
  await until(
    () =>
      history()
        .getByRole('button', { name: '查看活动运行', exact: true })
        .evaluate((el) => el === document.activeElement),
    'history return focus',
  );
  assert.equal((await call('bootstrap')).runs[0].id, activeRun.id);
  await history().getByRole('button', { name: '返回计划', exact: true }).click();
  await until(
    () => button('查看错过 / 占用跳过').evaluate((el) => el === document.activeElement),
    'history close focus',
  );
  await page.getByLabel('计划间隔分钟', { exact: true }).fill('79');
  await button('查看错过 / 占用跳过').click();
  await history().getByRole('button', { name: '查看活动运行', exact: true }).click();
  await button('本地设置').click();
  await guard().waitFor();
  await guard().getByRole('button', { name: '继续编辑', exact: true }).click();
  assert.equal(await page.getByLabel('计划间隔分钟', { exact: true }).inputValue(), '79');
  await page.locator('.schedules-page h1').click();
  await page.keyboard.press('Alt+ArrowLeft');
  await guard().getByRole('button', { name: '不保存离开', exact: true }).click();
  await form().waitFor({ state: 'hidden' });
  note(
    'record pagination isolates this plan, read failure retains the page, actual occupied tick creates no duplicate Run, and activity/keyboard return preserves source draft and focus',
  );
  await close();
  await launch();
  await button('本机计划').click();
  assert.equal((await call('bootstrap')).schedules.length, 2);
  assert.equal((await call('bootstrap')).runs.length, 1);
  assert.ok((await call('bootstrap')).schedules.every((item: any) => !item.enabled));
  await editPlan();
  await button('查看错过 / 占用跳过').click();
  await until(
    async () => (await history().locator('.schedule-history-records article').count()) === 20,
    'persisted log page',
  );
  await history().getByRole('button', { name: '返回计划', exact: true }).click();
  await close();
  assert.deepEqual((evidence.pageErrors ??= []), []);
  note(
    'reopen retains both fixed plans and records without replay; both desktop sessions exit serially',
  );
  evidence.passed = true;
} catch (error) {
  evidence.error = String(error);
  if (page) await page.screenshot({ path: join(data, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await close();
  await mkdir(`${debugEvidenceRoot()}/figma`, { recursive: true });
  await writeFile(
    `${debugEvidenceRoot()}/figma/schedule-workbench-summary.json`,
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence));
}
