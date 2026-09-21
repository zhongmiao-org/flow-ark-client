import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import electronPath from 'electron';
import type { Flow, FlowRecord, Run } from '../src/shared/types';

const data = await mkdtemp('/private/tmp/flowark-review-ui-'),
  files = join(data, 'files');
await mkdir(files);
const server = createServer((_req, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(
    '<html><head><title>试运行检查页面</title></head><body><h1>虚构页面标题</h1></body></html>',
  );
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${(server.address() as any).port}/`;
const evidence: any = { passed: false, closed: false, data, checks: [], layouts: [] };
let app: ElectronApplication | undefined, page: Page | undefined, failure: unknown;
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const checkPage = () => page!.locator('.run-review-page:not([hidden])');
const call = (method: string, args: any = {}): Promise<any> =>
  page!.evaluate(({ method, args }) => window.flowark.request(method, args), { method, args });
const wait = async (predicate: () => Promise<boolean>, label: string) => {
  const deadline = Date.now() + 15000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(label);
    await new Promise((done) => setTimeout(done, 60));
  }
};
const checkReady = () =>
  checkPage().getByRole('heading', { name: '检查通过', exact: true }).waitFor();
const review = () =>
  checkPage()
    .getByRole('checkbox', { name: '我已核对操作对象、可能更改和保存位置', exact: true })
    .check();
const mode = (next: string) =>
  app!.evaluate((_, next) => {
    (globalThis as any).reviewFixture.mode = next;
  }, next);
const pending = () =>
  wait(
    () => app!.evaluate(() => !!(globalThis as any).reviewFixture.release),
    'Main reply was not held',
  );
const release = () =>
  app!.evaluate(() => {
    const s = (globalThis as any).reviewFixture;
    s.release?.();
    s.release = undefined;
  });
async function capture(width: number, height: number) {
  await app!.evaluate(
    ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height),
    { width, height },
  );
  await page!.waitForFunction((size) => innerWidth === size.width && innerHeight === size.height, {
    width,
    height,
  });
  await page!.locator('main').evaluate((e) => e.scrollTo(0, 0));
  await page!.mouse.move(0, 0);
  const layout = await checkPage().evaluate((element) => ({
    width: innerWidth,
    height: innerHeight,
    overflow: element.scrollWidth > element.clientWidth,
    rootOverflow: document.documentElement.scrollWidth > innerWidth,
    cards: element.querySelectorAll('.run-review-card').length,
    columns: [...element.querySelectorAll('.run-review-columns > *')].map((node) => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  }));
  assert.equal(layout.overflow, false);
  assert.equal(layout.rootOverflow, false);
  assert.equal(layout.cards, 5);
  evidence.layouts.push(layout);
  await page!.screenshot({ path: `test-results/figma/run-review-${width}.png`, scale: 'css' });
}
try {
  await mkdir('test-results/figma', { recursive: true });
  assert.equal(app, undefined);
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: ['.'],
    env: { ...process.env, FLOWARK_DATA_DIR: data },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: '你想完成什么？' }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setTitle('FlowArk · 试运行界面隔离测试（自动退出）'),
  );
  await page.evaluate(() => {
    document.querySelector('.window-titlebar')!.textContent =
      'FlowArk · 试运行界面隔离测试（自动退出）';
  });
  await page.evaluate(() => document.fonts.ready);
  await call('browser.embedded.enable');
  const task = (await call('task.create')).task;
  await call('task.save', {
    id: task.id,
    revision: task.revision,
    description: '读取虚构网页标题并保存到指定目录',
    context: [],
    answers: {},
  });
  const flow: Flow = {
    id: task.flowId,
    formatVersion: '1.0',
    name: '网页标题归档检查',
    description: '',
    parameters: {},
    requiredCapabilities: ['browser', 'file'],
    steps: [
      {
        id: 'open',
        type: 'browser',
        version: 1,
        name: '打开资料页',
        operation: 'navigate',
        selector: '',
        value: url,
      },
      {
        id: 'title',
        type: 'browser',
        version: 1,
        name: '读取页面标题',
        operation: 'read',
        selector: 'h1',
        value: null,
      },
      {
        id: 'save',
        type: 'file',
        version: 1,
        operation: 'write',
        binding: 'work',
        name: 'title.txt',
        content: { $ref: 'steps.title' },
      },
    ],
  };
  await call('flow.save', {
    flow,
    bindings: { files: {}, credentials: [], browserId: 'embedded' },
  });
  await page.locator('.sidebar').getByRole('button', { name: '我的流程', exact: true }).click();
  await page.locator('.sidebar').getByRole('button', { name: '开始任务', exact: true }).click();
  await page.locator('.ai-task-recents button').filter({ hasText: '读取虚构网页标题' }).click();
  await button('确认方案，去试运行').click();
  await checkPage().getByText('目录未绑定：work', { exact: true }).waitFor();
  assert.equal(await button('开始试运行').isEnabled(), false);
  assert.equal((await call('bootstrap')).runs.length, 0);
  await button('配置流程与资源').click();
  await page.locator('.editor-page').waitFor();
  await button('← 返回 AI 任务').click();
  await checkPage().waitFor();
  const record: FlowRecord = await call('flow.save', {
    flow,
    bindings: { files: { work: files }, credentials: [], browserId: 'embedded' },
  });
  await call('browser.embedded.navigate', { url });
  await button('重新检查').click();
  await checkReady();
  await wait(
    async () => (await checkPage().innerText()).includes(files),
    'actual selected directory missing',
  );
  evidence.checks.push('missing-resource-blocks-and-configuration-return');

  await app.evaluate(({ ipcMain }, record) => {
    const handlers = (ipcMain as any)._invokeHandlers as Map<
      string,
      (...args: any[]) => Promise<any>
    >;
    const original = handlers.get('flowark:request')!;
    const state: any = { mode: '', original, record, release: undefined, confirmations: [] };
    (globalThis as any).reviewFixture = state;
    handlers.set('flowark:request', async (...args: any[]) => {
      const method = args[1],
        selected = state.mode;
      if (method === 'flow.run.confirm') state.confirmations.push(structuredClone(args[2]));
      if (selected === 'mutate-confirm' && method === 'flow.run.confirm') {
        state.mode = '';
        state.record.flow.description = 'changed immediately before confirmation';
        await original(args[0], 'flow.save', {
          flow: state.record.flow,
          bindings: state.record.bindings,
        });
      }
      if (selected === 'fail-detail' && method === 'run.detail') {
        state.mode = '';
        throw new Error('fixture: detail reply unavailable');
      }
      const result = await original(...args);
      if (selected === 'lost-confirm' && method === 'flow.run.confirm') {
        state.mode = '';
        throw new Error('fixture: confirmation reply lost after commit');
      }
      if (
        (selected === 'hold-bootstrap' && method === 'bootstrap') ||
        (selected === 'hold-preview' && method === 'flow.run.preview') ||
        (selected === 'hold-confirm' && method === 'flow.run.confirm') ||
        (selected === 'hold-detail' && method === 'run.detail')
      ) {
        state.mode = '';
        await new Promise<void>((done) => {
          state.release = done;
        });
      }
      return result;
    });
  }, record as any);
  await mode('hold-bootstrap');
  await button('配置流程与资源').click();
  await pending();
  await button('回去修改').click();
  await page.locator('.sidebar').getByRole('button', { name: '我的流程', exact: true }).click();
  await release();
  await page.locator('.flows-page').waitFor();
  await page.locator('.sidebar').getByRole('button', { name: '开始任务', exact: true }).click();
  await button('确认方案，去试运行').click();
  await checkReady();
  evidence.checks.push('late-resource-configuration-does-not-steal-navigation');
  await review();
  await checkPage().getByRole('checkbox', { name: '逐步调试，在每个步骤前暂停' }).check();
  await checkReady();
  assert.equal(
    await checkPage()
      .getByRole('checkbox', { name: '我已核对操作对象、可能更改和保存位置' })
      .isChecked(),
    false,
  );
  await checkPage().getByRole('checkbox', { name: '逐步调试，在每个步骤前暂停' }).uncheck();
  await checkReady();
  for (const [width, height] of [
    [1440, 960],
    [1920, 1080],
    [1040, 700],
  ])
    await capture(width, height);
  assert.match(await checkPage().innerText(), /可能覆盖同名文件/);
  evidence.checks.push('real-resources-effects-three-sizes-and-debug-review-reset');

  await mode('hold-preview');
  await button('重新检查').click();
  await pending();
  await button('← 返回确认方案').click();
  await release();
  await button('确认方案，去试运行').waitFor();
  assert.equal(await checkPage().count(), 0);
  await button('确认方案，去试运行').click();
  await checkReady();
  assert.equal(await button('开始试运行').isEnabled(), false);
  assert.equal((await call('bootstrap')).runs.length, 0);
  evidence.checks.push('leave-clears-review-and-late-preview-does-not-reopen');

  await review();
  await mode('mutate-confirm');
  await button('开始试运行').click();
  await checkPage().getByRole('heading', { name: '本次确认未创建运行' }).waitFor();
  assert.equal((await call('bootstrap')).runs.length, 0);
  await button('重新检查').click();
  await checkReady();
  evidence.checks.push('host-rejection-allows-new-review-with-zero-run');

  await review();
  await mode('lost-confirm');
  await button('开始试运行').click();
  await button('查询本次确认结果').waitFor();
  assert.equal((await call('bootstrap')).runs.length, 1);
  await mode('fail-detail');
  await button('查询本次确认结果').click();
  await button('查看本次运行').waitFor();
  const first = (await call('bootstrap')).runs[0] as Run;
  assert.equal(await checkPage().locator('[data-run-id]').innerText(), first.id);
  await checkPage().getByRole('alert').filter({ hasText: '运行已创建' }).waitFor();
  const confirmations = await app.evaluate(() => (globalThis as any).reviewFixture.confirmations);
  assert.equal(confirmations.length, 3);
  assert.deepEqual(confirmations[1], confirmations[2]);
  await wait(
    async () => (await call('run.detail', { id: first.id })).run.state === 'SUCCEEDED',
    'real browser Worker failed',
  );
  assert.equal(await readFile(join(files, 'title.txt'), 'utf8'), '虚构页面标题');
  await button('查看本次运行').click();
  await page.locator('.task-run-page').waitFor();
  await button('← 返回 AI 任务').click();
  await button('确认方案，去试运行').waitFor();
  assert.equal((await call('bootstrap')).runs.length, 1);
  evidence.checks.push(
    'lost-confirmation-same-request-detail-failure-retains-run-real-file-and-source-return',
  );

  await button('确认方案，去试运行').click();
  await button('检查新的试运行').click();
  await checkReady();
  await review();
  await mode('hold-confirm');
  await button('开始试运行').click();
  await pending();
  assert.equal((await call('bootstrap')).runs.length, 2);
  await button('回去修改').click();
  await page.locator('.sidebar').getByRole('button', { name: '我的流程', exact: true }).click();
  await release();
  await page.locator('.flows-page').waitFor();
  await page.locator('.sidebar').getByRole('button', { name: '开始任务', exact: true }).click();
  await button('确认方案，去试运行').click();
  await button('查看本次运行').waitFor();
  assert.equal((await call('bootstrap')).runs.length, 2);
  await mode('hold-detail');
  await button('查看本次运行').click();
  await pending();
  await button('回去修改').click();
  await page.locator('.sidebar').getByRole('button', { name: '我的流程', exact: true }).click();
  await release();
  await page.locator('.flows-page').waitFor();
  assert.equal(await page.locator('.task-run-page').count(), 0);
  assert.equal((await call('bootstrap')).runs.length, 2);
  evidence.checks.push('late-confirmation-and-detail-do-not-steal-navigation-or-repeat');
  assert.deepEqual(errors, []);
  evidence.passed = true;
} catch (error) {
  failure = error;
  await page
    ?.screenshot({ path: 'test-results/figma/run-review-failure.png', scale: 'css' })
    .catch(() => {});
} finally {
  try {
    if (app && page) {
      await app.evaluate(({ ipcMain }) => {
        const s = (globalThis as any).reviewFixture;
        if (s) {
          s.release?.();
          (ipcMain as any)._invokeHandlers.set('flowark:request', s.original);
        }
      });
      for (const task of await call('task.list')) await call('task.cancel', { id: task.id });
      for (const run of (await call('bootstrap')).runs)
        if (['QUEUED', 'RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING'].includes(run.state))
          await call('run.control', { id: run.id, action: 'cancel' });
      await wait(
        async () => !(await call('bootstrap')).execution?.active,
        'owned test runs did not exit',
      );
      const owned = app;
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          owned.close(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('owned GUI close timed out')), 20000);
          }),
        ]);
        evidence.closed = true;
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (error) {
    app?.process().kill('SIGKILL');
    failure ??= error;
  }
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  if (failure) {
    evidence.passed = false;
    evidence.error = String(failure);
  }
  await writeFile('test-results/figma/run-review-summary.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
if (failure) throw failure;
