import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startFormLab } from './fixtures/form-lab';

const data = await mkdtemp('/private/tmp/flowark-editor-layout-');
const lab = await startFormLab();
const app = await electron.launch({
  executablePath: process.env.FLOWARK_TEST_EXECUTABLE || (electronPath as unknown as string),
  args: process.env.FLOWARK_TEST_EXECUTABLE ? [] : [resolve('.')],
  env: { ...process.env, FLOWARK_DATA_DIR: data },
});
const evidence: any = { passed: false, data, layouts: [] };
try {
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => !!(window as any).flowark);
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
  const state = () => page.evaluate(() => (window as any).flowark.request('bootstrap'));
  const inspect = () =>
    page.evaluate(() => {
      const rectangles = Object.fromEntries(
        ['.canvas', 'main', '.inspector', '.node-library', '.browser-viewport'].map((selector) => {
          const e = document.querySelector(selector) as HTMLElement;
          if (!e) return [selector, null];
          const r = e.getBoundingClientRect();
          return [
            selector,
            {
              x: r.x,
              y: r.y,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
              clientWidth: e.clientWidth,
              scrollWidth: e.scrollWidth,
              scrollLeft: e.scrollLeft,
            },
          ];
        }),
      );
      return {
        canvas: rectangles['.canvas'],
        main: rectangles.main,
        inspector: rectangles['.inspector'],
        library: rectangles['.node-library'],
        browser: rectangles['.browser-viewport'],
        nodes: Array.from(document.querySelectorAll('.flow-shape')).map((e) => {
          const r = e.getBoundingClientRect();
          return {
            id: e.getAttribute('data-step-id'),
            x: r.x,
            y: r.y,
            right: r.right,
            bottom: r.bottom,
          };
        }),
      };
    });
  const wait = async (check: () => Promise<void>) => {
    const deadline = Date.now() + 8000;
    for (;;) {
      try {
        await check();
        return;
      } catch (e) {
        if (Date.now() >= deadline) throw e;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  };
  const layout = async (name: string, selected?: string) => {
    await wait(async () => {
      const s = await inspect();
      assert.ok(s.canvas && s.main && s.inspector && s.library, `${name}: editor mounted`);
      assert.ok(s.main.scrollWidth <= s.main.clientWidth + 1, `${name}: horizontal overflow`);
      assert.equal(s.main.scrollLeft, 0, `${name}: main must not scroll sideways`);
      assert.ok(s.inspector.right <= s.main.right + 1, `${name}: inspector clipped`);
      assert.ok(s.canvas.width >= 250, `${name}: usable canvas width`);
      const nodes = selected ? s.nodes.filter((n) => n.id === selected) : s.nodes;
      assert.ok(nodes.length > 0);
      for (const node of nodes) {
        assert.ok(
          node.x >= s.canvas.x && node.right <= s.canvas.right,
          `${name}: ${node.id} clipped horizontally`,
        );
        assert.ok(
          node.y >= s.canvas.y && node.bottom <= s.canvas.bottom,
          `${name}: ${node.id} clipped vertically`,
        );
      }
      if (s.browser) {
        const native = await app.evaluate(({ BrowserWindow }) => {
          const view = BrowserWindow.getAllWindows()[0].contentView.children[0];
          return { visible: view.getVisible(), bounds: view.getBounds() };
        });
        assert.equal(native.visible, true);
        for (const key of ['x', 'y', 'width', 'height'] as const)
          assert.ok(
            Math.abs(native.bounds[key] - s.browser[key]) <= 1,
            `${name}: native page bounds ${key}`,
          );
      }
    });
    evidence.layouts.push({ name, ...(await inspect()) });
  };
  const resize = (width: number, height: number) =>
    app.evaluate(
      ({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0].setSize(size.width, size.height);
      },
      { width, height },
    );
  const open = () => page.getByRole('button', { name: '打开网页面板', exact: true }).click();
  const close = () => page.getByRole('button', { name: '关闭网页面板', exact: true }).click();

  await resize(1380, 900);
  await page.getByRole('button', { name: '新建流程', exact: true }).click();
  await layout('closed');
  await open();
  await layout('open-without-selection');
  await page.getByLabel('网页地址', { exact: true }).fill(lab.url);
  await page.getByRole('button', { name: '访问网页', exact: true }).click();
  await wait(async () => {
    assert.equal(
      await app.evaluate(async ({ BrowserWindow }) => {
        const wc = (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents;
        return wc.executeJavaScript("!!document.querySelector('#full-name')");
      }),
      true,
    );
  });
  const session = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents;
    await wc.executeJavaScript("document.querySelector('#full-name').focus()");
    await wc.insertText('布局保留测试');
    return { id: wc.id, origin: await wc.executeJavaScript('performance.timeOrigin') };
  });
  await close();
  await layout('closed-again');
  await page.locator('.node-library').getByRole('button', { name: '浏览器', exact: true }).click();
  await page.getByRole('button', { name: '添加到主流程', exact: true }).click();
  await page.getByLabel('操作', { exact: true }).selectOption('fill');
  await page.locator('#browser-selector').fill('#full-name');
  await page.getByLabel('填写内容', { exact: true }).fill('未保存的配置');
  const selected = (await page.locator('.flow-shape.is-selected').getAttribute('data-step-id'))!;
  await open();
  await layout('selected-open', selected);
  for (const [width, height] of [
    [1040, 700],
    [1200, 800],
    [1380, 900],
  ]) {
    await resize(width, height);
    await layout(`${width}x${height}`, selected);
    assert.equal(await page.getByLabel('填写内容', { exact: true }).inputValue(), '未保存的配置');
    await close();
    await layout(`${width}x${height}-closed`, selected);
    await open();
    await layout(`${width}x${height}-reopened`, selected);
  }
  // Editing parameters must not reset a manually adjusted viewport.
  await page.getByRole('button', { name: 'Zoom Out', exact: true }).click();
  await page.waitForTimeout(350);
  const transform = () => page.locator('.react-flow__viewport').getAttribute('style');
  const before = await transform();
  await page.getByLabel('填写内容', { exact: true }).fill('保留手动缩放');
  await page.waitForTimeout(350);
  assert.equal(await transform(), before);
  const retained = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents;
    return {
      id: wc.id,
      origin: await wc.executeJavaScript('performance.timeOrigin'),
      value: await wc.executeJavaScript("document.querySelector('#full-name').value"),
    };
  });
  assert.deepEqual(retained, { ...session, value: '布局保留测试' });
  assert.equal((await state()).runs.length, 0);
  assert.equal(lab.state.attempts, 0);
  assert.deepEqual(errors, []);
  await resize(1040, 700);
  await layout('final-minimum', selected);
  // The horizontal library remains operable without scrolling the whole editor.
  await page
    .locator('.node-library')
    .getByRole('button', { name: '条件分支', exact: true })
    .click();
  await page.getByRole('button', { name: '添加到主流程', exact: true }).click();
  assert.equal(await page.locator('.flow-shape[data-shape="decision"]').count(), 1);
  const condition = (await page.locator('.flow-shape.is-selected').getAttribute('data-step-id'))!;
  await page.getByRole('button', { name: '添加到成立分支', exact: true }).click();
  assert.equal(await page.locator('.flow-shape[data-shape="decision"]').count(), 2);
  // A selected step near the end of a long flow must remain the resize target.
  const seed = (await state()).flows[0];
  await page.evaluate(
    ({ flow, bindings }) => (window as any).flowark.request('flow.save', { flow, bindings }),
    {
      flow: {
        ...seed.flow,
        id: 'layout_long',
        name: '长流程布局',
        steps: [
          ...Array.from({ length: 80 }, (_, i) => ({
            id: `value_${i}`,
            type: 'value',
            version: 1,
            value: i,
          })),
          {
            id: 'long_target',
            type: 'browser',
            version: 3,
            operation: 'fill',
            selector: '#full-name',
            framePath: [],
            value: '长流程保留',
          },
        ],
      },
      bindings: { ...seed.bindings, browserId: 'embedded' },
    },
  );
  await page.getByRole('button', { name: '我的流程', exact: true }).click();
  await page.getByRole('button', { name: '编辑 长流程布局', exact: true }).click();
  await close();
  const last = page.locator('.react-flow__node[data-id="long_target"]');
  await last.focus();
  await last.click();
  await open();
  await layout('long-selected-minimum', 'long_target');
  await resize(1380, 900);
  await layout('long-selected-wide', 'long_target');
  assert.equal(await page.getByLabel('填写内容', { exact: true }).inputValue(), '长流程保留');
  await resize(1040, 700);
  await layout('long-selected-minimum-again', 'long_target');
  evidence.selected = selected;
  evidence.condition = condition;
  await mkdir('test-results', { recursive: true });
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
  await app.evaluate(async ({ BrowserWindow }) => {
    const wc = (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents;
    await wc.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
  });
  const screenshot = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'),
  );
  await writeFile('test-results/editor-layout.png', Buffer.from(screenshot, 'base64'));
  // The workbench capture does not include the child WebContents surface.
  const webpage = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents;
    const image = await wc.capturePage();
    const bitmap = image.toBitmap();
    let painted = 0;
    for (let i = 0; i < bitmap.length; i += 4)
      if (bitmap[i] < 240 || bitmap[i + 1] < 240 || bitmap[i + 2] < 240) painted++;
    return { png: image.toPNG().toString('base64'), painted };
  });
  assert.ok(webpage.painted > 1000, 'native webpage is not blank');
  await writeFile('test-results/editor-layout-page.png', Buffer.from(webpage.png, 'base64'));
  evidence.painted = webpage.painted;
  evidence.passed = true;
  console.log(
    JSON.stringify({
      passed: true,
      version: evidence.version,
      layouts: evidence.layouts.length,
      data,
    }),
  );
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/editor-layout.json', JSON.stringify(evidence, null, 2));
  await app.close();
  await lab.close();
}
