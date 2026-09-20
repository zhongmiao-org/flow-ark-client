import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { embeddedHarness } from './fixtures/embedded-harness';
import { startFormLab } from './fixtures/form-lab';
const data = await mkdtemp('/private/tmp/flowark-picker-lifecycle-');
const lab = await startFormLab();
const h = await embeddedHarness(data);
const evidence: any = { passed: false, data, checks: [] };
const wait = async (predicate: () => Promise<boolean>, message: string) => {
  const end = Date.now() + 10000;
  while (!(await predicate())) {
    if (Date.now() >= end) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};
const click = async () =>
  h.app.evaluate(async () => {
    const wc = (globalThis as any).embeddedFixture.view.webContents;
    const point = await wc.executeJavaScript(
      `(()=>{const e=document.querySelector('#full-name'); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
    );
    wc.sendInputEvent({ type: 'mouseMove', ...point });
    wc.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
  });
try {
  await h.app.evaluate(() => {
    // Capture failures without Electron's blocking error dialog, then fail this test explicitly.
    (globalThis as any).lifecycleErrors = [];
    process.on('unhandledRejection', (error) =>
      (globalThis as any).lifecycleErrors.push(String(error)),
    );
    process.on('uncaughtException', (error) =>
      (globalThis as any).lifecycleErrors.push(String(error)),
    );
  });
  await h.start();
  await h.system('browser.embedded.viewport', { x: 0, y: 0, width: 1100, height: 800 });
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  await h.visibility(true);
  await h.perform({ operation: 'navigate', value: lab.url });
  await h.app.evaluate(() => {
    const wc = (globalThis as any).embeddedFixture.view.webContents;
    const original = wc.debugger.sendCommand.bind(wc.debugger);
    let hold = true;
    wc.debugger.sendCommand = async (method: string, params: any, session: any) => {
      if (hold && method === 'DOM.resolveNode') {
        hold = false;
        await new Promise<void>(
          (resolve) => ((globalThis as any).releasePickerResolution = resolve),
        );
      }
      return original(method, params, session);
    };
  });
  await h.system('browser.embedded.pick.start', { requestId: 'close-during-selection' });
  await click();
  await wait(
    () => h.app.evaluate(() => !!(globalThis as any).releasePickerResolution),
    '未进入拾取解析',
  );
  await h.close();
  await h.app.evaluate(() => (globalThis as any).releasePickerResolution());
  await new Promise((resolve) => setTimeout(resolve, 200));
  evidence.errors = await h.app.evaluate(() => (globalThis as any).lifecycleErrors);
  assert.deepEqual(evidence.errors, [], '关闭网页不能产生未处理的拾取异常');
  await h.start();
  await h.visibility(true);
  await h.perform({ operation: 'navigate', value: lab.url });
  await h.system('browser.embedded.pick.start', { requestId: 'after-close' });
  await click();
  await wait(
    async () =>
      (await h.system('browser.embedded.pick.status', { requestId: 'after-close' })).phase ===
      'selected',
    '重建后不能选取',
  );
  assert.equal(
    (await h.system('browser.embedded.pick.status', { requestId: 'after-close' })).target.selector,
    '#full-name',
  );
  assert.equal(lab.state.attempts, 0);
  evidence.checks.push('close-during-selection-and-reopen');
  // A successful validation schedules a later highlight cleanup. Close before it fires.
  await h.system('browser.embedded.pick.validate', { selector: '#full-name', framePath: [] });
  await h.close();
  await new Promise((resolve) => setTimeout(resolve, 1700));
  assert.deepEqual(await h.app.evaluate(() => (globalThis as any).lifecycleErrors), []);
  evidence.checks.push('close-before-highlight-cleanup');
  await h.start();
  await h.visibility(true);
  await h.perform({ operation: 'navigate', value: lab.url });
  for (let round = 0; round < 3; round++) {
    for (const transition of ['panel', 'hide', 'minimize', 'navigate', 'recreate']) {
      const requestId = `${round}-${transition}`;
      await h.system('browser.embedded.pick.start', { requestId });
      if (transition === 'panel') {
        await h.visibility(false);
        await h.visibility(true);
      } else if (transition === 'hide') {
        await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
        await wait(
          async () =>
            (await h.system('browser.embedded.pick.status', { requestId })).phase === 'cancelled',
          '隐藏窗口未取消拾取',
        );
        await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
      } else if (transition === 'minimize') {
        await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
        await wait(
          () =>
            h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()),
          '窗口未最小化',
        );
        await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
        await wait(
          () =>
            h.app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isMinimized()),
          '窗口未恢复',
        );
      } else if (transition === 'navigate') {
        await h.perform({ operation: 'navigate', value: lab.url });
      } else {
        await h.close();
        await h.start();
        await h.visibility(true);
        await h.perform({ operation: 'navigate', value: lab.url });
      }
      assert.equal(
        (await h.system('browser.embedded.pick.status', { requestId })).phase,
        'cancelled',
      );
      await wait(
        () => h.app.evaluate(() => (globalThis as any).embeddedFixture.view.getVisible()),
        '恢复后原生网页仍不可见',
      );
      const recovered = `${requestId}-recovered`;
      await h.system('browser.embedded.pick.start', { requestId: recovered });
      await click();
      await wait(
        async () =>
          (await h.system('browser.embedded.pick.status', { requestId: recovered })).phase !==
          'picking',
        '恢复后拾取未完成',
      );
      const selected = await h.system('browser.embedded.pick.status', { requestId: recovered });
      assert.equal(selected.phase, 'selected', JSON.stringify(selected));
      assert.equal(selected.target.selector, '#full-name');
      await h.perform({ operation: 'fill', selector: selected.target.selector, value: recovered });
      assert.equal(
        await h.perform({ operation: 'inputValue', selector: '#full-name', value: null }),
        recovered,
      );
      const paint = await h.app.evaluate(async () => {
        const fixture = (globalThis as any).embeddedFixture;
        const image = await fixture.view.webContents.capturePage();
        const pixels = image.toBitmap();
        let nonwhite = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i] < 230 || pixels[i + 1] < 230 || pixels[i + 2] < 230) nonwhite++;
        return { size: image.getSize(), nonwhite };
      });
      assert.ok(
        paint.size.width > 100 && paint.size.height > 100 && paint.nonwhite > 1000,
        '网页绘制为空白',
      );
      assert.deepEqual(await h.app.evaluate(() => (globalThis as any).lifecycleErrors), []);
      evidence.checks.push({ requestId, paint });
    }
  }
  evidence.errors = await h.app.evaluate(() => (globalThis as any).lifecycleErrors);
  assert.equal(lab.state.attempts, 0);
  evidence.passed = true;
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/picker-lifecycle.json', JSON.stringify(evidence, null, 2));
  await h.shutdown();
  await lab.close();
  console.log(JSON.stringify(evidence));
}
