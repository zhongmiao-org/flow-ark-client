import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { startFormLab } from './fixtures/platform-page';
import { formBrowser, formLabFlow } from './fixtures/platform-flow';

const data = await mkdtemp('/private/tmp/flowark-capture-lifecycle-');
const lab = await startFormLab();
const app = await electron.launch({
  executablePath: process.env.FLOWARK_TEST_EXECUTABLE || (electronPath as unknown as string),
  args: process.env.FLOWARK_TEST_EXECUTABLE ? [] : [resolve('.')],
  env: { ...process.env, FLOWARK_DATA_DIR: data },
  timeout: 30000,
});
const evidence: any = { passed: false, data, checks: [] };
const wait = async (fn: () => Promise<boolean>, label: string) => {
  const deadline = Date.now() + 15000;
  while (!(await fn())) {
    if (Date.now() > deadline) throw new Error('等待超时：' + label);
    await new Promise((r) => setTimeout(r, 30));
  }
};
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean((window as any).flowark));
  const call = (method: string, args: any = {}): Promise<any> =>
    page.evaluate(({ method, args }) => (window as any).flowark.request(method, args), {
      method,
      args,
    });
  evidence.version = await app.evaluate(({ app, BrowserWindow }) => {
    const g = globalThis as any;
    g.captureTest = { main: BrowserWindow.getAllWindows()[0], holds: {}, errors: [], shown: [] };
    process.on('unhandledRejection', (e) => g.captureTest.errors.push(String(e)));
    process.on('uncaughtException', (e) => g.captureTest.errors.push(String(e)));
    app.on('browser-window-created', (_event, win) =>
      win.on('show', () => g.captureTest.shown.push(win.id)),
    );
    return app.getVersion();
  });
  await call('browser.embedded.enable');
  const browser = (await call('bootstrap')).browsers.find((b: any) => b.product === 'embedded');
  const start = async (name: string) => {
    const flow = {
      ...formLabFlow(lab.url),
      id: 'capture-' + name,
      name: '截图生命周期 ' + name,
      steps: [
        formBrowser('open', 'navigate', '', lab.url),
        formBrowser('fill', 'fill', '#full-name', name),
        { id: 'before', type: 'human', version: 1, message: '准备截图' },
        formBrowser('capture', 'screenshot', '', null, 60000),
        { id: 'after', type: 'human', version: 1, message: '检查截图恢复' },
      ],
    };
    await call('flow.save', {
      flow,
      bindings: { files: { work: data }, browserId: browser.id, credentials: [] },
    });
    const run = await call('flow.run', { id: flow.id });
    await wait(
      async () => (await call('run.detail', { id: run.id })).run.state === 'WAITING_INPUT',
      name + ' 准备截图',
    );
    return run.id as string;
  };
  const cancel = async (id: string) => {
    await call('run.control', { id, action: 'cancel' });
    await wait(
      async () => (await call('run.detail', { id })).run.state === 'CANCELLED',
      '取消截图流程',
    );
  };
  const arm = (name: string) =>
    app.evaluate((_electron, name) => {
      const state = (globalThis as any).captureTest;
      const view = state.main.contentView.children[0];
      const wc = view.webContents,
        original = wc.capturePage.bind(wc);
      const hold: any = { view, started: false };
      state.holds[name] = hold;
      // Keep the real native capture pending at its asynchronous completion boundary.
      // Only this isolated test process is instrumented; no production test hooks.
      wc.capturePage = async (...args: any[]) => {
        wc.capturePage = original;
        const image = await original(...args);
        hold.started = true;
        await new Promise<void>((release) => (hold.release = release));
        return image;
      };
    }, name);
  const held = (name: string) =>
    wait(
      () =>
        app.evaluate((_e, name) => !!(globalThis as any).captureTest.holds[name]?.started, name),
      name + ' 原生截图',
    );
  const release = (name: string) =>
    app.evaluate((_e, name) => (globalThis as any).captureTest.holds[name].release(), name);
  const visible = async (name: string) => {
    const current = await app.evaluate(async () => {
      const { main } = (globalThis as any).captureTest;
      const view = main.contentView.children[0];
      if (!view) return { present: false };
      return {
        present: true,
        visible: view.getVisible(),
        bounds: view.getBounds(),
        value: await view.webContents.executeJavaScript(
          'document.querySelector("#full-name").value',
        ),
      };
    });
    evidence.checks.push({ name, ...current });
    assert.equal(current.present, true, name + ' 必须挂载在主窗口');
    assert.equal(current.visible, true, name + ' 原生视图仍被隐藏');
    assert.ok(current.bounds.x > 400 && current.bounds.width > 400);
    return current;
  };

  const first = await start('first');
  await arm('first');
  await call('run.control', { id: first, action: 'resume' });
  await held('first');
  await cancel(first);
  assert.equal((await call('run.detail', { id: first })).artifacts.length, 0);

  const second = await start('second');
  await page.getByRole('button', { name: '打开网页面板', exact: true }).click();
  await wait(async () => (await call('browser.embedded.status')).visible, '展开面板');
  assert.equal((await visible('old-capture-pending-new-view')).value, 'second');
  await app.evaluate(() => {
    const s = (globalThis as any).captureTest;
    s.second = s.main.contentView.children[0].webContents;
  });
  await cancel(second);
  assert.equal(
    await app.evaluate(() => {
      const s = (globalThis as any).captureTest;
      return s.second.isDestroyed() && s.main.contentView.children.length === 0;
    }),
    true,
    '旧截图不能导致新网页从错误的父视图移除',
  );
  evidence.checks.push('close-new-view-while-old-capture-pending');

  const third = await start('third');
  assert.equal((await visible('third-view')).value, 'third');
  await arm('third');
  await page.getByRole('button', { name: '关闭网页面板', exact: true }).click();
  await wait(async () => !(await call('browser.embedded.status')).visible, '收起面板');
  await call('run.control', { id: third, action: 'resume' });
  await held('third');
  await release('first');
  await wait(
    () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 2),
    '旧截图宿主销毁',
  );
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => {
      const s = (globalThis as any).captureTest;
      const host = BrowserWindow.getAllWindows().find((w) => w !== s.main)!;
      return !host.isVisible() && host.contentView.children.includes(s.holds.third.view);
    }),
    true,
    '旧截图清理不能移动或销毁新截图网页',
  );
  await page.getByRole('button', { name: '打开网页面板', exact: true }).click();
  await wait(async () => (await call('browser.embedded.status')).visible, '截图期间展开');
  await release('third');
  await wait(
    async () => (await call('run.detail', { id: third })).run.state === 'WAITING_INPUT',
    '新截图完成',
  );
  assert.equal((await visible('after-overlapping-captures')).value, 'third');
  const detail = await call('run.detail', { id: third });
  assert.equal(detail.artifacts.length, 1);
  const paint = await app.evaluate(({ nativeImage }, path) => {
    const image = nativeImage.createFromPath(path),
      pixels = image.toBitmap();
    let nonwhite = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] < 230 || pixels[i + 1] < 230 || pixels[i + 2] < 230) nonwhite++;
    return { size: image.getSize(), nonwhite };
  }, detail.artifacts[0].path);
  assert.ok(paint.size.width > 100 && paint.size.height > 100 && paint.nonwhite > 1000);
  evidence.paint = paint;
  await call('run.control', { id: third, action: 'resume' });
  await wait(
    async () => (await call('run.detail', { id: third })).run.state === 'SUCCEEDED',
    '流程完成',
  );
  for (const id of [first, second]) {
    const cancelled = await call('run.detail', { id });
    assert.equal(cancelled.run.state, 'CANCELLED');
    assert.equal(cancelled.artifacts.length, 0, '取消后迟到的截图不能登记为产物');
    assert.ok(!cancelled.events.some((event: any) => event.nodeInstance === 'after'));
  }
  assert.equal(lab.state.attempts, 0);
  const events = await app.evaluate(() => {
    const s = (globalThis as any).captureTest;
    return { errors: s.errors, shown: s.shown };
  });
  assert.deepEqual(events, { errors: [], shown: [] });
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  evidence.runs = { first, second, third };
  evidence.passed = true;
} finally {
  // Release injected delays even on assertion failure so normal shutdown can complete.
  await app
    .evaluate(() => {
      for (const hold of Object.values((globalThis as any).captureTest?.holds ?? {}) as any[])
        hold.release?.();
    })
    .catch(() => {});
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as any;
  });
  await app.close();
  await lab.close();
  await mkdir('test-results', { recursive: true });
  await writeFile(
    'test-results/embedded-capture-lifecycle.json',
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence));
}
