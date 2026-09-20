import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startFormLab } from './fixtures/form-lab';
const data = await mkdtemp('/private/tmp/flowark-viewport-');
const lab = await startFormLab();
const app = await electron.launch({
  executablePath: process.env.FLOWARK_TEST_EXECUTABLE || (electronPath as unknown as string),
  args: process.env.FLOWARK_TEST_EXECUTABLE ? [] : [resolve('.')],
  env: { ...process.env, FLOWARK_DATA_DIR: data },
  timeout: 30000,
});
const evidence: any = { passed: false, data, checks: [] };
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!(window as any).flowark);
  const call = (method: string, args: any = {}) =>
    page.evaluate(({ method, args }) => (window as any).flowark.request(method, args), {
      method,
      args,
    });
  const site = (expression: string) =>
    app.evaluate(async ({ BrowserWindow }, expression) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children[0] as any;
      return view.webContents.executeJavaScript(expression);
    }, expression);
  const wait = async (check: () => Promise<void>) => {
    const end = Date.now() + 10000;
    for (;;) {
      try {
        await check();
        return;
      } catch (error) {
        if (Date.now() > end) throw error;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const viewport = async (name: string) => {
    let result: any;
    await wait(async () => {
      result = await app.evaluate(async ({ BrowserWindow }) => {
        const view = BrowserWindow.getAllWindows()[0].contentView.children[0] as any;
        return {
          bounds: view.getBounds(),
          id: view.webContents.id,
          ...(await view.webContents.executeJavaScript(`({
          width:innerWidth, height:innerHeight, desktop:matchMedia('(min-width: 1600px)').matches,
          origin:performance.timeOrigin, value:document.querySelector('#full-name')?.value
        })`)),
        };
      });
      assert.ok(Math.abs(result.width - 1920) <= 1, name + ': desktop width ' + result.width);
      assert.equal(result.desktop, true, name + ': desktop media query');
      assert.ok(
        Math.abs(result.height - Math.round((result.bounds.height * 1920) / result.bounds.width)) <=
          1,
        name + ': adaptive height',
      );
    });
    evidence.checks.push({ name, ...result });
    return result;
  };
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
  // A run can navigate before a panel has ever been displayed.
  await call('browser.embedded.navigate', { url: lab.url });
  await viewport('first-navigation-panel-closed');
  await page.getByRole('button', { name: '打开网页面板', exact: true }).click();
  await page.getByText('桌面宽度 1920', { exact: true }).waitFor();
  await viewport('first-open');
  // Native input uses physical panel coordinates. Do not focus controls through JS.
  const click = async (selector: string) =>
    app.evaluate(async ({ BrowserWindow }, selector) => {
      const win = BrowserWindow.getAllWindows()[0];
      const view = win.contentView.children[0] as any,
        wc = view.webContents;
      const p = await wc.executeJavaScript(
        `(() => {const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
      );
      const bounds = view.getBounds(),
        origin = win.getContentBounds(),
        scale = bounds.width / 1920;
      const point = { x: Math.round(p.x * scale), y: Math.round(p.y * scale) };
      const input = {
        ...point,
        globalX: origin.x + bounds.x + point.x,
        globalY: origin.y + bounds.y + point.y,
        button: 'left' as const,
        clickCount: 1,
      };
      wc.sendInputEvent({ type: 'mouseDown', ...input });
      wc.sendInputEvent({ type: 'mouseUp', ...input });
    }, selector);
  await click('#full-name');
  await wait(async () => assert.equal(await site('document.activeElement.id'), 'full-name'));
  await app.evaluate(async ({ BrowserWindow }) => {
    await (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents.insertText(
      '桌面宽度测试',
    );
  });
  await click('#channel-email');
  await wait(async () =>
    assert.equal(await site("document.querySelector('#channel-email').checked"), true),
  );
  const retained = await viewport('native-input');
  const preserve = async (name: string) => {
    const current = await viewport(name);
    assert.equal(current.id, retained.id);
    assert.equal(current.origin, retained.origin);
    assert.equal(current.value, '桌面宽度测试');
  };
  for (const [width, height] of [
    [1040, 700],
    [1200, 800],
    [1380, 900],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setSize(size.width, size.height),
      { width, height },
    );
    // Wait for the renderer's ResizeObserver to synchronize native bounds.
    await wait(async () => {
      const panel = await page.locator('.browser-viewport').boundingBox();
      const bounds = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].contentView.children[0].getBounds(),
      );
      assert.ok(
        panel &&
          Math.abs(panel.width - bounds.width) <= 1 &&
          Math.abs(panel.height - bounds.height) <= 1,
      );
    });
    await preserve(`${width}x${height}`);
    await page.getByRole('button', { name: '关闭网页面板', exact: true }).click();
    await preserve(`${width}x${height}-closed`);
    await page.getByRole('button', { name: '打开网页面板', exact: true }).click();
    await preserve(`${width}x${height}-reopened`);
    await click('#full-name');
    await wait(async () => assert.equal(await site('document.activeElement.id'), 'full-name'));
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await wait(async () =>
    assert.equal(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()),
      true,
    ),
  );
  await preserve('minimized');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
  await wait(async () =>
    assert.equal(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()),
      false,
    ),
  );
  await preserve('restored');
  // Navigation must reinstate desktop metrics on the new document.
  await call('browser.embedded.navigate', { url: lab.url + '/?round=2' });
  const navigated = await viewport('second-navigation');
  assert.notEqual(navigated.origin, retained.origin);
  assert.equal(navigated.value, '');
  await click('#full-name');
  await wait(async () => assert.equal(await site('document.activeElement.id'), 'full-name'));
  await mkdir('test-results', { recursive: true });
  const screenshot = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents;
    return (await wc.capturePage()).toPNG().toString('base64');
  });
  await writeFile('test-results/browser-viewport.png', Buffer.from(screenshot, 'base64'));
  assert.equal(lab.state.attempts, 0);
  assert.equal((await call('bootstrap')).runs.length, 0);
  evidence.passed = true;
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/browser-viewport.json', JSON.stringify(evidence, null, 2));
  await app.close();
  await lab.close();
  console.log(JSON.stringify(evidence));
}
