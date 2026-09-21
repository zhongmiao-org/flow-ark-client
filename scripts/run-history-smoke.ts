import assert from 'node:assert/strict';
import { desktopElectron as electron } from './desktop-session.mjs';
import electronPath from 'electron';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Store } from '../src/host/store';
import { startFormLab } from './fixtures/platform-page';
import type { Run } from '../src/shared/types';
const data = await mkdtemp('/private/tmp/flowark-run-history-ui-');
const lab = await startFormLab();
const launch = () =>
  electron.launch({
    executablePath: process.env.FLOWARK_TEST_EXECUTABLE || (electronPath as unknown as string),
    args: process.env.FLOWARK_TEST_EXECUTABLE ? [] : [resolve('.')],
    env: { ...process.env, FLOWARK_DATA_DIR: data },
    timeout: 30000,
  });
let app = await launch();
const testWindow = async () => {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setTitle('FlowArk · 运行记录隔离测试（自动退出）'),
  );
  await page.waitForFunction(() => !!document.querySelector('.window-titlebar'));
  await page.evaluate(() => {
    document.querySelector('.window-titlebar')!.textContent =
      'FlowArk · 运行记录隔离测试（自动退出）';
  });
  return page;
};
const evidence: any = { passed: false, data, checks: [] };
try {
  let page = await testWindow();
  await page.waitForFunction(() => !!(window as any).flowark);
  const call = (method: string, args: any = {}): Promise<any> =>
    page.evaluate(({ method, args }) => (window as any).flowark.request(method, args), {
      method,
      args,
    });
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const back = () => page.getByRole('button', { name: /^← 返回记录第 \d+ 页$/ });
  const search = async (query: string, state?: string, source?: string) => {
    await button('触发来源筛选').click();
    await page.getByLabel('搜索运行记录').fill(query);
    if (state !== undefined) await page.getByLabel('运行状态筛选').selectOption(state);
    if (source !== undefined) await page.getByLabel('运行来源筛选').selectOption(source);
    await button('应用筛选').click();
  };
  const wait = async (predicate: () => Promise<boolean>) => {
    const end = Date.now() + 30000;
    while (!(await predicate())) {
      if (Date.now() > end) throw new Error('运行历史验收等待超时');
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
  const created = await call('flow.create');
  await call('flow.save', {
    flow: {
      ...created.flow,
      name: '虚构旧运行产物',
      steps: [
        {
          id: 'write',
          type: 'file',
          version: 1,
          operation: 'write',
          binding: 'work',
          name: 'result.txt',
          content: 'historical artifact',
        },
      ],
    },
    bindings: { files: { work: data }, credentials: [] },
  });
  const old = await call('flow.run', { id: created.id });
  await wait(async () =>
    ['SUCCEEDED', 'FAILED'].includes((await call('run.detail', { id: old.id })).run.state),
  );
  const original = await call('run.detail', { id: old.id });
  assert.equal(original.run.state, 'SUCCEEDED', original.run.error);
  const key = Buffer.from(
    await app.evaluate(
      async ({ safeStorage }, encrypted) =>
        (await safeStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'))).result,
      (await readFile(join(data, 'credentials', 'data-key.enc'))).toString('base64'),
    ),
    'base64',
  );
  await app.close();
  const store = new Store(join(data, 'flowark.sqlite'), key);
  try {
    for (let i = 0; i < 257; i++) {
      const id = `fixture-${String(i).padStart(4, '0')}`;
      const run: Run = {
        id,
        flowId: 'fixture-flow',
        versionId: 'fixture-version',
        name: i % 2 ? '普通虚构记录' : 'Alpha %_[x]',
        state: i % 3 ? 'FAILED' : 'SUCCEEDED',
        source: i % 5 ? 'manual' : 'schedule',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        business: '分页展示样例，未执行业务',
      };
      store.put('run', id, run);
    }
  } finally {
    store.close();
  }
  app = await launch();
  page = await testWindow();
  await page.waitForFunction(() => !!(window as any).flowark);
  await page
    .locator('.flow-card')
    .filter({ hasText: '虚构旧运行产物' })
    .getByText('执行完成', { exact: true })
    .waitFor();
  await button('运行记录').click();
  const table = () => page.locator('.run-history tbody tr');
  await page.getByLabel('运行时间范围').selectOption('all');
  await wait(async () => (await table().count()) === 6);
  await mkdir('test-results/figma', { recursive: true });
  for (const [width, height] of [
    [1440, 960],
    [1920, 1080],
    [1040, 700],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]),
      [width, height],
    );
    await page.waitForFunction((w) => innerWidth === w, width);
    assert.equal(
      await page.locator('.run-history').evaluate((e) => e.scrollWidth > e.clientWidth + 1),
      false,
    );
    await page.screenshot({ path: `test-results/figma/runs-${width}.png`, scale: 'css' });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
  await button('触发来源筛选').click();
  await page.getByLabel('每页运行条数').selectOption('100');
  await button('应用筛选').click();
  await wait(async () => (await table().count()) === 100);
  const ids = () =>
    table()
      .locator('small')
      .evaluateAll((els) => els.map((e) => e.getAttribute('title')));
  const firstNames = await ids();
  assert.equal(firstNames.length, 100);
  await button('下一页').click();
  await page.locator('.history-pagination').getByText('第 2 页', { exact: true }).waitFor();
  await wait(async () => (await ids())[0] === 'fixture-0156');
  const secondNames = await ids();
  assert.equal(new Set([...firstNames, ...secondNames]).size, 200);
  // A new real run must not shift the old page boundary.
  const newer = await call('flow.run', { id: created.id });
  await wait(async () => (await call('run.detail', { id: newer.id })).run.state === 'SUCCEEDED');
  await page.getByText('新增 1 条记录，可查看最新', { exact: true }).waitFor();
  assert.deepEqual(await ids(), secondNames);
  await button('下一页').click();
  await page.locator('.history-pagination').getByText('第 3 页', { exact: true }).waitFor();
  await wait(async () => (await table().count()) === 58);
  assert.equal(await button('下一页').isDisabled(), true);
  const row = page.getByRole('row').filter({ hasText: old.id.slice(0, 8) });
  await row.getByRole('button', { name: '查看', exact: true }).click();
  await back().waitFor();
  await page.screenshot({ path: 'test-results/figma/run-detail.png', scale: 'css' });
  assert.equal((await call('run.detail', { id: old.id })).artifacts[0].integrity, 'verified');
  await page.getByRole('link', { name: /^第 \d+ 页$/ }).click();
  await page.locator('.history-pagination').getByText('第 3 页', { exact: true }).waitFor();
  await wait(
    async () =>
      await row
        .getByRole('button', { name: '查看', exact: true })
        .evaluate((e) => document.activeElement === e),
  );
  await row.getByRole('button', { name: '查看', exact: true }).click();
  const currentTab = page.getByRole('tab', { name: '当前步骤', exact: true });
  const outputTab = page.getByRole('tab', { name: '输出与产物', exact: true });
  const logsTab = page.getByRole('tab', { name: '运行日志', exact: true });
  await currentTab.focus();
  await currentTab.press('ArrowRight');
  assert.equal(await outputTab.getAttribute('aria-selected'), 'true');
  assert.equal(await outputTab.evaluate((e) => document.activeElement === e), true);
  await outputTab.press('End');
  assert.equal(await logsTab.getAttribute('aria-selected'), 'true');
  await logsTab.press('Home');
  assert.equal(await currentTab.getAttribute('aria-selected'), 'true');
  await currentTab.press('ArrowLeft');
  assert.equal(await logsTab.getAttribute('aria-selected'), 'true');
  await logsTab.press('ArrowLeft');
  assert.equal(await outputTab.getAttribute('aria-selected'), 'true');
  evidence.checks.push('detail-tabs-keyboard-arrows-home-end-and-focus');
  await page.screenshot({ path: 'test-results/figma/run-output.png', scale: 'css' });
  await button('← 返回运行详情').click();
  await page.getByRole('tab', { name: '运行日志', exact: true }).click();
  assert.ok(
    await page
      .getByRole('tabpanel', { name: '运行日志' })
      .getByText('node-end', { exact: true })
      .count(),
  );
  await page.getByRole('tab', { name: '输出与产物', exact: true }).click();
  await button('预览产物清理').click();
  await page.getByRole('form', { name: '产物清理预览' }).waitFor();
  await page.getByLabel('已核对结果并保存需要保留的文件', { exact: true }).check();
  await button('确认清理产物').click();
  await page.getByRole('status').filter({ hasText: '已清理' }).waitFor();
  assert.equal(await readFile(join(data, 'result.txt'), 'utf8'), 'historical artifact');
  await access((await call('run.detail', { id: newer.id })).artifacts[0].path);
  await page.getByRole('link', { name: /^第 \d+ 页$/ }).click();
  await page.locator('.history-pagination').getByText('第 3 页', { exact: true }).waitFor();
  evidence.checks.push(
    'older-than-200-page-and-detail',
    'new-run-keeps-old-page-boundary',
    'detail-back-keeps-page',
    'old-artifact-clear-keeps-new-run-and-original',
  );
  await search('  ALPHA %_[x]  ', 'SUCCEEDED', 'schedule');
  await wait(async () => (await table().count()) === 9);
  const expected = Array.from({ length: 257 }, (_, i) => 256 - i)
    .filter((i) => i % 30 === 0)
    .map((i) => `fixture-${String(i).padStart(4, '0')}`);
  assert.deepEqual(
    await table()
      .locator('small')
      .evaluateAll((els) => els.map((e) => e.getAttribute('title'))),
    expected,
  );
  await table().first().getByRole('button', { name: '查看', exact: true }).click();
  await page.getByRole('link', { name: /^第 \d+ 页$/ }).click();
  await button('触发来源筛选').click();
  assert.equal(await page.getByLabel('搜索运行记录').inputValue(), 'ALPHA %_[x]');
  await button('取消').click();
  await wait(async () => (await table().count()) === 9);
  await search('不存在的虚构记录');
  await page.getByText('没有符合筛选条件的运行记录。', { exact: true }).waitFor();
  assert.equal(await button('下一页').isDisabled(), true);
  await search('', '', '');
  await button('查看最新').click();
  await wait(
    async () => (await table().locator('small').first().getAttribute('title')) === newer.id,
  );
  await button('打开网页面板').click();
  await call('browser.embedded.navigate', { url: lab.url });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 700));
  await page.getByText('桌面宽度 1920', { exact: true }).waitFor();
  await wait(
    async () =>
      (await app.evaluate(async ({ BrowserWindow }) =>
        (
          BrowserWindow.getAllWindows()[0].contentView.children[0] as any
        ).webContents.executeJavaScript('innerWidth'),
      )) === 1920,
  );
  assert.equal(
    await page.locator('.history-filters').evaluate((e) => e.scrollWidth > e.clientWidth + 1),
    false,
  );
  assert.equal(
    await page.locator('.run-history').evaluate((e) => e.scrollWidth > e.clientWidth + 1),
    false,
  );
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/run-history-small.png' });
  const native = await app.evaluate(async ({ BrowserWindow }) =>
    (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents.executeJavaScript(
      '({ width: innerWidth, url: location.href, input: !!document.querySelector("#fullName") })',
    ),
  );
  assert.equal(native.width, 1920);
  assert.equal(native.url, new URL(lab.url).href);
  assert.equal(native.input, true);
  evidence.native = native;
  assert.equal(lab.state.attempts, 0);
  evidence.checks.push(
    'literal-search-combined-filters-and-empty',
    'filter-retained-on-detail-return',
    'small-window-with-1920-native-form',
  );
  await app.close();
  app = await launch();
  page = await testWindow();
  await page.waitForFunction(() => !!(window as any).flowark);
  await button('运行记录').click();
  await search(old.id);
  await wait(async () => (await table().count()) === 1);
  await table().getByRole('button', { name: '查看', exact: true }).click();
  await page.getByRole('tab', { name: '输出与产物', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已清理' }).waitFor();
  await page.getByRole('tab', { name: '当前步骤', exact: true }).click();
  assert.equal((await call('run.detail', { id: old.id })).artifacts[0].integrity, 'cleared');
  evidence.checks.push('reopen-and-find-old-run-with-cleanup-status');
  // Delay only replies in this isolated app. Production handlers and persisted data remain real.
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as any)._invokeHandlers as Map<
      string,
      (...args: any[]) => Promise<any>
    >;
    const original = handlers.get('flowark:request')!;
    const state = {
      method: '',
      key: '',
      pending: false,
      done: false,
      release: undefined as undefined | (() => void),
    };
    (globalThis as any).__historyReply = state;
    handlers.set('flowark:request', async (...args: any[]) => {
      const result = await original(...args);
      if (args[1] === state.method && (args[2]?.id ?? args[2]?.query ?? '') === state.key) {
        state.method = '';
        state.pending = true;
        await new Promise<void>((resolve) => {
          state.release = resolve;
        });
        state.done = true;
      }
      return result;
    });
  });
  const delay = (method: string, key: string) =>
    app.evaluate(
      (_, next) => {
        Object.assign((globalThis as any).__historyReply, {
          ...next,
          pending: false,
          done: false,
          release: undefined,
        });
      },
      { method, key },
    );
  const pending = () =>
    wait(() => app.evaluate(() => !!(globalThis as any).__historyReply.pending));
  const release = async () => {
    await app.evaluate(() => (globalThis as any).__historyReply.release());
    await wait(() => app.evaluate(() => !!(globalThis as any).__historyReply.done));
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  };
  await delay('run.detail', old.id);
  await pending();
  await page.getByRole('link', { name: /^第 \d+ 页$/ }).click();
  await button('触发来源筛选').waitFor();
  await release();
  assert.equal(await back().count(), 0);
  await delay('run.list', 'delayed-query');
  await search('delayed-query');
  await pending();
  await search(old.id);
  await wait(async () => (await ids())[0] === old.id);
  await release();
  assert.deepEqual(await ids(), [old.id]);
  await delay('run.detail', old.id);
  await table().getByRole('button', { name: '查看', exact: true }).click();
  await pending();
  await search(newer.id);
  await wait(async () => (await ids())[0] === newer.id);
  await release();
  assert.equal(await back().count(), 0);
  assert.deepEqual(await ids(), [newer.id]);
  evidence.checks.push(
    'late-detail-poll-cannot-reopen',
    'late-search-cannot-overwrite-filter',
    'late-open-cannot-replace-new-search',
  );
  evidence.passed = true;
  evidence.old = old.id;
  evidence.newer = newer.id;
} finally {
  const ownedProcess = app.process();
  const guard = setTimeout(() => ownedProcess.kill('SIGKILL'), 20000);
  try {
    // A failed UI assertion can leave the real test Run waiting for input.
    // Cancel only this isolated app's tasks before requesting native quit.
    await app.evaluate(() => (globalThis as any).__historyReply?.release?.());
    const page = await app.firstWindow();
    await page.evaluate(async () => {
      const api = (window as any).flowark;
      const boot = await api.request('bootstrap', {});
      for (const run of boot.runs)
        if (['QUEUED', 'RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING'].includes(run.state))
          await api.request('run.control', { id: run.id, action: 'cancel' });
    });
    await page.waitForFunction(
      async () => !(await (window as any).flowark.request('bootstrap', {})).execution?.active,
      undefined,
      { timeout: 15000 },
    );
    await app.close();
  } catch (error) {
    evidence.cleanupError = String(error);
    ownedProcess.kill('SIGKILL');
  } finally {
    clearTimeout(guard);
  }
  await lab.close();
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/run-history.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
