import assert from 'node:assert/strict';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Store } from '../src/host/store';
import type { Run, Schedule } from '../src/shared/types';
import { startFormLab } from './fixtures/platform-page';
import { formBrowser } from './fixtures/platform-flow';

// Intentionally uses the production one-second timer and four real minute deadlines.
// No direct Runtime.tick(), fake clock, daily profile, or external website is involved.
const data = await mkdtemp('/private/tmp/flowark-schedule-residency-');
const lab = await startFormLab();
const began = performance.now();
const evidence: any = { passed: false, data, startedAt: new Date().toISOString(), checkpoints: [] };
let app: ElectronApplication | undefined;
let page: Page;
let key: Buffer | undefined;
let scheduleId = '';
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const note = (stage: string, values: object = {}) => {
  const checkpoint = { stage, at: new Date().toISOString(), ...values };
  evidence.checkpoints.push(checkpoint);
  console.log(JSON.stringify(checkpoint));
};
const call = (method: string, args: any = {}): Promise<any> =>
  page.evaluate(({ method, args }) => (window as any).flowark.request(method, args), {
    method,
    args,
  });
const wait = async (predicate: () => Promise<boolean>, label: string, ms = 20000) => {
  const end = performance.now() + ms;
  while (!(await predicate())) {
    if (performance.now() > end) throw new Error('真实计时验收超时：' + label);
    await pause(250);
  }
};
const boot = async () => {
  const result = await call('bootstrap');
  assert.ok(!result.fault, result.fault);
  return result;
};
const schedule = async (): Promise<Schedule> => {
  const found = (await boot()).schedules.find((s: Schedule) => s.id === scheduleId);
  assert.ok(found, '计划必须保留');
  return found;
};
const runs = async (): Promise<Run[]> =>
  (await boot()).runs.filter((r: Run) => r.scheduleId === scheduleId);
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
};
const stop = async () => {
  const current = app!;
  const child = current.process();
  const ended =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve({ code: child.exitCode, signal: child.signalCode })
      : new Promise<{ code: number | null; signal: string | null }>((r) =>
          child.once('exit', (code, signal) => r({ code, signal })),
        );
  await current.evaluate(({ Menu }) => {
    const quit = Menu.getApplicationMenu()?.items[0].submenu?.items.find(
      (item) => item.label === '退出 FlowArk',
    );
    if (!quit) throw new Error('退出菜单不存在');
    setTimeout(() => quit.click(), 100);
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
  const result = await ended.finally(() => clearTimeout(timeout));
  app = undefined;
  assert.deepEqual(result, { code: 0, signal: null }, '必须正常退出测试实例');
};
const verifyBackground = async (mode: 'minimized' | 'tray') => {
  const state = await app!.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const view = win.contentView.children[0] as Electron.WebContentsView;
    return {
      count: BrowserWindow.getAllWindows().length,
      minimized: win.isMinimized(),
      visible: win.isVisible(),
      focused: win.isFocused(),
      shown: (globalThis as any).__scheduleShown,
      form: await view.webContents.executeJavaScript(`({
        width: innerWidth,
        name: document.querySelector('#full-name').value,
        email: document.querySelector('#channel-email').checked,
        department: document.querySelector('#department').value
      })`),
    };
  });
  assert.equal(state.count, 1);
  assert.equal(state.focused, false);
  assert.deepEqual(state.shown, []);
  if (mode === 'minimized') assert.equal(state.minimized, true);
  else assert.equal(state.visible, false);
  assert.deepEqual(state.form, {
    width: 1920,
    name: '虚构定时用户',
    email: true,
    department: 'engineering',
  });
  assert.equal((await call('browser.embedded.status')).visible, false);
  note(mode + '-form', state);
};
const waitingRun = async (count: number, dueAt: number) => {
  let found: Run | undefined;
  await wait(
    async () => {
      const list = await runs();
      assert.ok(list.length <= count, '同一次触发不得生成额外 Run');
      for (const run of list)
        assert.ok(!['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(run.state), run.error);
      found = list.find((r) => r.state === 'WAITING_INPUT');
      return list.length === count && !!found;
    },
    '后台计划真实到期并填写表单',
    Math.max(0, dueAt - Date.now()) + 30000,
  );
  assert.ok(found);
  assert.equal(found.source, 'schedule');
  assert.ok(Date.parse(found.createdAt) >= dueAt, '不能提前执行');
  assert.ok(Date.parse(found.createdAt) < dueAt + 10000, '必须由当前真实周期触发');
  note('scheduled-run', { id: found.id, createdAt: found.createdAt, dueAt });
  return found;
};
const finish = async (id: string) => {
  await call('run.control', { id, action: 'resume' });
  await wait(async () => {
    const detail = await call('run.detail', { id });
    assert.ok(!['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(detail.run.state), detail.run.error);
    return detail.run.state === 'SUCCEEDED';
  }, '继续后完成');
};
try {
  await launch();
  evidence.version = await app!.evaluate(({ app }) => app.getVersion());
  await page!.getByRole('button', { name: '本地设置', exact: true }).click();
  await page!.getByRole('button', { name: '启用内置浏览器', exact: true }).click();
  await wait(
    async () => (await boot()).browsers.some((b: any) => b.product === 'embedded'),
    '启用内置模式',
  );
  const browser = (await boot()).browsers.find((b: any) => b.product === 'embedded');
  const record = await call('flow.create');
  const flow = {
    ...record.flow,
    name: '虚构表单真实计时',
    steps: [
      formBrowser('open', 'navigate', '', lab.url),
      formBrowser('name', 'fill', '#full-name', '虚构定时用户'),
      formBrowser('email', 'check', '#channel-email', true),
      formBrowser('department', 'select', '#department', 'engineering'),
      { id: 'wait', type: 'human', version: 1, message: '隔离验收等待下一次真实分钟周期' },
    ],
  };
  const bindings = { files: {}, browserId: browser.id, credentials: [] };
  await call('flow.save', { flow, bindings });
  await page!.getByRole('button', { name: '本机计划', exact: true }).click();
  await page!.locator('.page .panel select').selectOption(record.id);
  await page!.getByRole('spinbutton').fill('1');
  const creatingAt = Date.now();
  await page!.getByRole('button', { name: '创建计划', exact: true }).click();
  await wait(async () => (await boot()).schedules.length === 1, '从界面创建计划');
  const initial: Schedule = (await boot()).schedules[0];
  scheduleId = initial.id;
  assert.equal(initial.intervalMinutes, 1);
  assert.ok(initial.nextAt >= creatingAt + 60000);
  evidence.schedule = initial;
  // Editing the draft after scheduling must not change the scheduled browser input.
  await call('flow.save', {
    flow: { ...flow, steps: [formBrowser('changed', 'navigate', '', lab.url + '/missing')] },
    bindings,
  });
  key = Buffer.from(
    await app!.evaluate(
      async ({ safeStorage }, encrypted) =>
        (await safeStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'))).result,
      (await readFile(join(data, 'credentials', 'data-key.enc'))).toString('base64'),
    ),
    'base64',
  );
  await app!.evaluate(({ app, BrowserWindow }) => {
    (globalThis as any).__scheduleShown = [];
    for (const win of BrowserWindow.getAllWindows())
      win.on('show', () => (globalThis as any).__scheduleShown.push(win.id));
    app.on('browser-window-created', (_event, win) =>
      win.on('show', () => (globalThis as any).__scheduleShown.push(win.id)),
    );
    BrowserWindow.getAllWindows()[0].minimize();
  });
  note('created-and-minimized', { nextAt: initial.nextAt });
  const first = await waitingRun(1, initial.nextAt);
  assert.equal(first.versionId, initial.versionId);
  await verifyBackground('minimized');
  const occupiedDue = (await schedule()).nextAt;
  note('waiting-for-occupied-deadline', { nextAt: occupiedDue });
  await wait(
    async () => {
      const list = await runs();
      assert.equal(list.length, 1);
      assert.equal(list[0].state, 'WAITING_INPUT');
      return (await schedule()).nextAt > occupiedDue;
    },
    '占用期间跳过下一次真实到期',
    Math.max(0, occupiedDue - Date.now()) + 10000,
  );
  note('occupied-deadline-passed', { runs: (await runs()).length });
  await finish(first.id);
  // Close through the real handler: the process must stay resident in the tray.
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  const trayDue = (await schedule()).nextAt;
  note('closed-to-tray', { nextAt: trayDue });
  const second = await waitingRun(2, trayDue);
  assert.equal(second.versionId, initial.versionId);
  await verifyBackground('tray');
  await finish(second.id);
  const missedDue = (await schedule()).nextAt;
  await stop();
  assert.ok(Date.now() < missedDue, '必须在下次到期前完成退出');
  note('exited-before-deadline', { nextAt: missedDue });
  await wait(async () => Date.now() >= missedDue + 1500, '退出期间经过真实到期时间', 75000);
  const reopeningAt = Date.now();
  await launch();
  const restarted = await schedule();
  assert.ok(restarted.nextAt >= reopeningAt + 60000, '重启必须跳过退出期间的到期');
  // Leave more than two production ticks to detect any queued catch-up.
  const observeEnd = performance.now() + 3500;
  while (performance.now() < observeEnd) {
    assert.equal((await runs()).length, 2);
    await pause(250);
  }
  await page!.getByRole('button', { name: '本机计划', exact: true }).click();
  await page!.getByRole('button', { name: '暂停计划', exact: true }).click();
  await wait(async () => !(await schedule()).enabled, '界面停用计划');
  assert.deepEqual(
    (await runs()).map((r) => r.state),
    ['SUCCEEDED', 'SUCCEEDED'],
  );
  assert.equal(lab.state.attempts, 0);
  note('reopened-without-catchup', { nextAt: restarted.nextAt, runs: 2 });
  await stop();
  // Read only our isolated encrypted records after its writer process has exited.
  const store = new Store(join(data, 'flowark.sqlite'), Buffer.from(key));
  try {
    const logs = store.list('schedule-log').filter((log) => log.scheduleId === scheduleId);
    assert.equal(logs.length, 2);
    assert.equal(logs[0].reason, 'occupied');
    assert.ok(logs[0].time >= occupiedDue && logs[0].time < occupiedDue + 10000);
    assert.equal(logs[1].reason, 'application-restart');
    assert.equal(logs[1].from, missedDue);
    assert.ok(logs[1].to >= reopeningAt);
    const saved = store.list<Run>('run');
    assert.equal(saved.length, 2);
    assert.ok(saved.every((r) => r.state === 'SUCCEEDED' && r.versionId === initial.versionId));
    evidence.logs = logs;
    evidence.runs = saved;
    evidence.passed = true;
  } finally {
    store.close();
  }
} catch (error) {
  evidence.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  key?.fill(0);
  if (app) {
    // Failure cleanup affects this isolated test process only.
    const current = app;
    const cleanupTimeout = setTimeout(() => current.process().kill('SIGKILL'), 15000);
    try {
      await call('schedule.toggle', { id: scheduleId, enabled: false }).catch(() => {});
      const active: Run[] = await runs().catch(() => []);
      for (const run of active.filter(
        (r) => !['SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED'].includes(r.state),
      ))
        await call('run.control', { id: run.id, action: 'cancel' }).catch(() => {});
      await current.close().catch(() => current.process().kill('SIGKILL'));
    } finally {
      clearTimeout(cleanupTimeout);
    }
  }
  await lab.close();
  evidence.elapsedSeconds = Math.round((performance.now() - began) / 1000);
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/schedule-residency.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
