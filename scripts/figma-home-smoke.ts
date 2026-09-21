import assert from 'node:assert/strict';
import { _electron as electron, type Page } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const data = await mkdtemp('/private/tmp/flowark-figma-home-');
const app = await electron.launch({
  executablePath: process.env.FLOWARK_TEST_EXECUTABLE || (electronPath as unknown as string),
  args: process.env.FLOWARK_TEST_EXECUTABLE ? [] : [resolve('.')],
  env: { ...process.env, FLOWARK_DATA_DIR: data },
});
const errors: string[] = [];
const evidence: any = { data, passed: false, sizes: [], checks: [] };
let page: Page;
let failure: unknown;
const call = (method: string, args: any = {}) =>
  page.evaluate(({ method, args }) => window.flowark.request(method, args), { method, args });
const bounded = async <T>(operation: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
};
const wait = async (predicate: () => Promise<boolean>, label: string) => {
  const deadline = Date.now() + 15000;
  while (!(await bounded(predicate(), 5000, label))) {
    if (Date.now() >= deadline) throw new Error(label);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setTitle('FlowArk · 隔离测试（自动退出）');
  });
  page.on('pageerror', (e) => errors.push(e.message));
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  await page.getByRole('heading', { name: '你想完成什么？' }).waitFor();
  await button('我的流程').click();
  await page.getByRole('heading', { name: '你的工作流，从这里开始。' }).waitFor();
  await page.evaluate(() => {
    document.querySelector('.window-titlebar')!.textContent = 'FlowArk · 隔离测试（自动退出）';
  });
  await page.evaluate(() => document.fonts.ready);
  await mkdir('test-results/figma', { recursive: true });
  await page.screenshot({ path: 'test-results/figma/first-use-1440.png', scale: 'css' });
  assert.equal(
    await page.locator('.sidebar').evaluate((e) => e.getBoundingClientRect().width),
    224,
  );
  await app.evaluate(({ dialog }) => {
    const original = dialog.showOpenDialog;
    (globalThis as any).__importDialogCalls = 0;
    (globalThis as any).__restoreImportDialog = () => {
      dialog.showOpenDialog = original;
    };
    dialog.showOpenDialog = async () => {
      (globalThis as any).__importDialogCalls++;
      return { canceled: true, filePaths: [] };
    };
  });
  await button('导入模板包').click();
  await wait(
    async () => await app.evaluate(() => (globalThis as any).__importDialogCalls === 1),
    '首次使用导入未打开文件选择',
  );
  await app.evaluate(() => (globalThis as any).__restoreImportDialog());
  assert.equal((await call('bootstrap')).flows.length, 0);
  await page.getByRole('heading', { name: '你的工作流，从这里开始。' }).waitFor();
  await button('← 返回我的流程').click();
  assert.equal(await page.locator('.breadcrumbs').textContent(), '我的流程');
  await button('创建空白流程').click();
  await page.locator('.editor-page').waitFor();
  assert.equal(await page.getByRole('link', { name: '我的流程', exact: true }).count(), 1);
  const bootstrap = await call('bootstrap');
  assert.equal(bootstrap.flows.length, 1);
  const first = bootstrap.flows[0];
  await call('flow.save', {
    flow: {
      ...first.flow,
      name: '真实脚本流程',
      description: '由隔离测试创建，验证保存、搜索和实际运行。',
      steps: [{ id: 'value', type: 'value', version: 1, value: 'home-verified' }],
    },
    bindings: first.bindings,
  });
  for (const name of [
    '网页文字归档',
    '每日文件归档',
    '表格清洗与导出',
    '资料填写助手',
    '接口数据同步',
  ]) {
    const created = await call('flow.create');
    await call('flow.save', {
      flow: { ...created.flow, name, description: '仅用于界面布局的虚构流程，尚未执行。' },
      bindings: created.bindings,
    });
  }
  await button('我的流程').click();
  await page.waitForFunction(() => document.querySelectorAll('.flow-card').length === 6);
  await page.getByRole('textbox', { name: '搜索流程名称' }).fill('真实脚本');
  await page.locator('.flow-card').filter({ hasText: '真实脚本流程' }).waitFor();
  assert.equal(await page.locator('.flow-card').count(), 1);
  await button('来自模板').click();
  await page.getByRole('heading', { name: '没有找到匹配的流程' }).waitFor();
  await button('清除筛选').click();
  assert.equal(await page.locator('.flow-card').count(), 6);
  await button('最近编辑').click();
  assert.equal(await page.locator('.flow-card').count(), 6);
  await button('编辑 真实脚本流程').click();
  await button('运行').click();
  // Poll resolved IPC responses here. An async page.waitForFunction predicate
  // is truthy as a Promise in the pinned Playwright version, before completion.
  await wait(async () => (await call('bootstrap')).runs[0]?.state === 'SUCCEEDED', '流程未完成');
  const after = await call('bootstrap');
  assert.equal(after.runOverview.today.total, 1);
  assert.equal(after.runOverview.today.succeeded, 1);
  assert.equal((await call('run.detail', { id: after.runs[0].id })).output.value, 'home-verified');
  await button('我的流程').click();
  await page.waitForFunction(
    () =>
      document.querySelector('.workspace-summary > div:nth-child(2) small')?.textContent ===
      '1 完成 · 0 失败 · 0 中断',
  );
  const toastClose = page.locator('.notice button');
  if (await toastClose.count()) await toastClose.click();
  await page.mouse.move(0, 0);
  for (const [width, height] of [
    [1440, 960],
    [1920, 1080],
    [1040, 700],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, { width, height }) =>
        BrowserWindow.getAllWindows()[0].setSize(width, height),
      { width, height },
    );
    await page.waitForFunction((w) => window.innerWidth === w, width);
    const layout = await page.evaluate(() => {
      const root = document.documentElement;
      const cards = [...document.querySelectorAll('.flow-card')].map((e) => ({
        x: e.getBoundingClientRect().x,
        y: e.getBoundingClientRect().y,
        w: e.getBoundingClientRect().width,
        h: e.getBoundingClientRect().height,
      }));
      return {
        width: innerWidth,
        height: innerHeight,
        overflow: root.scrollWidth > root.clientWidth,
        sidebar: document.querySelector('.sidebar')!.getBoundingClientRect().width,
        cards,
        searchHeight: document.querySelector('.flow-search')!.getBoundingClientRect().height,
        summaryNotesVisible: [...document.querySelectorAll('.workspace-summary small')].every(
          (element) => {
            const r = element.getBoundingClientRect();
            return (
              r.height >= 18 && r.bottom <= element.parentElement!.getBoundingClientRect().bottom
            );
          },
        ),
        fonts:
          document.fonts.check('14px "Noto Sans SC Variable"') &&
          document.fonts.check('22px "Inter Variable"'),
      };
    });
    assert.equal(layout.overflow, false);
    assert.equal(layout.sidebar, width < 1440 ? 72 : 224);
    assert.ok(layout.cards.every((c) => c.h === 220));
    assert.ok(layout.fonts);
    assert.equal(layout.searchHeight, 40);
    assert.ok(layout.summaryNotesVisible, '统计说明不得被压缩或裁切');
    evidence.sizes.push(layout);
    await page.screenshot({ path: `test-results/figma/home-${width}.png`, scale: 'css' });
  }
  await button('需要处理').count();
  await page.locator('.summary-attention').click();
  await page.getByRole('heading', { name: '需要你看一眼' }).waitFor();
  assert.deepEqual(errors, []);
  evidence.checks = [
    'first-use-create',
    'first-use-import-dialog-and-cancel',
    'back-and-breadcrumb-navigation',
    'search-and-source-intersection',
    'recent-filter',
    'editor-open-and-real-execution',
    'today-summary',
    'three-window-sizes',
    'local-fonts',
    'attention-navigation',
  ];
  // Leave a real paused debug run for finally, so teardown proves it can cancel
  // work and exit without presenting the user's native quit confirmation.
  const cleanupRun = await call('flow.run', { id: first.id, debug: true });
  await wait(
    async () => (await call('run.detail', { id: cleanupRun.id })).run.state === 'PAUSED',
    '收尾验证任务未暂停',
  );
  evidence.cleanupRun = cleanupRun.id;
  evidence.passed = true;
} catch (error) {
  failure = error;
} finally {
  try {
    await bounded(
      (async () => {
        const snapshot = await call('bootstrap');
        for (const run of snapshot.runs) {
          if (['QUEUED', 'RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING'].includes(run.state))
            await call('run.control', { id: run.id, action: 'cancel' });
        }
        await wait(async () => {
          const snapshot = await call('bootstrap');
          return (
            !snapshot.execution?.active &&
            !snapshot.runOverview.active &&
            !snapshot.runOverview.queued
          );
        }, '测试任务未退出');
        if (evidence.cleanupRun) {
          assert.equal(
            (await call('run.detail', { id: evidence.cleanupRun })).run.state,
            'CANCELLED',
          );
          evidence.checks.push('cancel-paused-run-before-quit');
        }
      })(),
      20000,
      '隔离测试清理超时',
    );
    await bounded(app.close(), 10000, '隔离测试窗口未退出');
    evidence.closed = true;
  } catch (error) {
    failure ??= error;
    evidence.cleanupError = String(error);
    // Only this launch's process is owned by the test. Never signal another
    // installed FlowArk instance, and never leave a failed test waiting on UI.
    app.process().kill('SIGKILL');
  }
  if (failure) evidence.passed = false;
  await mkdir('test-results/figma', { recursive: true });
  await writeFile('test-results/figma/home-summary.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
if (failure) throw failure;
