import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import type { ChildProcess } from 'node:child_process';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import electronPath from 'electron';
import type { Step } from '../src/shared/types';
const data = await mkdtemp('/private/tmp/flowark-outline-');
const evidence: any = { passed: false, closed: false, data, checks: [], layouts: [] };
let app: ElectronApplication | undefined,
  page: Page | undefined,
  child: ChildProcess | undefined,
  failure: unknown;
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const outline = () => page!.getByRole('region', { name: '长流程工作区', exact: true });
const call = (method: string, args: any = {}): Promise<any> =>
  page!.evaluate(({ method, args }) => window.flowark.request(method, args), { method, args });
const wait = async (predicate: () => Promise<boolean>, label: string) => {
  const end = Date.now() + 20000;
  while (!(await predicate())) {
    if (Date.now() > end) throw new Error(label);
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
};
const search = async (value: string) => {
  await outline().getByLabel('搜索步骤', { exact: true }).fill(value);
  await outline().getByLabel('搜索步骤', { exact: true }).press('Enter');
};
const row = (id: string) => outline().locator(`[data-outline-step="${id}"]`);
const size = async (width: number, height: number) => {
  await app!.evaluate(
    ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height),
    { width, height },
  );
  await page!.waitForFunction((size) => innerWidth === size.width && innerHeight === size.height, {
    width,
    height,
  });
};
async function capture(width: number, height: number) {
  await size(width, height);
  await page!.locator('main').evaluate((element) => element.scrollTo(0, 0));
  await page!.mouse.move(0, 0);
  await page!.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const layout = await outline().evaluate((element) => ({
    width: innerWidth,
    height: innerHeight,
    overflow: element.scrollWidth > element.clientWidth,
    rootOverflow: document.documentElement.scrollWidth > innerWidth,
    columns: [...element.querySelectorAll('.outline-columns > *')].map((child) => {
      const r = child.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  }));
  assert.equal(layout.overflow, false);
  assert.equal(layout.rootOverflow, false);
  if (width === 1920)
    assert.deepEqual(
      layout.columns.map((column) => Math.round(column.width)),
      [260, 880, 444],
    );
  evidence.layouts.push(layout);
  await page!.screenshot({ path: `test-results/figma/outline-${width}.png`, scale: 'css' });
}
try {
  await mkdir('test-results/figma', { recursive: true });
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: ['.'],
    env: { ...process.env, FLOWARK_DATA_DIR: data },
  });
  child = app.process();
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: '你想完成什么？' }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setTitle('FlowArk · 长流程隔离测试（自动退出）'),
  );
  await page.evaluate(() => {
    document.querySelector('.window-titlebar')!.textContent =
      'FlowArk · 长流程隔离测试（自动退出）';
  });
  await page.evaluate(() => document.fonts.ready);
  await size(1920, 1080);
  const record = await call('flow.create');
  const value = (id: string): Step => ({ id, name: id, type: 'value', version: 1, value: id });
  const steps: Step[] = [
    ...Array.from({ length: 29 }, (_, i) => value('prepare_' + (i + 1))),
    {
      id: 'branch',
      name: '检查有效记录',
      type: 'condition',
      version: 1,
      actual: true,
      operator: 'equals',
      expected: true,
      then: [
        {
          id: 'loop',
          name: '串行核对',
          type: 'loop',
          version: 1,
          items: [1, 2],
          body: [
            {
              id: 'wait',
              name: '核对记录并继续',
              type: 'human',
              version: 1,
              message: '虚构输入等待核对',
            },
            value('checked'),
          ],
        },
      ],
      else: [value('unused')],
    },
    ...Array.from({ length: 6 }, (_, i) => value('tail_' + (i + 1))),
  ];
  await call('flow.save', {
    flow: { ...record.flow, name: '四十步定位验证', steps },
    bindings: record.bindings,
  });
  const run = await call('flow.run', { id: record.id });
  await wait(
    async () => (await call('run.detail', { id: run.id })).run.state === 'WAITING_INPUT',
    'real run did not reach waiting step',
  );
  const snapshot = (await call('run.detail', { id: run.id })).snapshot;
  await button('我的流程').click();
  await button('编辑 四十步定位验证').click();
  await button('长流程大纲').click();
  await outline().getByRole('heading', { name: '步骤大纲 · 40 步' }).waitFor();
  await search('wait');
  await row('wait').waitFor();
  assert.equal(await row('wait').getAttribute('aria-pressed'), 'true');
  assert.ok((await row('wait').innerText()).startsWith('32'));
  await button('收起串行循环体 · 2 步').click();
  assert.equal(await row('wait').count(), 0);
  await search('wait');
  await row('wait').waitFor();
  assert.equal(await button('收起串行循环体 · 2 步').getAttribute('aria-expanded'), 'true');
  evidence.checks.push('40-definition-steps-search-reveals-nested-branch-with-stable-id');

  await wait(async () => await button('聚焦当前执行').isEnabled(), 'current run not observed');
  await button('聚焦当前执行').click();
  assert.equal(await button('运行快照 · 只读').getAttribute('aria-pressed'), 'true');
  assert.equal(await row('wait').getAttribute('aria-current'), 'step');
  await outline().getByText('branch/loop[0]/wait', { exact: true }).waitFor();
  assert.equal(
    await outline().getByRole('button', { name: '编辑步骤配置', exact: true }).count(),
    0,
  );
  await call('run.control', { id: run.id, action: 'resume' });
  await wait(
    async () =>
      (await call('run.detail', { id: run.id })).events.some(
        (event: any) => event.type === 'node-start' && event.nodeInstance === 'branch/loop[1]/wait',
      ),
    'second loop iteration',
  );
  await outline().getByText('branch/loop[1]/wait', { exact: true }).waitFor();
  assert.equal(await outline().locator('.outline-instance').count(), 2);
  await search('unused');
  await outline().locator('.outline-instance').filter({ hasText: '尚未执行' }).waitFor();
  await button('聚焦当前执行').click();
  evidence.checks.push(
    'real-current-position-readonly-snapshot-distinct-loop-instances-unvisited-branch',
  );

  await button('编辑中的草稿').click();
  await search('wait');
  await button('编辑步骤配置').click();
  await page.getByLabel('步骤名称', { exact: true }).fill('草稿新增说明');
  await button('长流程大纲').click();
  await row('wait').getByText('草稿新增说明', { exact: true }).waitFor();
  await button('聚焦当前执行').click();
  await row('wait').getByText('核对记录并继续', { exact: true }).waitFor();
  assert.deepEqual((await call('run.detail', { id: run.id })).snapshot, snapshot);
  await outline()
    .getByText(/草稿与固定版本不同/)
    .waitFor();
  const sourceScroll = await outline()
    .locator('.outline-step-list')
    .evaluate((element) => element.scrollTop);
  await button('查看此运行详情').click();
  await page.locator('.run-detail').waitFor();
  await button('← 返回长流程大纲').click();
  await row('wait').waitFor();
  assert.equal(await button('运行快照 · 只读').getAttribute('aria-pressed'), 'true');
  assert.equal(await outline().getByLabel('搜索步骤', { exact: true }).inputValue(), 'wait');
  assert.equal(await row('wait').getAttribute('aria-pressed'), 'true');
  assert.ok(
    Math.abs(
      (await outline()
        .locator('.outline-step-list')
        .evaluate((element) => element.scrollTop)) - sourceScroll,
    ) <= 1,
  );
  evidence.checks.push(
    'draft-edits-do-not-relabel-snapshot-run-detail-return-retains-source-selection-search-scroll',
  );

  await button('编辑中的草稿').click();
  await search('tail_6');
  await button('展开流程图').click();
  const diagram = outline().locator('.outline-diagram');
  const selectedNode = diagram.locator('.flow-shape[data-step-id="tail_6"]');
  await wait(
    async () => (await selectedNode.boundingBox())!.width > 250,
    'graph target unreadable',
  );
  assert.equal(await diagram.locator('.flow-shape[data-step-id]').count(), 40);
  const transform = () => diagram.locator('.react-flow__viewport').getAttribute('style');
  const box = (await diagram.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 70);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 105, { steps: 8 });
  await page.mouse.up();
  const position = await transform();
  await button('编辑步骤配置').click();
  await page.getByLabel('步骤名称', { exact: true }).fill('最后输出草稿');
  await button('长流程大纲').click();
  await diagram.waitFor();
  await wait(
    async () => (await transform()) === position,
    'manual graph viewport changed after draft config',
  );
  await button('返回步骤清单').click();
  await button('聚焦当前执行').click();
  evidence.checks.push(
    'readable-graph-focus-40-real-identities-manual-viewport-survives-configuration-return',
  );
  for (const [width, height] of [
    [1920, 1080],
    [1440, 960],
    [1040, 700],
  ])
    await capture(width, height);

  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as any)._invokeHandlers as Map<
      string,
      (...args: any[]) => Promise<any>
    >;
    const original = handlers.get('flowark:request')!;
    const state: any = { original, hold: true, releases: [] };
    (globalThis as any).outlineFixture = state;
    handlers.set('flowark:request', async (...args: any[]) => {
      const result = await original(...args);
      if (args[1] === 'run.detail' && state.hold) {
        state.heldAt = Date.parse(result.execution.observedAt);
        await new Promise<void>((resolve) => state.releases.push(resolve));
      }
      return result;
    });
  });
  await wait(
    () => app!.evaluate(() => (globalThis as any).outlineFixture.releases.length > 0),
    'run observation not held',
  );
  await wait(
    async () => await button('聚焦当前执行').isDisabled(),
    'stale observation still says current',
  );
  assert.equal(await outline().locator('[aria-current="step"]').count(), 0);
  await wait(
    () => app!.evaluate(() => Date.now() - (globalThis as any).outlineFixture.heldAt > 5500),
    'held observation has not expired',
  );
  await app.evaluate(() => {
    const state = (globalThis as any).outlineFixture;
    state.releases.splice(0).forEach((release: () => void) => release());
  });
  await page.waitForTimeout(200);
  assert.equal(
    await button('聚焦当前执行').isDisabled(),
    true,
    'delayed old timestamp must not become fresh',
  );
  await app.evaluate(({ ipcMain }) => {
    const state = (globalThis as any).outlineFixture;
    state.hold = false;
    state.releases.splice(0).forEach((release: () => void) => release());
    (ipcMain as any)._invokeHandlers.set('flowark:request', state.original);
  });
  await wait(
    async () => await button('聚焦当前执行').isEnabled(),
    'fresh observation not restored',
  );
  await call('run.control', { id: run.id, action: 'cancel' });
  await wait(
    async () => (await call('run.detail', { id: run.id })).run.state === 'CANCELLED',
    'cancel failed',
  );
  await wait(
    async () => await button('聚焦当前执行').isDisabled(),
    'terminal run remained current',
  );
  assert.equal(await outline().locator('[aria-current="step"]').count(), 0);
  const final = await call('bootstrap');
  assert.equal(final.runs.length, 1);
  assert.deepEqual((await call('run.detail', { id: run.id })).snapshot, snapshot);
  evidence.checks.push(
    'stale-and-delayed-observations-never-claim-current-terminal-run-no-reexecution',
  );
  assert.deepEqual(errors, []);
  evidence.passed = true;
} catch (error) {
  failure = error;
  await page
    ?.screenshot({ path: 'test-results/figma/outline-failure.png', scale: 'css' })
    .catch(() => {});
} finally {
  const watchdog = setTimeout(() => {
    failure ??= new Error('owned cleanup timeout');
    child?.kill('SIGKILL');
  }, 30000);
  try {
    if (app && page && !page.isClosed()) {
      await app.evaluate(({ ipcMain }) => {
        const state = (globalThis as any).outlineFixture;
        if (state) {
          state.hold = false;
          state.releases.splice(0).forEach((release: () => void) => release());
          (ipcMain as any)._invokeHandlers.set('flowark:request', state.original);
        }
      });
      for (const run of (await call('bootstrap')).runs)
        if (['QUEUED', 'RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING'].includes(run.state))
          await call('run.control', { id: run.id, action: 'cancel' });
      await wait(async () => {
        const state = await call('bootstrap');
        return !state.execution?.active && !state.runOverview.active && !state.runOverview.queued;
      }, 'owned run cleanup');
      await app.close();
    }
  } catch (error) {
    failure ??= error;
    child?.kill('SIGKILL');
  } finally {
    clearTimeout(watchdog);
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5000);
        child!.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    evidence.closed = !child || child.exitCode !== null || child.signalCode !== null;
    if (!evidence.closed) failure ??= new Error('owned process still alive');
  }
  if (failure) {
    evidence.passed = false;
    evidence.error = String(failure);
  }
  await writeFile('test-results/figma/outline-summary.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
if (failure) throw failure;
