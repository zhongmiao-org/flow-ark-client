import assert from 'node:assert/strict';
import { desktopElectron as electron } from './desktop-session.mjs';
import { type Page } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { startFormLab } from './fixtures/platform-page';
import { formBrowser } from './fixtures/platform-flow';
import type { Run, Schedule } from '../src/shared/types';
const data = await mkdtemp('/private/tmp/flowark-schedule-edit-ui-');
const lab = await startFormLab();
const launch = () =>
  electron.launch({
    executablePath: process.env.FLOWARK_TEST_EXECUTABLE || (electronPath as unknown as string),
    args: process.env.FLOWARK_TEST_EXECUTABLE ? [] : [resolve('.')],
    env: {
      ...process.env,
      FLOWARK_DATA_DIR: data,
      PLAYWRIGHT_BROWSERS_PATH: join(data, 'empty-browser-cache'),
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
    },
    timeout: 30000,
  });
let app = await launch();
let page: Page;
const evidence: any = { passed: false, data, checks: [], runs: [] };
const note = (value: string) => {
  evidence.checks.push(value);
  console.log(value);
};
const call = (method: string, args: any = {}): Promise<any> =>
  page.evaluate(({ method, args }) => (window as any).flowark.request(method, args), {
    method,
    args,
  });
const button = (name: string) => page.getByRole('button', { name, exact: true });
const wait = async (fn: () => Promise<boolean>, label: string, timeout = 20000) => {
  const end = performance.now() + timeout;
  while (!(await fn())) {
    if (performance.now() > end) throw new Error('计划编辑验收超时：' + label);
    await new Promise((r) => setTimeout(r, 150));
  }
};
let planId = '';
const plan = async (): Promise<Schedule> =>
  (await call('bootstrap')).schedules.find((s: Schedule) => s.id === planId);
const edit = () => page.getByRole('form', { name: '编辑本机计划', exact: true });
const scheduled = async (count: number) => {
  let run: Run | undefined;
  const due = (await plan()).nextAt;
  await wait(
    async () => {
      const boot = await call('bootstrap');
      assert.ok(!boot.fault, boot.fault);
      const runs: Run[] = boot.runs.filter((r: Run) => r.scheduleId === planId);
      assert.ok(runs.length <= count);
      assert.ok(
        runs.every((r) => !['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(r.state)),
        JSON.stringify(runs),
      );
      run = runs.find((r) => r.state === 'WAITING_INPUT');
      return runs.length === count && !!run;
    },
    '真实到期运行',
    Math.max(0, due - Date.now()) + 30000,
  );
  assert.ok(run);
  assert.ok(Date.parse(run.createdAt) >= due);
  evidence.runs.push({ id: run.id, versionId: run.versionId, due, createdAt: run.createdAt });
  return run;
};
const formValue = () =>
  app.evaluate(async ({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0].contentView
      .children[0] as Electron.WebContentsView;
    return view.webContents.executeJavaScript(
      `({name:document.querySelector('#full-name').value,width:innerWidth})`,
    );
  });
try {
  page = await app.firstWindow();
  await page.waitForFunction(() => !!(window as any).flowark);
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
  await button('本地设置').click();
  await button('启用内置浏览器').click();
  await wait(
    async () => (await call('bootstrap')).browsers.some((b: any) => b.product === 'embedded'),
    '绑定内置浏览器',
  );
  const browser = (await call('bootstrap')).browsers.find((b: any) => b.product === 'embedded');
  const record = await call('flow.create');
  const flow = (name: string) => ({
    ...record.flow,
    name: '虚构计划版本验证',
    steps: [
      formBrowser('open', 'navigate', '', lab.url),
      formBrowser('fill', 'fill', '#full-name', name),
      { id: 'wait', type: 'human', version: 1, message: '核对当前表单后继续' },
    ],
  });
  const bindings = { files: {}, browserId: browser.id, credentials: [] };
  await call('flow.save', { flow: flow('旧版本虚构用户'), bindings });
  await button('本机计划').click();
  await page.getByLabel('计划流程', { exact: true }).selectOption(record.id);
  await page.getByLabel('创建间隔分钟', { exact: true }).fill('1');
  await page.getByLabel('创建时区', { exact: true }).fill('Asia/Shanghai');
  await button('创建计划').click();
  await wait(async () => (await call('bootstrap')).schedules.length === 1, '创建');
  planId = (await call('bootstrap')).schedules[0].id;
  const original = await plan();
  await button('暂停计划').click();
  await wait(async () => !(await plan()).enabled, '暂停');
  const paused = await plan();
  await button('编辑计划').click();
  await page.getByLabel('计划间隔分钟', { exact: true }).fill('9');
  await button('取消编辑').click();
  assert.deepEqual(await plan(), paused);
  note('cancel-preserves-plan');
  await call('flow.save', { flow: flow('新版本虚构用户'), bindings });
  await button('编辑计划').click();
  assert.equal(
    await page.getByLabel('采用当前已保存的流程版本', { exact: true }).isChecked(),
    false,
  );
  await page.getByLabel('计划时区', { exact: true }).fill('Unknown/Zone');
  await button('保存计划').click();
  await page.locator('.schedules-page [role="alert"]').filter({ hasText: '有效时区' }).waitFor();
  assert.deepEqual(await plan(), paused);
  await page.getByLabel('计划间隔分钟', { exact: true }).fill('2');
  await page.getByLabel('计划时区', { exact: true }).fill('Asia/Tokyo');
  await button('保存计划').click();
  await edit().waitFor({ state: 'hidden' });
  const timing = await plan();
  assert.equal(timing.versionId, original.versionId);
  assert.equal(timing.enabled, false);
  assert.equal(timing.intervalMinutes, 2);
  assert.equal(timing.timezone, 'Asia/Tokyo');
  note('timing-only-preserves-version-and-paused-state');
  await button('编辑计划').click();
  await call('schedule.toggle', { id: planId, enabled: true });
  await edit().getByRole('alert').waitFor();
  assert.equal(await button('保存计划').isDisabled(), true);
  await button('取消编辑').click();
  await button('暂停计划').click();
  await wait(async () => !(await plan()).enabled, '冲突后暂停');
  await button('编辑计划').click();
  await page.getByLabel('计划间隔分钟', { exact: true }).fill('1');
  await page.getByLabel('计划时区', { exact: true }).fill('UTC');
  await button('保存计划').click();
  await edit().waitFor({ state: 'hidden' });
  note('concurrent-toggle-requires-reopen');
  await button('打开网页面板').click();
  await page.getByLabel('网页地址', { exact: true }).fill(lab.url);
  await button('访问网页').click();
  await wait(
    async () => (await call('browser.embedded.status')).url.startsWith(lab.url),
    '内置页面',
  );
  await button('启用计划').click();
  await wait(async () => (await plan()).enabled, '重新启用');
  note('waiting-for-original-real-minute');
  const old = await scheduled(1);
  assert.equal(old.versionId, original.versionId);
  assert.deepEqual(await formValue(), { name: '旧版本虚构用户', width: 1920 });
  await button('暂停计划').click();
  await wait(async () => !(await plan()).enabled, '更新前暂停');
  await button('编辑计划').click();
  await page.getByLabel('采用当前已保存的流程版本', { exact: true }).check();
  await edit()
    .getByText(/保存于/)
    .waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 700));
  await wait(
    () =>
      page.evaluate(() => {
        const form = document.querySelector('.schedule-edit')!;
        const page = document.querySelector('.schedules-page')!;
        return form.clientWidth > 0 && page.scrollWidth <= page.clientWidth + 1;
      }),
    '窄窗口布局',
  );
  await mkdir('test-results', { recursive: true });
  await button('保存计划').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/schedule-editing.png', fullPage: true });
  await button('保存计划').click();
  await edit().waitFor({ state: 'hidden' });
  const adopted = await plan();
  assert.equal(adopted.enabled, false);
  assert.notEqual(adopted.versionId, old.versionId);
  assert.equal((await call('run.detail', { id: old.id })).run.versionId, old.versionId);
  assert.deepEqual(await formValue(), { name: '旧版本虚构用户', width: 1920 });
  await call('run.control', { id: old.id, action: 'resume' });
  await wait(
    async () => (await call('run.detail', { id: old.id })).run.state === 'SUCCEEDED',
    '旧任务完成',
  );
  await button('启用计划').click();
  await wait(async () => (await plan()).enabled, '采用后启用');
  const displayed = await plan();
  const expectedTime = new Intl.DateTimeFormat('zh-CN', {
    timeZone: displayed.timezone,
    dateStyle: 'medium',
    timeStyle: 'medium',
    hour12: false,
  }).format(displayed.nextAt);
  await page
    .locator('[data-schedule-id]')
    .getByText('下次：' + expectedTime, { exact: true })
    .waitFor();
  note('waiting-for-adopted-real-minute');
  const newer = await scheduled(2);
  assert.equal(newer.versionId, adopted.versionId);
  assert.deepEqual(await formValue(), { name: '新版本虚构用户', width: 1920 });
  await button('暂停计划').click();
  await wait(async () => !(await plan()).enabled, '最终暂停');
  await call('run.control', { id: newer.id, action: 'resume' });
  await wait(
    async () => (await call('run.detail', { id: newer.id })).run.state === 'SUCCEEDED',
    '新任务完成',
  );
  const final = await plan();
  assert.equal(lab.state.attempts, 0);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.waitForFunction(() => !!(window as any).flowark);
  await button('本机计划').click();
  assert.deepEqual(await plan(), final);
  assert.equal((await call('bootstrap')).runs.length, 2);
  await page.getByText('已暂停 · 启用后重新计算下次时间', { exact: true }).waitFor();
  note('saved-plan-and-both-successful-versions-survive-reopen');
  evidence.passed = true;
} catch (error) {
  evidence.error = String(error);
  evidence.screen = await page!
    .locator('.schedules-page')
    .innerText()
    .catch(() => 'unavailable');
  throw error;
} finally {
  const child = app.process();
  const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
  try {
    const boot = await call('bootstrap').catch(() => ({ schedules: [], runs: [] }));
    for (const s of boot.schedules)
      await call('schedule.toggle', { id: s.id, enabled: false }).catch(() => {});
    for (const r of boot.runs.filter(
      (r: Run) => !['SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED'].includes(r.state),
    ))
      await call('run.control', { id: r.id, action: 'cancel' }).catch(() => {});
    await app.close().catch(() => child.kill('SIGKILL'));
  } finally {
    clearTimeout(timeout);
  }
  await lab.close();
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/schedule-editing.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
