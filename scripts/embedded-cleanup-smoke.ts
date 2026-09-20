import assert from 'node:assert/strict';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Bootstrap, Run, Step } from '../src/shared/types';
import { startFormLab } from './fixtures/form-lab';
import { formBrowser } from './fixtures/form-lab-flow';

// Only native close and dialog responses are fault-injected in isolated processes.
// Host/Worker execution, persistence, UI diagnostics and application quit are real.
const data = await mkdtemp('/private/tmp/flowark-cleanup-ui-');
const previewData = await mkdtemp('/private/tmp/flowark-cleanup-preview-');
const lab = await startFormLab();
const evidence: any = { passed: false, data, previewData, checks: [], runs: [] };
let app: ElectronApplication | undefined;
let page!: Page;
const wait = async (check: () => Promise<boolean>, label: string, timeout = 20000) => {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('回收验收等待超时：' + label);
    await new Promise((done) => setTimeout(done, 40));
  }
};
const call = (method: string, args: any = {}): Promise<any> =>
  page.evaluate(({ method, args }) => (window as any).flowark.request(method, args), {
    method,
    args,
  });
const boot = async (): Promise<Bootstrap> => {
  const state = await call('bootstrap');
  assert.ok(!state.fault, state.fault);
  return state;
};
const note = (check: string) => {
  evidence.checks.push(check);
  console.log(check);
};
const launch = async (directory: string) => {
  app = await electron.launch({
    executablePath: process.env.FLOWARK_TEST_EXECUTABLE || (electronPath as unknown as string),
    args: process.env.FLOWARK_TEST_EXECUTABLE ? [] : [resolve('.')],
    env: { ...process.env, FLOWARK_DATA_DIR: directory },
    timeout: 30000,
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => !!(window as any).flowark);
  await boot();
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
  await app.evaluate(({ dialog }) => {
    const state = { errors: [] as string[], dialogs: [] as string[], nativeCloseCalls: 0 };
    (globalThis as any).cleanupTest = state;
    process.on('unhandledRejection', (error) => state.errors.push(String(error)));
    process.on('uncaughtException', (error) => state.errors.push(String(error)));
    (dialog as any).showMessageBox = (_window: unknown, options: Electron.MessageBoxOptions) => {
      state.dialogs.push(options.message);
      return Promise.resolve({ response: 1, checkboxChecked: false });
    };
  });
};
const create = async (name: string, steps: Step[], browser = false) => {
  const record = await call('flow.create');
  await call('flow.save', {
    flow: { ...record.flow, name, steps },
    bindings: { files: {}, credentials: [], ...(browser ? { browserId: 'embedded' } : {}) },
  });
  return record.id as string;
};
const prefix = () => [
  formBrowser('open', 'navigate', '', lab.url),
  formBrowser('name', 'fill', '#full-name', '虚构回收测试'),
  formBrowser('radio', 'check', '#channel-email', true),
  formBrowser('select', 'select', '#department', 'engineering'),
];
const nativeForm = () =>
  app!.evaluate(async ({ BrowserWindow }) => {
    const wc = (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents;
    return wc.executeJavaScript(`({width:innerWidth,name:document.querySelector('#full-name').value,
      radio:document.querySelector('#channel-email').checked,select:document.querySelector('#department').value})`);
  });
const armCloseFailure = () =>
  app!.evaluate(({ BrowserWindow }) => {
    const state = (globalThis as any).cleanupTest;
    const wc = (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents;
    state.old = wc;
    state.originalClose = wc.close.bind(wc);
    state.destroyed = false;
    wc.once('destroyed', () => {
      state.destroyed = true;
    });
    wc.close = () => {
      state.nativeCloseCalls++;
      throw new Error('injected native close acknowledgement failure');
    };
    return wc.id;
  });
const nativeEvidence = () =>
  app!.evaluate(({ webContents }) => {
    const state = (globalThis as any).cleanupTest;
    return {
      alive: !state.old.isDestroyed(),
      destroyed: state.destroyed,
      nativeCloseCalls: state.nativeCloseCalls,
      ids: webContents.getAllWebContents().map((wc) => wc.id),
      errors: state.errors,
    };
  });
const terminal = async (id: string, expected: string) => {
  let detail: any;
  await wait(
    async () => {
      detail = await call('run.detail', { id });
      if (['SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED'].includes(detail.run.state)) {
        assert.equal(detail.run.state, expected, detail.run.error);
        return !(await boot()).runOverview.active;
      }
      return false;
    },
    id + ' ' + expected,
  );
  return detail;
};
const gracefulQuit = async () => {
  const current = app!;
  const child = current.process();
  const ended = new Promise<{ code: number | null; signal: string | null }>((done) =>
    child.once('exit', (code, signal) => done({ code, signal })),
  );
  const timeout = setTimeout(() => child.kill('SIGKILL'), 25000);
  try {
    await current.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()?.items[0].submenu?.items.find(
        (x) => x.label === '退出 FlowArk',
      );
      if (!item) throw new Error('退出菜单缺失');
      item.click();
    });
    const result = await ended;
    app = undefined;
    assert.deepEqual(result, { code: 0, signal: null }, '必须由产品正常退出，测试强杀不是通过');
    evidence.exits = [...(evidence.exits ?? []), result];
  } finally {
    clearTimeout(timeout);
  }
};
try {
  await launch(data);
  await call('browser.embedded.enable');
  await page.getByRole('button', { name: '打开网页面板', exact: true }).click();
  const flowId = await create(
    '虚构原生关闭故障',
    [
      ...prefix(),
      { id: 'hold', type: 'human', version: 1, message: '等待注入关闭故障' },
      formBrowser('never', 'fill', '#full-name', '不得迟到填写'),
    ],
    true,
  );
  const valueId = await create('虚构队列不执行', [
    { id: 'value', type: 'value', version: 1, value: 1 },
  ]);
  const original: Run = await call('flow.run', { id: flowId });
  await wait(
    async () => (await call('run.detail', { id: original.id })).run.state === 'WAITING_INPUT',
    '真实表单后等待',
  );
  assert.deepEqual(await nativeForm(), {
    width: 1920,
    name: '虚构回收测试',
    radio: true,
    select: 'engineering',
  });
  const queued: Run = await call('flow.run', { id: valueId });
  const cancelled: Run = await call('flow.run', { id: valueId });
  evidence.runs.push(original.id, queued.id, cancelled.id);
  evidence.oldWebContents = await armCloseFailure();
  await call('run.control', { id: original.id, action: 'cancel' });
  const detail = await terminal(original.id, 'INTERRUPTED');
  await wait(async () => !!(await boot()).runtimeBlock, '宿主执行阻断');
  const blocked = await boot();
  assert.match(blocked.runtimeBlock!, /回收|关闭/);
  assert.match(detail.run.error, /injected native close acknowledgement failure/);
  assert.equal(
    detail.events.filter(
      (event: any) => event.type === 'state' && event.data.state === 'INTERRUPTED',
    ).length,
    1,
  );
  const native = await nativeEvidence();
  assert.equal(native.alive, true, '原生对象仍活着，不能把字段清空当销毁');
  assert.equal(native.destroyed, false);
  assert.ok(native.nativeCloseCalls >= 1);
  assert.deepEqual(native.errors, []);
  await page.getByText('资源回收未确认', { exact: true }).waitFor();
  await assert.rejects(call('flow.run', { id: valueId }), /回收|关闭|停止|重开/);
  await assert.rejects(call('browser.embedded.navigate', { url: lab.url }), /回收|关闭|停止|重开/);
  assert.equal((await call('run.detail', { id: queued.id })).run.state, 'QUEUED');
  assert.equal(
    (await call('run.detail', { id: queued.id })).events.filter(
      (event: any) => event.type === 'node-start',
    ).length,
    0,
  );
  assert.deepEqual((await nativeEvidence()).ids, native.ids, '阻断后没有创建替代网页');
  await call('run.control', { id: cancelled.id, action: 'cancel' });
  assert.equal((await call('run.detail', { id: cancelled.id })).run.state, 'CANCELLED');
  const originalEvents = (await call('run.detail', { id: original.id })).events;
  note('native-close-failure-interrupts-and-blocks-ui-admission-and-fifo');
  await gracefulQuit();
  note('explicit-quit-exits-with-unconfirmed-native-page');

  await launch(data);
  const reopened = await boot();
  assert.equal(reopened.runtimeBlock, undefined);
  assert.equal(reopened.runOverview.active, null);
  assert.equal(reopened.runOverview.queued, 0);
  assert.equal(reopened.runOverview.total, 3);
  assert.equal((await call('run.detail', { id: original.id })).run.state, 'INTERRUPTED');
  assert.deepEqual((await call('run.detail', { id: original.id })).events, originalEvents);
  assert.equal(
    (await call('run.detail', { id: queued.id })).run.state,
    'CANCELLED',
    '明确退出取消尚未开始的队列',
  );
  assert.equal(
    (await call('run.detail', { id: queued.id })).events.filter(
      (event: any) => event.type === 'node-start',
    ).length,
    0,
  );
  const recoveredId = await create('重开后人工发起', prefix(), true);
  await page.getByRole('button', { name: '打开网页面板', exact: true }).click();
  const recovered: Run = await call('flow.run', { id: recoveredId });
  await terminal(recovered.id, 'SUCCEEDED');
  assert.deepEqual(await nativeForm(), {
    width: 1920,
    name: '虚构回收测试',
    radio: true,
    select: 'engineering',
  });
  evidence.runs.push(recovered.id);
  note('full-restart-preserves-history-without-replay-and-new-manual-run-succeeds');
  // A completed Run leaves a healthy, unowned page. Losing it must not strand
  // the Host's old lease once Main has really destroyed that page.
  const idlePage = await app!.evaluate(async ({ BrowserWindow }) => {
    const wc = (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents;
    const id = wc.id;
    const destroyed = new Promise<void>((resolve) => wc.once('destroyed', resolve));
    wc.close({ waitForBeforeUnload: false });
    await destroyed;
    return { id, destroyed: wc.isDestroyed() };
  });
  assert.equal(idlePage.destroyed, true);
  await wait(async () => !(await call('browser.embedded.status')).started, '空闲页面实际关闭');
  assert.equal((await boot()).runtimeBlock, undefined);
  const afterIdleLoss: Run = await call('flow.run', { id: recoveredId });
  await terminal(afterIdleLoss.id, 'SUCCEEDED');
  assert.deepEqual(await nativeForm(), {
    width: 1920,
    name: '虚构回收测试',
    radio: true,
    select: 'engineering',
  });
  assert.notEqual(
    await app!.evaluate(
      ({ BrowserWindow }) =>
        (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents.id,
    ),
    idlePage.id,
  );
  evidence.runs.push(afterIdleLoss.id);
  note('idle-page-loss-confirmed-close-allows-a-fresh-run-and-native-page');
  await gracefulQuit();

  await launch(previewData);
  await call('browser.embedded.enable');
  await page.getByRole('button', { name: '打开网页面板', exact: true }).click();
  await call('browser.embedded.navigate', { url: lab.url });
  const previewValue = await create('无租约预览故障后禁止执行', [
    { id: 'value', type: 'value', version: 1, value: 1 },
  ]);
  await armCloseFailure();
  await app!.evaluate(() => {
    (globalThis as any).cleanupTest.old.forcefullyCrashRenderer();
  });
  await wait(async () => !!(await boot()).runtimeBlock, '无租约预览未知回收通知');
  assert.equal((await boot()).runOverview.total, 0);
  await assert.rejects(call('flow.run', { id: previewValue }), /回收|关闭|停止|重开/);
  assert.equal((await nativeEvidence()).alive, true);
  await app!.evaluate(() => {
    const state = (globalThis as any).cleanupTest;
    state.old.close = state.originalClose;
    state.originalClose({ waitForBeforeUnload: false });
  });
  await wait(async () => (await nativeEvidence()).destroyed, '迟到真实原生销毁');
  assert.ok((await boot()).runtimeBlock, '迟到销毁不能隐式恢复或重放');
  await assert.rejects(call('flow.run', { id: previewValue }), /回收|关闭|停止|重开/);
  assert.deepEqual((await nativeEvidence()).errors, []);
  note('unleased-preview-failure-blocks-all-runs-and-late-destruction-does-not-unlock');
  assert.equal(lab.state.attempts, 0);
  await gracefulQuit();
  evidence.passed = true;
} catch (error) {
  evidence.error = String(error);
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  await lab.close();
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/embedded-cleanup.json', JSON.stringify(evidence, null, 2));
}
