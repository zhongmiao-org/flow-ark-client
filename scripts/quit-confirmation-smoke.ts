import assert from 'node:assert/strict';
import { desktopElectron as electron } from './desktop-session.mjs';
import { type ElectronApplication, type Page } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Bootstrap, Run } from '../src/shared/types';

// Real Electron menu/before-quit paths, host, Worker, queue and persistent records.
// Only the native message box is replaced, to inspect its text and hold/release a response.
// All records are created through normal IPC in an isolated data directory.
const data = await mkdtemp('/private/tmp/flowark-quit-confirmation-');
const evidence: any = {
  passed: false,
  data,
  startedAt: new Date().toISOString(),
  testInjection: 'dialog.showMessageBox response control only; no fake runs or host responses',
  checks: [],
};
let app: ElectronApplication | undefined;
let page: Page;
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const wait = async (predicate: () => Promise<boolean>, label: string, timeout = 20000) => {
  const end = performance.now() + timeout;
  while (!(await predicate())) {
    if (performance.now() > end) throw new Error('退出确认验收超时：' + label);
    await pause(50);
  }
};
const note = (check: string) => {
  evidence.checks.push(check);
  console.log(check);
};
const call = (method: string, args: any = {}): Promise<any> =>
  page.evaluate(({ method, args }) => (window as any).flowark.request(method, args), {
    method,
    args,
  });
const boot = async (): Promise<Bootstrap> => {
  const result = await call('bootstrap');
  assert.ok(!result.fault, result.fault);
  return result;
};
const launch = async () => {
  app = await electron.launch({
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
  page = await app.firstWindow();
  await page.waitForFunction(() => !!(window as any).flowark);
  await boot();
  await app.evaluate(({ dialog }) => {
    const state = {
      dialogs: [] as Electron.MessageBoxOptions[],
      pending: [] as any[],
      auto: false,
    };
    (globalThis as any).__quitConfirmation = state;
    (dialog as any).showMessageBox = (_window: unknown, options: Electron.MessageBoxOptions) => {
      state.dialogs.push(options);
      if (state.auto) return Promise.resolve({ response: 1, checkboxChecked: false });
      return new Promise((resolve) => state.pending.push(resolve));
    };
  });
};
const dialogs = () =>
  app!.evaluate(() =>
    (globalThis as any).__quitConfirmation.dialogs.map((options: Electron.MessageBoxOptions) => ({
      message: options.message,
      buttons: options.buttons,
      defaultId: options.defaultId,
      cancelId: options.cancelId,
    })),
  );
const requestQuit = (repeat = false) =>
  app!.evaluate(({ Menu, app }, repeat) => {
    const item = Menu.getApplicationMenu()?.items[0].submenu?.items.find(
      (entry) => entry.label === '退出 FlowArk',
    );
    if (!item) throw new Error('退出菜单不存在');
    item.click();
    if (repeat) {
      item.click();
      app.quit();
    }
  }, repeat);
const answer = async (response: 0 | 1) => {
  await app!.evaluate(async (_electron, response) => {
    const pending = (globalThis as any).__quitConfirmation.pending;
    if (pending.length !== 1) throw new Error('必须只有一个待答复的退出确认');
    pending.shift()({ response, checkboxChecked: false });
    await new Promise<void>((resolve) => setImmediate(resolve));
  }, response);
};
const expectDialog = async (count: number, affected: number) => {
  await wait(async () => (await dialogs()).length >= count, '退出确认出现');
  const actual = await dialogs();
  assert.equal(actual.length, count, '重复退出请求不得叠加确认');
  assert.deepEqual(actual[count - 1], {
    message: `退出会停止 ${affected} 个运行及驻留计划`,
    buttons: ['继续运行', '停止任务并退出'],
    defaultId: 0,
    cancelId: 0,
  });
};
const exitResult = (current: ElectronApplication) => {
  const child = current.process();
  return child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve({ code: child.exitCode, signal: child.signalCode })
    : new Promise<{ code: number | null; signal: string | null }>((resolve) =>
        child.once('exit', (code, signal) => resolve({ code, signal })),
      );
};
try {
  await launch();
  evidence.version = await app!.evaluate(({ app }) => app.getVersion());
  const record = await call('flow.create');
  await call('flow.save', {
    flow: {
      ...record.flow,
      name: '虚构退出确认等待',
      steps: [{ id: 'wait', type: 'human', version: 1, message: '退出确认回归，继续等待' }],
    },
    bindings: { files: {}, credentials: [] },
  });
  const active: Run = await call('flow.run', { id: record.id });
  await wait(
    async () => (await call('run.detail', { id: active.id })).run.state === 'WAITING_INPUT',
    '真实 Worker 等待人工',
  );
  const queued: Run[] = [];
  for (let i = 0; i < 205; i++) queued.push(await call('flow.run', { id: record.id }));
  const assertWaiting = async (count: number) => {
    const current = await boot();
    assert.equal(current.runOverview.active?.id, active.id);
    assert.equal(current.runOverview.active?.state, 'WAITING_INPUT');
    assert.equal(current.runOverview.queued, count);
    assert.equal(current.runOverview.total, 206);
    assert.equal(current.runs.length, 200);
    assert.ok(!current.runs.some((run) => run.id === active.id));
    const detail = await call('run.detail', { id: active.id });
    assert.equal(detail.run.state, 'WAITING_INPUT');
    assert.equal(detail.run.versionId, active.versionId);
    return current;
  };
  await assertWaiting(205);
  await requestQuit(true);
  await expectDialog(1, 206);
  await requestQuit(true);
  await expectDialog(1, 206);
  await assertWaiting(205);
  await answer(0);
  await assertWaiting(205);
  assert.equal((await dialogs()).length, 1);
  note('206-real-runs-counted-and-continue-keeps-worker-and-queue');

  for (const run of queued) await call('run.control', { id: run.id, action: 'cancel' });
  const cancelled = await assertWaiting(0);
  assert.ok(cancelled.runs.every((run) => run.state === 'CANCELLED'));
  await requestQuit(true);
  await expectDialog(2, 1);
  await requestQuit(true);
  await expectDialog(2, 1);
  await answer(0);
  await assertWaiting(0);
  assert.equal((await dialogs()).length, 2);
  note('old-waiting-worker-still-prompts-behind-200-terminal-records');
  note('repeated-menu-and-app-quit-requests-share-one-confirmation');

  await requestQuit();
  await expectDialog(3, 1);
  evidence.dialogs = await dialogs();
  evidence.activeId = active.id;
  const current = app!;
  const ended = exitResult(current);
  const timeout = setTimeout(() => current.process().kill('SIGKILL'), 15000);
  const result = await (async () => {
    await answer(1);
    return ended;
  })().finally(() => clearTimeout(timeout));
  app = undefined;
  assert.deepEqual(result, { code: 0, signal: null }, '确认后必须正常退出，不能强杀测试应用');
  evidence.exit = result;
  note('confirmed-quit-exits-normally');

  await launch();
  const reopened = await boot();
  assert.equal(reopened.runOverview.active, null);
  assert.equal(reopened.runOverview.queued, 0);
  assert.equal(reopened.runOverview.total, 206);
  const stopped = await call('run.detail', { id: active.id });
  assert.equal(stopped.run.state, 'CANCELLED', stopped.run.error);
  assert.equal(stopped.run.versionId, active.versionId);
  assert.ok(reopened.runs.every((run) => run.state === 'CANCELLED'));
  for (const run of queued)
    assert.equal((await call('run.detail', { id: run.id })).run.state, 'CANCELLED');
  note('reopen-retains-206-cancelled-runs-without-replay');
  evidence.passed = true;
} catch (error) {
  evidence.error = String(error);
  throw error;
} finally {
  if (app) {
    const current = app;
    const child = current.process();
    if (child.exitCode === null && child.signalCode === null) {
      const ended = exitResult(current);
      const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
      await current
        .evaluate(({ Menu }) => {
          const state = (globalThis as any).__quitConfirmation;
          state.auto = true;
          for (const resolve of state.pending.splice(0))
            resolve({ response: 1, checkboxChecked: false });
          setTimeout(() => {
            Menu.getApplicationMenu()
              ?.items[0].submenu?.items.find((item) => item.label === '退出 FlowArk')
              ?.click();
          }, 50);
        })
        .catch(() => {});
      evidence.cleanupExit = await ended.finally(() => clearTimeout(timeout));
      if (evidence.cleanupExit.code !== 0 || evidence.cleanupExit.signal !== null) {
        evidence.passed = false;
        evidence.cleanupError = '测试实例未正常退出';
        process.exitCode = 1;
      }
    }
  }
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/quit-confirmation.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
