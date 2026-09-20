import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startFormLab } from './fixtures/form-lab';
import { formLabFlow, formBrowser, formText, formExpected } from './fixtures/form-lab-flow';

const data = await mkdtemp(join(tmpdir(), 'flowark-embedded-desktop-'));
const lab = await startFormLab();
await writeFile(join(data, 'fictional.txt'), formText);
const app = await electron.launch({
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
const evidence: any = { passed: false, data, screenshots: [] };
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean((window as any).flowark));
  const call = (method: string, args: any = {}) =>
    page.evaluate(({ method, args }) => (window as any).flowark.request(method, args), {
      method,
      args,
    });
  evidence.version = await app.evaluate(({ app, BrowserWindow }) => {
    (globalThis as any).unexpectedShown = [];
    const main = BrowserWindow.getAllWindows()[0].id;
    app.on('browser-window-created', (_event, win) =>
      win.on('show', () => {
        if (win.id !== main) (globalThis as any).unexpectedShown.push(win.id);
      }),
    );
    return app.getVersion();
  });
  await page.getByRole('button', { name: '本地设置', exact: true }).click();
  await page.getByRole('button', { name: '启用内置浏览器', exact: true }).click();
  await page
    .getByRole('button', { name: '启用内置浏览器', exact: true })
    .waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '打开网页面板', exact: true }).click();
  await page.getByLabel('网页地址', { exact: true }).waitFor();
  await page.waitForTimeout(500);
  assert.equal((await call('browser.embedded.status')).started, true);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  const panelBounds = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].contentView.children[0].getBounds(),
  );
  assert.ok(panelBounds.width > 400 && panelBounds.x > 500);
  evidence.panelBeforeRun = panelBounds;
  await page.getByLabel('网页地址', { exact: true }).fill(lab.url);
  await page.getByRole('button', { name: '访问网页', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="网页地址"]')?.getAttribute('disabled') === null,
  );
  await page.waitForTimeout(500);
  assert.ok((await call('browser.embedded.status')).url.startsWith(lab.url));
  await mkdir('test-results', { recursive: true });
  const panelImage = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'),
  );
  await writeFile('test-results/embedded-panel.png', Buffer.from(panelImage, 'base64'));
  evidence.screenshots.push('test-results/embedded-panel.png');
  const browser = (await call('bootstrap')).browsers.find((b: any) => b.product === 'embedded');
  assert.equal(browser.product, 'embedded');
  const record = await call('flow.create');
  const flow = { ...formLabFlow(lab.url), id: record.id };
  const bindings = { files: { work: data }, browserId: browser.id, credentials: [] };
  await call('flow.save', {
    flow,
    bindings: { ...bindings, files: { workspace: data + '/separate' } },
  });
  await page.getByRole('button', { name: '本地设置', exact: true }).click();
  await page.getByRole('button', { name: '我的流程', exact: true }).click();
  await page.getByRole('button', { name: '编辑 复杂表单功能验证', exact: true }).click();
  // Exercise the actual binding UI; a non-workspace imported name must be configurable.
  await page.getByRole('button', { name: '参数与绑定', exact: true }).click();
  await app.evaluate(({ dialog }, path) => {
    const original = dialog.showOpenDialog;
    dialog.showOpenDialog = (async () => {
      dialog.showOpenDialog = original;
      return { canceled: false, filePaths: [path] };
    }) as any;
  }, data);
  await page.getByRole('button', { name: '选择 work 目录', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const bound = (await call('bootstrap')).flows.find((item: any) => item.id === flow.id);
  assert.equal(bound.bindings.files.work, data);
  assert.equal(bound.bindings.files.workspace, data + '/separate');
  evidence.namedFileBinding = true;
  await page.getByRole('button', { name: '逐步调试', exact: true }).click();
  const waitFor = async (fn: () => Promise<any>, label: string, ms = 60000) => {
    const deadline = Date.now() + ms;
    while (!(await fn())) {
      if (Date.now() > deadline) throw new Error('等待超时：' + label);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };
  let runId = '';
  await waitFor(async () => {
    const boot = await call('bootstrap');
    const run = boot.runs.find((r: any) => r.flowId === flow.id);
    if (run?.state === 'PAUSED') {
      runId = run.id;
      return true;
    }
  }, '首步暂停');
  let detail = await call('run.detail', { id: runId });
  assert.equal(detail.events.filter((e: any) => e.type === 'node-start').length, 0);
  await page.getByLabel('调试位置').getByText('下一步：open', { exact: true }).waitFor();
  for (const next of ['fill_name', 'read_name', 'verify_name']) {
    await page.getByRole('button', { name: '执行下一步', exact: true }).click();
    await page
      .getByLabel('调试位置')
      .getByText('下一步：' + next, { exact: true })
      .waitFor();
  }
  detail = await call('run.detail', { id: runId });
  assert.equal(
    detail.events.find((e: any) => e.type === 'node-end' && e.nodeInstance === 'read_name').data
      .outputPreview,
    '"测试用户甲"',
  );
  assert.equal(lab.state.attempts, 0);
  await mkdir('test-results', { recursive: true });
  const pausedShot = 'test-results/embedded-paused.png';
  await page.screenshot({ path: pausedShot, fullPage: true });
  evidence.screenshots.push(pausedShot);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await waitFor(async () => {
    detail = await call('run.detail', { id: runId });
    if (['FAILED', 'INTERRUPTED'].includes(detail.run.state))
      throw new Error(JSON.stringify({ run: detail.run, events: detail.events.slice(-5) }));
    return detail.run.state === 'SUCCEEDED';
  }, '完整表单');
  assert.deepEqual(lab.state.accepted[0].fields, formExpected);
  assert.equal((await call('browser.embedded.status')).visible, false);
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()),
    true,
  );
  evidence.minimizedForm = true;
  evidence.formRun = runId;
  const waiting = {
    ...flow,
    id: 'cancel-form-debug',
    name: '取消后重开验证',
    steps: [
      flow.steps[0],
      formBrowser('waiting', 'wait', '#never', null, 20000),
      formBrowser('must_not_click', 'click', '#submit'),
    ],
  };
  await call('flow.save', { flow: waiting, bindings });
  const cancellation = await call('flow.run', { id: waiting.id });
  await waitFor(
    async () =>
      (await call('run.detail', { id: cancellation.id })).events.some(
        (e: any) => e.type === 'node-start' && e.nodeInstance === 'waiting',
      ),
    '浏览器等待',
  );
  await call('run.control', { id: cancellation.id, action: 'cancel' });
  await waitFor(
    async () => (await call('run.detail', { id: cancellation.id })).run.state === 'CANCELLED',
    '取消',
  );
  detail = await call('run.detail', { id: cancellation.id });
  assert.ok(
    !detail.events.some((e: any) => e.type === 'node-start' && e.nodeInstance === 'must_not_click'),
  );
  const reopened = await call('flow.run', { id: flow.id });
  await waitFor(async () => {
    const detail = await call('run.detail', { id: reopened.id });
    if (['FAILED', 'INTERRUPTED'].includes(detail.run.state))
      throw new Error(JSON.stringify({ run: detail.run, events: detail.events.slice(-5) }));
    return detail.run.state === 'SUCCEEDED';
  }, '取消后重开上传');
  assert.equal(lab.state.attempts, 2);
  assert.deepEqual(lab.state.accepted[1].fields, formExpected);
  evidence.cancelled = cancellation.id;
  evidence.reopened = reopened.id;
  const download = {
    ...flow,
    id: 'embedded-download',
    steps: [
      formBrowser('open', 'navigate', '', lab.url),
      formBrowser('download', 'download', 'a[href="/fictional.txt"]', 'downloaded.txt'),
    ],
  };
  await call('flow.save', { flow: download, bindings });
  const downloaded = await call('flow.run', { id: download.id });
  await waitFor(async () => {
    const result = await call('run.detail', { id: downloaded.id });
    if (['FAILED', 'INTERRUPTED'].includes(result.run.state)) throw new Error(result.run.error);
    return result.run.state === 'SUCCEEDED';
  }, '后台下载');
  const result = await call('run.detail', { id: downloaded.id });
  assert.ok(result.artifacts.length);
  assert.equal(await readFile(result.artifacts[0].path, 'utf8'), formText);
  evidence.backgroundDownload = downloaded.id;
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].restore();
  });
  await call('browser.embedded.visibility', { visible: true });
  await waitFor(async () => (await call('browser.embedded.status')).visible, '恢复网页面板');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].hide();
  });
  await waitFor(async () => !(await call('browser.embedded.status')).visible, '收起网页');
  evidence.hideFollowsWorkbench = true;
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].show();
  });
  // A native website crash must end WAITING_INPUT rather than leave a dead Continue button.
  const lossFlow = {
    ...flow,
    id: 'embedded-loss',
    steps: [
      flow.steps[0],
      { id: 'human', type: 'human', version: 1, message: 'fixture manual takeover' },
      formBrowser('must_not_submit', 'click', '#submit'),
    ],
  };
  await call('flow.save', { flow: lossFlow, bindings });
  const lossRun = await call('flow.run', { id: lossFlow.id });
  await waitFor(
    async () => (await call('run.detail', { id: lossRun.id })).run.state === 'WAITING_INPUT',
    '等待人工',
  );
  await app.evaluate(({ BrowserWindow }) =>
    (
      BrowserWindow.getAllWindows()[0].contentView.children[0] as any
    ).webContents.forcefullyCrashRenderer(),
  );
  await waitFor(
    async () => (await call('run.detail', { id: lossRun.id })).run.state === 'INTERRUPTED',
    '会话失联停止运行',
  );
  assert.match((await call('run.detail', { id: lossRun.id })).run.error, /意外|丢失/);
  assert.equal((await call('bootstrap')).runtimeBlock, undefined, '已确认销毁可接受新运行');
  assert.ok(
    (await call('bootstrap')).attention.some((item: any) => item.detail?.runId === lossRun.id),
  );
  assert.ok(
    !(await call('run.detail', { id: lossRun.id })).events.some(
      (event: any) => event.nodeInstance === 'must_not_submit',
    ),
  );
  evidence.lostSessionStopped = true;
  assert.deepEqual(await app.evaluate(() => (globalThis as any).unexpectedShown), []);
  evidence.noExtraVisibleWindow = true;
  evidence.passed = true;
  console.log('Desktop debug, field receipt, cancellation and fresh browser upload passed');
} finally {
  const child = app.process();
  const exited = new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  await app.evaluate(({ Menu }) => {
    setTimeout(
      () =>
        Menu.getApplicationMenu()!
          .items[0].submenu!.items.find((item) => item.label === '退出 FlowArk')!
          .click(),
      100,
    );
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  const status: any = await exited;
  clearTimeout(timer);
  evidence.exit = status;
  await lab.close();
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/embedded-desktop.json', JSON.stringify(evidence, null, 2));
  assert.deepEqual(status, { code: 0, signal: null });
}
