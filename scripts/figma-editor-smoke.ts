import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startFormLab } from './fixtures/platform-page';

const data = await mkdtemp('/private/tmp/flowark-figma-editor-');
const lab = await startFormLab();
const app = await electron.launch({
  executablePath: process.env.FLOWARK_TEST_EXECUTABLE || (electronPath as unknown as string),
  args: process.env.FLOWARK_TEST_EXECUTABLE ? [] : [resolve('.')],
  env: { ...process.env, FLOWARK_DATA_DIR: data },
  timeout: 30000,
});
const testProcess = app.process();
const page = await app.firstWindow();
page.setDefaultTimeout(15000);
const call = (method: string, args: any = {}): Promise<any> =>
  page.evaluate(({ method, args }) => window.flowark.request(method, args), { method, args });
const button = (name: string) => page.getByRole('button', { name, exact: true });
const evidence: any = { passed: false, data, checks: [], layouts: [] };
const wait = async (check: () => Promise<void>, label: string) => {
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw new Error(label, { cause: error });
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
};
const inspect = () =>
  page.evaluate(() => {
    const boxes = Object.fromEntries(
      [
        '.canvas',
        '.inspector',
        '.node-library',
        '.browser-viewport',
        '.editor-workspace',
        '.editor-compact-toolbar',
        '.editor-toolbar',
      ].map((selector) => {
        const element = document.querySelector(selector) as HTMLElement | null;
        if (!element || !element.checkVisibility()) return [selector, null];
        const r = element.getBoundingClientRect();
        return [
          selector,
          {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            right: r.right,
            bottom: r.bottom,
            overflow: element.scrollWidth > element.clientWidth + 1,
          },
        ];
      }),
    );
    return {
      width: innerWidth,
      height: innerHeight,
      canvas: boxes['.canvas'],
      inspector: boxes['.inspector'],
      library: boxes['.node-library'],
      browser: boxes['.browser-viewport'],
      workspace: boxes['.editor-workspace'],
      toolbar: boxes['.editor-compact-toolbar'] || boxes['.editor-toolbar'],
      nodeIds: [...document.querySelectorAll('.flow-shape[data-step-id]')].map((e) =>
        e.getAttribute('data-step-id'),
      ),
    };
  });
const capture = async (name: string) => {
  await wait(async () => {
    const s = await inspect();
    for (const r of [s.workspace, s.canvas, s.inspector, s.library, s.browser, s.toolbar]) {
      if (!r) continue;
      assert.ok(
        r.bottom <= s.height + 1 && r.right <= s.width + 1 && r.x >= 0 && r.y >= 40,
        JSON.stringify({ name, r, width: s.width, height: s.height }),
      );
      assert.ok(!r.overflow, name + ': horizontal overflow');
    }
    if (s.browser) {
      const native = await app.evaluate(async ({ BrowserWindow }) => {
        const view = BrowserWindow.getAllWindows()[0].contentView.children[0] as any;
        return {
          bounds: view.getBounds(),
          visible: view.getVisible(),
          width: await view.webContents.executeJavaScript('innerWidth'),
        };
      });
      assert.ok(native.visible);
      assert.ok(Math.abs(native.width - 1920) <= 1);
      for (const key of ['x', 'y', 'width', 'height'] as const)
        assert.ok(Math.abs(native.bounds[key] - s.browser[key]) <= 1, name + ': native ' + key);
    }
  }, name);
  evidence.layouts.push({ name, ...(await inspect()) });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `test-results/figma/editor-${name}.png`, scale: 'css' });
};
try {
  await page.getByRole('heading', { name: '你想完成什么？' }).waitFor();
  await button('我的流程').click();
  await page.getByRole('heading', { name: '你的工作流，从这里开始。' }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setTitle('FlowArk · 编排隔离测试（自动退出）'),
  );
  await page.evaluate(() => {
    document.querySelector('.window-titlebar')!.textContent = 'FlowArk · 编排隔离测试（自动退出）';
  });
  await mkdir('test-results/figma', { recursive: true });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1920, 1080));
  await call('browser.embedded.enable');
  const browser = (await call('bootstrap')).browsers.find((b: any) => b.product === 'embedded');
  const record = await call('flow.create');
  const steps: any[] = [
    {
      id: 'open',
      type: 'browser',
      version: 2,
      operation: 'navigate',
      selector: '',
      framePath: [],
      value: lab.url,
    },
    {
      id: 'fill',
      type: 'browser',
      version: 2,
      operation: 'fill',
      selector: '#fullName',
      framePath: [],
      value: 'layout-verified',
    },
    {
      id: 'read',
      type: 'browser',
      version: 3,
      operation: 'inputValue',
      selector: '#fullName',
      framePath: [],
      value: null,
    },
    {
      id: 'check',
      type: 'assert',
      version: 1,
      actual: { $ref: 'steps.read' },
      operator: 'equals',
      expected: 'layout-verified',
    },
    ...Array.from({ length: 30 }, (_, index) => ({
      id: 'value_' + index,
      type: 'value',
      version: 1,
      value: index,
    })),
  ];
  await call('flow.save', {
    flow: { ...record.flow, name: '编排布局验证', steps },
    bindings: { files: {}, credentials: [], browserId: browser.id },
  });
  await button('我的流程').click();
  await button('编辑 编排布局验证').click();
  await wait(
    async () => assert.equal((await inspect()).nodeIds.length, steps.length),
    '全部步骤呈现',
  );
  await capture('wide-closed');
  assert.equal((await inspect()).library!.width, 224);
  assert.equal((await inspect()).inspector!.width, 336);
  await button('打开网页面板').click();
  await call('browser.embedded.navigate', { url: lab.url });
  await capture('wide-browser');
  assert.equal((await inspect()).library, null);
  assert.ok((await inspect()).canvas!.width >= 400);
  for (const [width, height] of [
    [1040, 700],
    [1200, 800],
    [1439, 900],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, { width, height }) =>
        BrowserWindow.getAllWindows()[0].setSize(width, height),
      { width, height },
    );
    await wait(async () => {
      const s = await inspect();
      assert.equal(s.width, width);
      assert.equal(s.height, height);
    }, '窗口实际尺寸 ' + width);
    await button('全图').click();
    await capture('compact-' + width);
    assert.equal((await inspect()).library, null);
    assert.equal((await inspect()).inspector, null);
    assert.ok((await inspect()).canvas!.width >= 300);
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 700));
  assert.equal((await inspect()).toolbar!.height, 40);
  await button('动作 / 配置抽屉').click();
  await capture('actions');
  assert.ok((await inspect()).library);
  assert.equal((await inspect()).inspector, null);
  assert.equal((await inspect()).canvas, null);
  await button('添加 读取文字').click();
  await capture('configuration');
  assert.equal((await inspect()).library, null);
  assert.ok((await inspect()).inspector);
  await page.getByLabel('步骤名称', { exact: true }).fill('新读取步骤');
  await button('应用并关闭').click();
  await page
    .getByRole('region', { name: '当前步骤' })
    .getByText('新读取步骤', { exact: true })
    .waitFor();
  await capture('selected-step');
  await button('编辑当前步骤').click();
  assert.equal(await page.getByLabel('步骤名称', { exact: true }).inputValue(), '新读取步骤');
  await button('← 返回紧凑窗口与网页').click();
  await button('编辑当前步骤').click();
  assert.equal(await page.getByLabel('步骤名称', { exact: true }).inputValue(), '新读取步骤');
  await button('删除节点').click();
  await button('全图').click();
  await button('← 返回流程编排').click();
  await capture('compact-closed');
  assert.ok((await inspect()).canvas!.width > 800);
  await button('保存').click();
  await page.waitForFunction(() =>
    document.querySelector('.editor-flow-name')?.textContent?.includes('草稿已保存'),
  );
  await button('运行').click();
  await wait(
    async () => assert.equal((await call('bootstrap')).runs[0]?.state, 'SUCCEEDED'),
    '真实内置网页填写及读取',
  );
  const run = (await call('bootstrap')).runs[0];
  assert.equal((await call('run.detail', { id: run.id })).output.read, 'layout-verified');
  await page.getByRole('region', { name: '运行概览', exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: /^第 \d+ 页$/ }).count(), 0);
  await page.getByRole('tab', { name: '输出与产物', exact: true }).click();
  await button('← 返回运行详情').click();
  await button('← 返回流程编排').click();
  assert.ok((await inspect()).canvas);
  assert.equal((await call('bootstrap')).runs.length, 1, '返回不得重放运行');
  evidence.checks = [
    'all-34-nodes',
    'wide-panels',
    'native-browser-bounds',
    'three-compact-widths',
    'exclusive-actions-and-configuration',
    'draft-preserved-on-close',
    'selected-step-summary',
    'full-canvas-after-close',
    'real-embedded-fill-read-assert',
    'run-output-back-restores-origin-editor-without-replay',
  ];
  evidence.passed = true;
} catch (error) {
  evidence.error = error instanceof Error ? error.stack : String(error);
  evidence.failure = await inspect().catch(() => null);
  evidence.viewport = await page
    .evaluate(() => ({
      compact: matchMedia('(max-width: 1439px)').matches,
      toolbar: document.querySelector('.editor-compact-toolbar')?.textContent ?? null,
      classes: document.querySelector('.app')?.className,
    }))
    .catch(() => null);
  await page.screenshot({ path: data + '/failure.png' }).catch(() => {});
  throw error;
} finally {
  const forcedExit = setTimeout(() => {
    evidence.passed = false;
    evidence.cleanupError = '测试退出超时';
    testProcess.kill('SIGKILL');
  }, 30000);
  try {
    for (const run of (await call('bootstrap')).runs) {
      if (['QUEUED', 'RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING'].includes(run.state))
        await call('run.control', { id: run.id, action: 'cancel' });
    }
    await wait(async () => {
      const b = await call('bootstrap');
      assert.ok(!b.execution?.active && !b.runOverview.active && !b.runOverview.queued);
    }, '退出前清理');
    await app.close();
  } catch (error) {
    evidence.passed = false;
    evidence.cleanupError = String(error);
    throw error;
  } finally {
    clearTimeout(forcedExit);
    if (testProcess.exitCode === null && testProcess.signalCode === null)
      testProcess.kill('SIGKILL');
    await lab.close();
    await mkdir('test-results/figma', { recursive: true });
    await writeFile('test-results/figma/editor-summary.json', JSON.stringify(evidence, null, 2));
    console.log(
      JSON.stringify({
        passed: evidence.passed,
        checks: evidence.checks,
        layouts: evidence.layouts.length,
        data,
      }),
    );
  }
}
