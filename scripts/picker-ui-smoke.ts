import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startFormLab } from './fixtures/form-lab';
const data = await mkdtemp('/private/tmp/flowark-picker-ui-');
const lab = await startFormLab();
const app = await electron.launch({
  executablePath: process.env.FLOWARK_TEST_EXECUTABLE || (electronPath as unknown as string),
  args: process.env.FLOWARK_TEST_EXECUTABLE ? [] : [resolve('.')],
  env: { ...process.env, FLOWARK_DATA_DIR: data },
  timeout: 30000,
});
const evidence: any = { passed: false, data };
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!(window as any).flowark);
  const call = (method: string, args: any = {}) =>
    page.evaluate(({ method, args }) => (window as any).flowark.request(method, args), {
      method,
      args,
    });
  const site = async (script: string) =>
    app.evaluate(async ({ BrowserWindow }, expression) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children[0] as any;
      return view.webContents.executeJavaScript(expression);
    }, script);
  const pick = async (selector: string) => {
    // Scroll the fixture first, then send real input through its native WebContents.
    const point = await site(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
    );
    await page.getByRole('button', { name: '从网页选取', exact: true }).click();
    await page.waitForTimeout(300);
    await app.evaluate(({ BrowserWindow }, point) => {
      const wc = (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents;
      wc.sendInputEvent({ type: 'mouseMove', ...point });
      wc.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
    }, point);
    await page.locator('.picked-target').waitFor();
    assert.equal(await page.locator('#browser-selector').inputValue(), selector);
  };
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
  await page.getByRole('button', { name: '打开网页面板', exact: true }).click();
  await page.getByLabel('网页地址', { exact: true }).fill(lab.url);
  await page.getByRole('button', { name: '访问网页', exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: '新建流程', exact: true }).click();
  await page.locator('.title-input').fill('从空白搭建表单');
  while (await page.locator('.flow-shape[data-step-id]').count()) {
    await page.locator('.flow-shape[data-step-id]').first().click();
    await page.getByLabel('删除节点', { exact: true }).click();
  }
  const add = async (operation: string) => {
    await page
      .locator('.node-library')
      .getByRole('button', { name: '浏览器', exact: true })
      .click();
    await page.getByRole('button', { name: '添加到主流程', exact: true }).click();
    await page.getByLabel('操作', { exact: true }).selectOption(operation);
  };
  await add('navigate');
  await page.locator('#browser-url').fill(lab.url);
  for (const item of [
    { operation: 'fill', selector: '#full-name', value: '虚构拾取用户' },
    { operation: 'check', selector: '#channel-email' },
    { operation: 'check', selector: '#feature-audit' },
    { operation: 'select', selector: '#department', value: 'engineering' },
  ]) {
    await add(item.operation);
    await pick(item.selector);
    if (item.operation === 'fill')
      await page.getByLabel('填写内容', { exact: true }).fill(item.value!);
    if (item.operation === 'select')
      await page.getByLabel('网页中的选项', { exact: true }).selectOption(item.value!);
    assert.equal(
      await site(
        `document.querySelector(${JSON.stringify(item.selector)}).${item.operation === 'check' ? 'checked' : 'value'}`,
      ),
      item.operation === 'check' ? false : '',
    );
  }
  assert.equal(lab.state.attempts, 0);
  const editorImage = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'),
  );
  await writeFile('test-results/picker-editor.png', Buffer.from(editorImage, 'base64'));
  await page.getByRole('button', { name: '参数与绑定', exact: true }).click();
  await page.locator('.inspector select').selectOption('embedded');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const flow = (await call('bootstrap')).flows.find((f: any) => f.flow.name === '从空白搭建表单');
  assert.equal(flow.flow.steps.length, 5);
  assert.equal(flow.bindings.browserId, 'embedded');
  await page.getByRole('button', { name: '我的流程', exact: true }).click();
  await page.getByRole('button', { name: '编辑 从空白搭建表单', exact: true }).click();
  await page.getByRole('button', { name: '逐步调试', exact: true }).click();
  const wait = async (fn: () => Promise<any>) => {
    const end = Date.now() + 15000;
    while (!(await fn())) {
      if (Date.now() > end) throw new Error('等待调试超时');
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  let runId = '';
  await wait(async () => {
    const run = (await call('bootstrap')).runs.find((r: any) => r.flowId === flow.id);
    if (run?.state === 'PAUSED') {
      runId = run.id;
      return true;
    }
  });
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: '执行下一步', exact: true }).click();
    await wait(async () => {
      const d = await call('run.detail', { id: runId });
      return (
        d.events.filter((e: any) => e.type === 'node-end').length === i + 1 &&
        ['PAUSED', 'SUCCEEDED'].includes(d.run.state)
      );
    });
  }
  await wait(async () => (await call('run.detail', { id: runId })).run.state === 'SUCCEEDED');
  assert.deepEqual(
    await site(
      `({name:document.querySelector('#full-name').value,radio:document.querySelector('#channel-email').checked,check:document.querySelector('#feature-audit').checked,department:document.querySelector('#department').value})`,
    ),
    { name: '虚构拾取用户', radio: true, check: true, department: 'engineering' },
  );
  evidence.runId = runId;
  evidence.passed = true;
  const image = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'),
  );
  await writeFile('test-results/picker-ui.png', Buffer.from(image, 'base64'));
  console.log(JSON.stringify(evidence));
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/picker-ui.json', JSON.stringify(evidence, null, 2));
  await app.close();
  await lab.close();
}
