import assert from 'node:assert/strict';
import { desktopElectron as electron } from './desktop-session.mjs';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startFormLab } from './fixtures/platform-page';
import { formLabFlow, formBrowser, formText, formExpected } from './fixtures/platform-flow';

const data = await mkdtemp(join(tmpdir(), 'flowark-debug-desktop-'));
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
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
  const browser = await call('browser.embedded.enable');
  const record = await call('flow.create');
  const flow = { ...formLabFlow(lab.url), id: record.id };
  const bindings = { files: { work: data }, browserId: browser.id, credentials: [] };
  await call('flow.save', { flow, bindings });
  await page.getByRole('button', { name: '本地设置', exact: true }).click();
  await page.getByRole('button', { name: '我的流程', exact: true }).click();
  await page.getByRole('button', { name: '编辑 复杂表单功能验证', exact: true }).click();
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
  const pausedShot = 'test-results/debug-paused.png';
  await page.screenshot({ path: pausedShot, fullPage: true });
  evidence.screenshots.push(pausedShot);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await waitFor(async () => {
    detail = await call('run.detail', { id: runId });
    if (['FAILED', 'INTERRUPTED'].includes(detail.run.state)) throw new Error(detail.run.error);
    return detail.run.state === 'SUCCEEDED';
  }, '完整表单');
  assert.deepEqual(lab.state.accepted[0].fields, formExpected);
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
    if (['FAILED', 'INTERRUPTED'].includes(detail.run.state)) throw new Error(detail.run.error);
    return detail.run.state === 'SUCCEEDED';
  }, '取消后重开上传');
  assert.equal(lab.state.attempts, 2);
  assert.deepEqual(lab.state.accepted[1].fields, formExpected);
  evidence.cancelled = cancellation.id;
  evidence.reopened = reopened.id;
  if (process.platform === 'darwin' && browser.version === '153.0.8010.48') {
    const download = {
      ...flow,
      id: 'blocked-download',
      steps: [formBrowser('download', 'download', '#submit', 'file.txt')],
    };
    await call('flow.save', { flow: download, bindings });
    const before = (await call('bootstrap')).runs.length;
    await assert.rejects(call('flow.run', { id: download.id }), /原生下载恢复崩溃/);
    assert.equal((await call('bootstrap')).runs.length, before);
    assert.equal(lab.state.attempts, 2);
    evidence.downloadBlockedBeforeRun = true;
  }
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
  await writeFile('test-results/debug-desktop.json', JSON.stringify(evidence, null, 2));
  assert.deepEqual(status, { code: 0, signal: null });
}
