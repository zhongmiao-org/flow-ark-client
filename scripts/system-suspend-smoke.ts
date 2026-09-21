import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import electronPath from 'electron';
import type { Run, Step } from '../src/shared/types';
import { startFormLab } from './fixtures/platform-page';
import { formBrowser, formExpected, formLabFlow, formText } from './fixtures/platform-flow';

// Real application/Host/Worker/WebContents and localhost receipts. powerMonitor
// events are explicitly injected; this is not a hardware sleep/wake test.
const data = await mkdtemp('/private/tmp/flowark-system-suspend-');
const lab = await startFormLab();
await writeFile(join(data, 'fictional.txt'), formText);
const receipts: string[] = [];
const receiver = createServer((request, response) => {
  receipts.push(request.url ?? '/');
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ accepted: true, path: request.url }));
});
await new Promise<void>((done) => receiver.listen(0, '127.0.0.1', done));
const receiptUrl = `http://127.0.0.1:${(receiver.address() as { port: number }).port}`;
let app: ElectronApplication | undefined;
let page!: Page;
const evidence: any = {
  passed: false,
  data,
  executable: process.env.FLOWARK_TEST_EXECUTABLE ?? null,
  boundary: 'Electron powerMonitor event fixture, not actual hardware sleep/wake',
  checks: [],
  runs: [],
  power: [],
  exits: [],
};
const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const wait = async (check: () => Promise<boolean>, label: string, timeout = 30000) => {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() >= end) throw new Error('系统挂起验证等待超时：' + label);
    await delay(50);
  }
};
const call = (method: string, args: any = {}): Promise<any> =>
  page.evaluate(({ method, args }) => (window as any).flowark.request(method, args), {
    method,
    args,
  });
const button = (name: string) => page.getByRole('button', { name, exact: true });
const note = (check: string) => {
  evidence.checks.push(check);
  console.log(check);
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
  await page.waitForFunction(() => Boolean((window as any).flowark));
  const boot = await call('bootstrap');
  assert.ok(!boot.fault && !boot.runtimeBlock, JSON.stringify(boot));
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
};
const create = async (name: string, steps: Step[], browser = false, credentials: string[] = []) => {
  const record = await call('flow.create');
  await call('flow.save', {
    flow: { ...record.flow, name, steps },
    bindings: { files: {}, credentials, ...(browser ? { browserId: 'embedded' } : {}) },
  });
  return record.id as string;
};
const http = (id: string): Step => ({
  id,
  type: 'http',
  version: 1,
  method: 'POST',
  url: receiptUrl + '/' + id,
  headers: {},
  body: {},
});
const run = async (id: string): Promise<Run> => {
  const result = await call('flow.run', { id });
  evidence.runs.push(result.id);
  return result;
};
const state = async (id: string, expected: string, timeout = 30000) => {
  let result: any;
  await wait(
    async () => {
      result = await call('run.detail', { id });
      if (
        result.run.state !== expected &&
        ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(result.run.state)
      )
        throw new Error('非预期运行终态：' + JSON.stringify(result.run));
      return result.run.state === expected;
    },
    id + ' -> ' + expected,
    timeout,
  );
  return result;
};
const openRun = async (id: string) => {
  await button('运行记录').click();
  if (await button('全部记录').count()) await button('全部记录').click();
  await page.getByLabel('搜索运行记录', { exact: true }).fill(id);
  await button('查询').click();
  await page
    .locator('.run-history tbody tr')
    .filter({ has: page.locator(`small[title="${id}"]`) })
    .getByRole('button', { name: '查看', exact: true })
    .click();
  await page.getByRole('region', { name: '运行概览', exact: true }).waitFor();
  await wait(
    async () => (await page.locator('.run-meta').innerText()).includes(id.slice(0, 8)),
    'selected Run',
  );
};
const formValues = () =>
  app!.evaluate(async ({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0].contentView
      .children[0] as Electron.WebContentsView;
    return view.webContents.executeJavaScript(`({width:innerWidth,
    name:document.querySelector('#full-name').value,
    radio:document.querySelector('#channel-email').checked,
    department:document.querySelector('#department').value})`);
  });
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
        (item) => item.label === '退出 FlowArk',
      );
      if (!item) throw new Error('退出菜单缺失');
      item.click();
    });
    const result = await ended;
    app = undefined;
    evidence.exits.push(result);
    assert.deepEqual(result, { code: 0, signal: null }, 'forced cleanup is not a successful quit');
  } finally {
    clearTimeout(timeout);
  }
};

// Observe only the isolated Main's real UtilityProcess RPC messages. The optional
// gate captures one exact credentials.list reply after Vault has produced it.
// No Host result is synthesized and the product's power-event listeners remain intact.
const installBoundary = async () =>
  app!.evaluate(({ ipcMain }) => {
    const EventEmitter = process.getBuiltinModule('node:events').EventEmitter;
    const originalEmit = EventEmitter.prototype.emit;
    const handlers = (ipcMain as any)._invokeHandlers as Map<
      string,
      (...args: any[]) => Promise<any>
    >;
    const originalHandler = handlers.get('flowark:request')!;
    const fixture: any = ((globalThis as any).suspendFixture = {
      powerRequests: new Map(),
      power: [],
      credentials: new Set(),
      gateId: undefined,
      holdBootstrap: false,
      bootstrapWaiters: [],
      armed: false,
      pending: false,
    });
    EventEmitter.prototype.emit = function (this: any, event: string | symbol, ...args: any[]) {
      const message = args[0];
      if (event === 'message' && message?.rpc && typeof (this as any).postMessage === 'function') {
        if (!fixture.host && message.method === 'credentials.list') {
          fixture.host = this;
          fixture.originalPost = (this as any).postMessage;
          (this as any).postMessage = function (this: any, message: any, ...rest: any[]) {
            if (message.method === 'system.suspend' || message.method === 'system.resume')
              fixture.powerRequests.set(message.rpc, message.method);
            if (message.reply && fixture.credentials.has(message.rpc)) {
              fixture.credentials.delete(message.rpc);
              if (message.rpc === fixture.gateId) {
                fixture.pending = true;
                fixture.reply = message;
                fixture.release = () =>
                  Reflect.apply(fixture.originalPost, this, [message, ...rest]);
                return;
              }
            }
            return Reflect.apply(fixture.originalPost, this, [message, ...rest]);
          };
        }
        if (this === fixture.host) {
          if (message.method === 'credentials.list') {
            fixture.credentials.add(message.rpc);
            if (fixture.armed) {
              fixture.armed = false;
              fixture.gateId = message.rpc;
            }
          }
          if (message.reply && fixture.powerRequests.has(message.rpc)) {
            fixture.power.push({
              method: fixture.powerRequests.get(message.rpc),
              error: message.error ?? null,
              result: message.result,
            });
            fixture.powerRequests.delete(message.rpc);
          }
        }
      }
      return Reflect.apply(originalEmit, this, [event, ...args]);
    };
    handlers.set('flowark:request', async (...args: any[]) => {
      if (args[1] === 'bootstrap' && fixture.holdBootstrap)
        await new Promise<void>((resolve) => fixture.bootstrapWaiters.push(resolve));
      if (args[1] === 'flow.run' && args[2]?.id === fixture.target) fixture.armed = true;
      return Reflect.apply(originalHandler, undefined, args);
    });
    fixture.restore = () => {
      EventEmitter.prototype.emit = originalEmit;
      if (fixture.host) fixture.host.postMessage = fixture.originalPost;
      handlers.set('flowark:request', originalHandler);
      fixture.holdBootstrap = false;
      for (const resolve of fixture.bootstrapWaiters.splice(0)) resolve();
    };
  });
const power = async (event: 'suspend' | 'resume') => {
  const index = await app!.evaluate(({ powerMonitor }, event) => {
    const before = (globalThis as any).suspendFixture.power.length;
    powerMonitor.emit(event);
    return before;
  }, event);
  await wait(
    () =>
      app!.evaluate((_, index) => (globalThis as any).suspendFixture.power.length > index, index),
    'real Host power acknowledgement',
  );
  const result = await app!.evaluate(
    (_, index) => (globalThis as any).suspendFixture.power[index],
    index,
  );
  assert.equal(result.method, 'system.' + event);
  assert.equal(result.error, null, JSON.stringify(result));
  assert.equal(result.result, true);
  evidence.power.push(result);
};

try {
  await launch();
  await installBoundary();
  await call('bootstrap'); // Discover the actual Main-owned Host, without exposing a product test API.
  await button('本地设置').click();
  await button('启用内置浏览器').click();
  await button('启用内置浏览器').waitFor({ state: 'hidden' });
  await button('打开网页面板').click();
  const activeId = await create(
    '挂起：虚构网页等待',
    [
      formBrowser('open', 'navigate', '', lab.url),
      formBrowser('name', 'fill', '#full-name', '虚构挂起用户'),
      formBrowser('radio', 'check', '#channel-email', true),
      formBrowser('department', 'select', '#department', 'engineering'),
      { id: 'human', name: '等待挂起前人工核对', type: 'human', version: 1, message: '仅虚构数据' },
      http('active_after_wait'),
    ],
    true,
  );
  const queuedId = await create('挂起：排队不得提交', [http('queued_after_suspend')]);
  const active = await run(activeId);
  await state(active.id, 'WAITING_INPUT');
  await openRun(active.id);
  assert.deepEqual(await formValues(), {
    width: 1920,
    name: '虚构挂起用户',
    radio: true,
    department: 'engineering',
  });
  const queued = await run(queuedId);
  await state(queued.id, 'QUEUED');
  evidence.oldWebContents = await app!.evaluate(({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0].contentView
      .children[0] as Electron.WebContentsView;
    const contents = view.webContents;
    const fixture = (globalThis as any).suspendFixture;
    fixture.oldContents = contents;
    fixture.destroyed = false;
    contents.once('destroyed', () => {
      fixture.destroyed = true;
    });
    return { id: contents.id, destroyed: contents.isDestroyed() };
  });
  assert.equal(evidence.oldWebContents.destroyed, false);
  await power('suspend');
  const cancelled = await state(active.id, 'CANCELLED');
  const cancelledQueue = await state(queued.id, 'CANCELLED');
  await wait(
    () =>
      app!.evaluate(() => {
        const fixture = (globalThis as any).suspendFixture;
        return fixture.destroyed && fixture.oldContents.isDestroyed();
      }),
    'exact old WebContents destroyed',
  );
  await wait(
    async () => (await call('bootstrap')).execution.active === null,
    'Host released active Run',
  );
  assert.ok(cancelled.events.some((event: any) => event.type === 'system-suspend'));
  assert.ok(cancelledQueue.events.some((event: any) => event.type === 'system-suspend'));
  assert.equal(cancelledQueue.events.filter((event: any) => event.type === 'node-start').length, 0);
  assert.deepEqual(receipts, []);
  await power('resume');
  assert.equal((await call('run.detail', { id: active.id })).run.state, 'CANCELLED');
  assert.equal((await call('run.detail', { id: queued.id })).run.state, 'CANCELLED');
  assert.deepEqual(receipts, []);
  note('injected-suspend-cancels-real-active-and-queued-runs-and-confirms-native-destruction');

  // Prevent Renderer bootstrap polling from consuming the credential gate. Any
  // already-started Vault list must settle before arming the target flow.run.
  await call('credentials.set', { id: 'deepseek', value: 'fictional-suspend-credential' });
  const delayedId = await create('挂起：旧准入不得复活', [http('delayed_admission')], false, [
    'deepseek',
  ]);
  const countBefore = (await call('bootstrap')).runOverview.total;
  await app!.evaluate((_, id) => {
    const fixture = (globalThis as any).suspendFixture;
    fixture.holdBootstrap = true;
    fixture.target = id;
  }, delayedId);
  await wait(
    () => app!.evaluate(() => (globalThis as any).suspendFixture.credentials.size === 0),
    'existing credential reads finish',
  );
  const delayed = call('flow.run', { id: delayedId }).then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error: String(error) }),
  );
  await wait(
    () => app!.evaluate(() => (globalThis as any).suspendFixture.pending === true),
    'real credential reply held',
  );
  evidence.credentialGate = await app!.evaluate(() => {
    const fixture = (globalThis as any).suspendFixture;
    return {
      rpc: fixture.gateId,
      reply: fixture.reply.reply,
      result: fixture.reply.result,
      error: fixture.reply.error ?? null,
    };
  });
  assert.equal(evidence.credentialGate.reply, true);
  assert.equal(evidence.credentialGate.error, null);
  assert.deepEqual(evidence.credentialGate.result, ['deepseek']);
  await power('suspend');
  await power('resume');
  await app!.evaluate(() => {
    const fixture = (globalThis as any).suspendFixture;
    fixture.target = undefined;
    fixture.release();
    fixture.pending = false;
    fixture.holdBootstrap = false;
    for (const resolve of fixture.bootstrapWaiters.splice(0)) resolve();
  });
  const rejected = await delayed;
  assert.equal(rejected.ok, false, JSON.stringify(rejected));
  evidence.revokedAdmission = rejected;
  assert.equal((await call('bootstrap')).runOverview.total, countBefore);
  assert.deepEqual(receipts, []);
  const fresh = await run(delayedId);
  await state(fresh.id, 'SUCCEEDED');
  assert.deepEqual(receipts, ['/delayed_admission']);
  note('held-genuine-credentials-reply-cannot-revive-pre-suspend-admission-after-resume');

  const record = await call('flow.create');
  const flow = { ...formLabFlow(lab.url), id: record.id, name: '恢复：新人工核对与复杂表单收据' };
  flow.steps.splice(
    flow.steps.findIndex((node) => node.id === 'submit'),
    0,
    {
      id: 'review',
      name: '恢复后人工核对',
      type: 'human',
      version: 1,
      message: '确认虚构表单后继续',
    },
  );
  await call('flow.save', {
    flow,
    bindings: { files: { work: data }, browserId: 'embedded', credentials: [] },
  });
  const recovered = await run(record.id);
  await state(recovered.id, 'WAITING_INPUT', 90000);
  await openRun(recovered.id);
  assert.deepEqual(await formValues(), {
    width: 1920,
    name: formExpected.fullName,
    radio: true,
    department: 'engineering',
  });
  assert.equal(lab.state.attempts, 0);
  await page.screenshot({ path: join(data, 'recovered-human-review.png') });
  await button('继续').click();
  await state(recovered.id, 'SUCCEEDED', 60000);
  assert.equal(lab.state.accepted.length, 1);
  assert.equal(lab.state.attempts, 1);
  assert.equal(lab.state.rejected, 0);
  assert.deepEqual(lab.state.accepted[0].fields, formExpected);
  const savedReceipt = JSON.parse(await readFile(join(data, 'form-receipt.json'), 'utf8'));
  assert.deepEqual(savedReceipt, lab.state.accepted[0]);
  evidence.formReceipt = savedReceipt;
  note('new-post-resume-human-run-submits-real-complex-form-at-1920-css-pixels');
  await wait(
    async () => (await call('bootstrap')).execution.active === null,
    'new Run fully closed',
  );
  const beforeQuit = await call('bootstrap');
  const history = beforeQuit.runs.map((item: Run) => ({ id: item.id, state: item.state }));
  assert.equal(beforeQuit.execution.active, null);
  await app!.evaluate(() => (globalThis as any).suspendFixture.restore());
  await gracefulQuit();
  await launch();
  const reopened = await call('bootstrap');
  assert.deepEqual(
    reopened.runs.map((item: Run) => ({ id: item.id, state: item.state })),
    history,
  );
  assert.equal(reopened.runOverview.total, beforeQuit.runOverview.total);
  assert.equal(reopened.execution.active, null);
  await openRun(recovered.id);
  await delay(2250);
  assert.equal(lab.state.attempts, 1);
  assert.deepEqual(receipts, ['/delayed_admission']);
  assert.equal((await call('run.detail', { id: active.id })).run.state, 'CANCELLED');
  assert.equal((await call('run.detail', { id: queued.id })).run.state, 'CANCELLED');
  await page.screenshot({ path: join(data, 'reopened-history.png') });
  note('normal-reopen-retains-terminal-history-without-replaying-any-receipt');
  await gracefulQuit();
  evidence.passed = true;
} catch (error) {
  evidence.error = error instanceof Error ? error.stack : String(error);
  if (app && page) {
    evidence.main = await app
      .evaluate(() => {
        const fixture = (globalThis as any).suspendFixture;
        return (
          fixture && {
            power: fixture.power,
            pending: fixture.pending,
            gateId: fixture.gateId,
            destroyed: fixture.destroyed,
            oldDestroyed: fixture.oldContents?.isDestroyed(),
          }
        );
      })
      .catch((error) => ({ error: String(error) }));
    await app
      .evaluate(() => {
        const fixture = (globalThis as any).suspendFixture;
        if (fixture?.pending) {
          fixture.release();
          fixture.pending = false;
        }
        fixture?.restore();
      })
      .catch(() => {});
    evidence.bootstrap = await call('bootstrap').catch((error) => ({ error: String(error) }));
    evidence.browser = await call('browser.embedded.status').catch((error) => ({
      error: String(error),
    }));
    evidence.ui = await page
      .locator('main')
      .innerText()
      .catch(() => null);
    await page.screenshot({ path: join(data, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  if (app)
    await app.close().catch((error) => {
      evidence.cleanupError = String(error);
    });
  await lab.close();
  receiver.closeAllConnections();
  await new Promise<void>((done) => receiver.close(() => done()));
  evidence.receipts = receipts;
  evidence.formAttempts = lab.state.attempts;
  await mkdir('test-results', { recursive: true });
  await writeFile(join(data, 'evidence.json'), JSON.stringify(evidence, null, 2));
  await writeFile('test-results/system-suspend.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
