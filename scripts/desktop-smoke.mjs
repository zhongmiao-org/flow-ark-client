import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const data = await mkdtemp(join(tmpdir(), 'flowark-desktop-'));
const executable = process.env.FLOWARK_TEST_EXECUTABLE || electronPath;
const args = process.env.FLOWARK_TEST_EXECUTABLE ? [] : [resolve('.')];
const app = await electron.launch({
  executablePath: executable,
  args,
  env: { ...process.env, FLOWARK_DATA_DIR: data },
  timeout: 30000,
});
const errors = [];
app.process().stderr.on('data', (b) => process.stderr.write(b));
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => Boolean(window.flowark), {}, { timeout: 15000 });
  const bootstrap = await page.evaluate(() => window.flowark.request('bootstrap'));
  console.log('Desktop initialized');
  assert.equal(bootstrap.flows.length, 1);
  assert.equal(bootstrap.runs.length, 0);
  const security = await app.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      sandbox: p.sandbox,
      contextIsolation: p.contextIsolation,
      nodeIntegration: p.nodeIntegration,
    };
  });
  assert.deepEqual(security, {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  });
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await page.getByRole('button', { name: '运行', exact: true }).first().click();
  console.log('Run submitted');
  const deadline = Date.now() + 20000;
  while (true) {
    const current = await page.evaluate(() => window.flowark.request('bootstrap'));
    if (current.runs[0] && ['SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(current.runs[0].state))
      break;
    if (Date.now() > deadline) throw new Error('Desktop run timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log('Run finished');
  const result = await page.evaluate(() => window.flowark.request('bootstrap'));
  assert.equal(result.runs[0].state, 'SUCCEEDED', JSON.stringify(result.runs[0]));
  await page.getByRole('button', { name: '我的流程', exact: true }).click();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({
    path: 'test-results/desktop-home.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '编辑 第一个流程' }).click();
  assert.equal(await page.locator('.inspector').getByText(/招聘/).count(), 0);
  assert.equal(await page.getByRole('button', { name: '实例配置', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'JS / TS 脚本', exact: true }).click();
  await page.getByRole('button', { name: '添加到主流程', exact: true }).click();
  await page.waitForSelector('.monaco-editor', { timeout: 20000 });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '运行', exact: true }).click();
  const scriptDeadline = Date.now() + 20000;
  while (true) {
    const state = await page.evaluate(() => window.flowark.request('bootstrap'));
    if (
      state.runs.length >= 2 &&
      ['SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(state.runs[0].state)
    ) {
      assert.equal(state.runs[0].state, 'SUCCEEDED', JSON.stringify(state.runs[0]));
      break;
    }
    if (Date.now() > scriptDeadline) throw new Error('Packaged script execution timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await page.getByRole('button', { name: '我的流程', exact: true }).click();
  await page.getByRole('button', { name: '编辑 第一个流程' }).click();
  await page.screenshot({
    path: 'test-results/desktop-editor.png',
    fullPage: true,
  });
  const beforeTemplates = await page.evaluate(() => window.flowark.request('bootstrap'));
  await page.evaluate(() =>
    window.flowark.request('flow.create', { templateId: 'boss-resume-apply' }),
  );
  await page.getByRole('button', { name: '我的流程', exact: true }).click();
  await page.getByRole('button', { name: '编辑 BOSS 直聘投递简历', exact: true }).click();
  assert.equal(
    await page
      .locator('.inspector')
      .getByText(/招聘配置|求职者账号|逐项动作权限/)
      .count(),
    0,
  );
  await page.getByRole('button', { name: '实例配置', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('求职者账号标识', { exact: true })
    .fill('fictional-desktop-account');
  await page.screenshot({ path: 'test-results/template-instance.png', fullPage: true });
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const configured = await page.evaluate(() => window.flowark.request('bootstrap'));
  assert.equal(configured.runs.length, beforeTemplates.runs.length);
  assert.equal(
    configured.flows.find((r) => r.flow.sourceTemplate?.id === 'boss-resume-apply').bindings
      .configuration.values.account,
    'fictional-desktop-account',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    'test-results/desktop.json',
    JSON.stringify(
      {
        time: new Date().toISOString(),
        security,
        state: result.runs[0].state,
        dataPath: data,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'Desktop smoke passed: encrypted storage, secure IPC, real Worker execution, React Flow and Monaco',
  );
} catch (error) {
  console.error('Desktop verification failed:', error);
  process.exitCode = 1;
} finally {
  // Playwright's app.close invokes quit under the inspector. Invoke the app's menu
  // path so its asynchronous resource shutdown can complete before inspector exit.
  const ended = new Promise((resolve) =>
    app.process().once('exit', (code, signal) => resolve({ code, signal })),
  );
  await app
    .evaluate(({ Menu }) => {
      setTimeout(
        () =>
          Menu.getApplicationMenu()
            .items[0].submenu.items.find((item) => item.label === '退出 FlowArk')
            .click(),
        100,
      );
    })
    .catch(() => {});
  const timer = setTimeout(() => app.process().kill('SIGKILL'), 10000);
  const exit = await ended;
  clearTimeout(timer);
  assert.equal(exit.signal, null, 'Application required a forced termination');
  assert.equal(exit.code, 0, 'Application exited abnormally');
}
