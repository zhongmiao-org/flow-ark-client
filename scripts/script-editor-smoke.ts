import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import electronPath from 'electron';
import type { ChildProcess } from 'node:child_process';
import type { FlowRecord } from '../src/shared/types';

const data = await mkdtemp('/private/tmp/flowark-script-editor-');
const evidence: any = { passed: false, closed: false, data, checks: [], layouts: [] };
let app: ElectronApplication | undefined, page: Page | undefined, failure: unknown;
let ownedProcess: ChildProcess | undefined;
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const editor = () => page!.getByRole('region', { name: '脚本编辑', exact: true });
const call = (method: string, args: any = {}): Promise<any> =>
  page!.evaluate(({ method, args }) => window.flowark.request(method, args), { method, args });
const wait = async (predicate: () => Promise<boolean>, label: string) => {
  const end = Date.now() + 20000;
  while (!(await predicate())) {
    if (Date.now() > end) throw new Error(label);
    await new Promise((done) => setTimeout(done, 60));
  }
};
const code = async (text: string) => {
  await editor()
    .locator('.monaco-editor .view-lines')
    .click({ position: { x: 100, y: 10 } });
  await page!.keyboard.press('ControlOrMeta+A');
  await page!.keyboard.type(text);
};
const capture = async (width: number, height: number) => {
  await app!.evaluate(
    ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height),
    { width, height },
  );
  await page!.waitForFunction((size) => innerWidth === size.width && innerHeight === size.height, {
    width,
    height,
  });
  await page!.locator('main').evaluate((element) => element.scrollTo(0, 0));
  await page!.mouse.move(0, 0);
  await page!.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
  const layout = await editor().evaluate((element) => ({
    width: innerWidth,
    height: innerHeight,
    overflow: element.scrollWidth > element.clientWidth,
    rootOverflow: document.documentElement.scrollWidth > innerWidth,
    columns: [...element.querySelectorAll('.script-editor-columns > *')].map((node) => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  }));
  assert.equal(layout.overflow, false);
  assert.equal(layout.rootOverflow, false);
  evidence.layouts.push(layout);
  await page!.screenshot({ path: `test-results/figma/script-${width}.png`, scale: 'css' });
};
try {
  await mkdir('test-results/figma', { recursive: true });
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: ['.'],
    env: { ...process.env, FLOWARK_DATA_DIR: data },
  });
  ownedProcess = app.process();
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: '你想完成什么？' }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setTitle('FlowArk · 脚本编辑隔离测试（自动退出）'),
  );
  await page.evaluate(() => {
    document.querySelector('.window-titlebar')!.textContent =
      'FlowArk · 脚本编辑隔离测试（自动退出）';
  });
  await page.evaluate(() => document.fonts.ready);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
  const record: FlowRecord = await call('flow.create');
  const original = 'export default async (ctx) => ({ doubled: ctx.input.count * 2 });';
  await call('flow.save', {
    flow: {
      ...record.flow,
      name: '脚本编辑验证',
      parameters: { count: 3 },
      requiredCapabilities: ['script'],
      steps: [
        {
          id: 'normalize',
          type: 'script',
          version: 1,
          language: 'ts',
          code: original,
          name: 'normalize',
          input: { count: { $ref: 'params.count' } },
          dependencies: [],
        },
      ],
    },
    bindings: record.bindings,
  });
  await button('我的流程').click();
  await button('编辑 脚本编辑验证').click();
  await page.locator('.flow-shape[data-step-id="normalize"]').click();
  await button('打开完整脚本编辑器').click();
  await editor().locator('.monaco-editor textarea').waitFor();
  for (const [width, height] of [
    [1440, 960],
    [1920, 1080],
    [1040, 700],
  ])
    await capture(width, height);
  await button('检查语法').click();
  await editor()
    .getByText(/语法检查通过；/)
    .waitFor();
  assert.equal((await call('bootstrap')).runs.length, 0);
  await code('export default async () => { const broken = ; }');
  await wait(
    async () =>
      (await editor()
        .getByText(/语法检查通过；/)
        .count()) === 0,
    'stale syntax result',
  );
  await button('检查语法').click();
  await editor().locator('.script-syntax li').first().waitFor();
  assert.ok((await editor().locator('.script-syntax').innerText()).includes('第 1 行'));
  await editor().getByLabel('语言', { exact: true }).selectOption('js');
  await code('export default async () => { const count: number = 1; return count; }');
  await button('检查语法').click();
  await editor().locator('.script-syntax li').first().waitFor();
  await editor().getByLabel('语言', { exact: true }).selectOption('ts');
  await button('检查语法').click();
  await editor()
    .getByText(/语法检查通过；/)
    .waitFor();
  evidence.checks.push('real-monaco-js-ts-syntax-static-only-invalidated-on-edit');

  await button('我的流程').click();
  await page.getByRole('dialog', { name: '保存脚本修改？' }).waitFor();
  await button('继续编辑').click();
  assert.equal(await editor().isVisible(), true);
  await button('取消').click();
  await button('放弃修改').click();
  await button('打开完整脚本编辑器').click();
  await button('预览输入输出').click();
  await editor().getByText('尚无运行记录；预览不会运行脚本').waitFor();
  assert.ok(
    (await editor().locator('.script-preview pre').first().innerText()).includes('"count": 3'),
  );
  assert.equal((await call('bootstrap')).runs.length, 0);
  assert.equal(
    (await call('bootstrap')).flows.find((flow: any) => flow.id === record.id).flow.steps[0].code,
    original,
  );
  await editor().locator('.script-input-settings summary').click();
  await editor().getByLabel('脚本输入', { exact: true }).fill('{');
  await editor().locator('.script-input-settings summary').click();
  await button('保存并返回').click();
  await editor().getByRole('alert').filter({ hasText: '请先修正未完成' }).waitFor();
  assert.equal(
    await editor()
      .locator('.script-input-settings')
      .evaluate((element: HTMLDetailsElement) => element.open),
    true,
  );
  await editor()
    .getByLabel('脚本输入', { exact: true })
    .fill(JSON.stringify({ count: { $ref: 'params.count' } }));
  await editor().locator('.script-input-settings summary').click();
  await editor().getByLabel('超时（毫秒）', { exact: true }).fill('99');
  await button('保存并返回').click();
  await editor().getByRole('alert').filter({ hasText: '超时须为' }).waitFor();
  await editor().getByLabel('超时（毫秒）', { exact: true }).fill('30000');
  await code('export default async (ctx) => ({ doubled: ctx.input.count * 4 });');
  await button('我的流程').click();
  await button('保存并离开').click();
  await page.locator('.flows-page').waitFor();
  const saved = (await call('bootstrap')).flows.find((flow: any) => flow.id === record.id);
  assert.equal(saved.flow.steps[0].timeoutMs, 30000);
  assert.ok(saved.flow.steps[0].code.includes('* 4'));
  evidence.checks.push(
    'leave-stay-discard-save-to-requested-destination-timeout-validation-zero-preview-runs',
  );

  const run = await call('flow.run', { id: record.id });
  await wait(
    async () => (await call('run.detail', { id: run.id })).run.state === 'SUCCEEDED',
    'script failed',
  );
  assert.deepEqual((await call('run.detail', { id: run.id })).output, {
    normalize: { doubled: 12 },
  });
  await button('编辑 脚本编辑验证').click();
  await page.locator('.flow-shape[data-step-id="normalize"]').click();
  await button('打开完整脚本编辑器').click();
  await button('预览输入输出').click();
  await wait(
    async () => (await editor().locator('#script-history option').count()) > 1,
    'history list',
  );
  await editor().getByLabel('最近 20 次运行', { exact: true }).selectOption(run.id);
  await editor().locator('[data-script-run]').waitFor();
  assert.ok((await editor().locator('[data-script-run]').innerText()).includes('"doubled": 12'));
  await code('export default async () => "changed";');
  await editor().getByText('历史步骤配置与当前草稿不同，以下不是本次编辑的结果。').waitFor();
  assert.equal((await call('bootstrap')).runs.length, 1);
  await button('取消').click();
  await button('放弃修改').click();
  evidence.checks.push('real-worker-run-fixed-version-output-and-draft-mismatch-no-reexecution');
  assert.deepEqual(errors, []);
  const cleanupFlow = await call('flow.create');
  await call('flow.save', {
    flow: {
      ...cleanupFlow.flow,
      name: '仅供退出清理验证',
      steps: [{ id: 'wait', type: 'human', version: 1, message: '测试收尾将取消此运行' }],
    },
    bindings: cleanupFlow.bindings,
  });
  const cleanupRun = await call('flow.run', { id: cleanupFlow.id });
  await wait(
    async () => (await call('run.detail', { id: cleanupRun.id })).run.state === 'WAITING_INPUT',
    'cleanup fixture did not wait',
  );
  evidence.cleanupRun = cleanupRun.id;
  evidence.passed = true;
} catch (error) {
  failure = error;
  await page
    ?.screenshot({ path: 'test-results/figma/script-failure.png', scale: 'css' })
    .catch(() => {});
} finally {
  const cleanupTimer = setTimeout(() => {
    failure ??= new Error('owned cleanup timeout');
    ownedProcess?.kill('SIGKILL');
  }, 30000);
  try {
    if (app && page && !page.isClosed()) {
      const bootstrap = await call('bootstrap');
      for (const run of bootstrap.runs)
        if (!['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(run.state))
          await call('run.control', { id: run.id, action: 'cancel' });
      await wait(async () => {
        const state = await call('bootstrap');
        return !state.execution?.active && !state.runOverview.active && !state.runOverview.queued;
      }, 'owned run cleanup');
      if (evidence.cleanupRun) {
        assert.equal(
          (await call('run.detail', { id: evidence.cleanupRun })).run.state,
          'CANCELLED',
        );
        evidence.checks.push('cancel-owned-waiting-run-before-close');
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          app.close(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('owned close timeout')), 15000);
          }),
        ]);
        evidence.closed = true;
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (error) {
    ownedProcess?.kill('SIGKILL');
    failure ??= error;
  } finally {
    clearTimeout(cleanupTimer);
    const child = ownedProcess;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5000);
        child.once('exit', () => {
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
  await writeFile('test-results/figma/script-summary.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
if (failure) throw failure;
