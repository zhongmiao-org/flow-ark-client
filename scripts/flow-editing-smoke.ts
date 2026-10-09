import assert from 'node:assert/strict';
import { desktopElectron as electron } from './desktop-session.mjs';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startFormLab } from './fixtures/platform-page';
const data = await mkdtemp('/private/tmp/flowark-editing-');
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
  const call = (method: string, args: any = {}): Promise<any> =>
    page.evaluate(({ method, args }) => (window as any).flowark.request(method, args), {
      method,
      args,
    });
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const selected = () =>
    page.locator('.flow-shape.is-selected').getAttribute('data-step-id') as Promise<string>;
  const count = () => page.locator('.flow-shape[data-step-id]').count();
  const undo = () => button('撤销编辑').click();
  const redo = () => button('重做编辑').click();
  const select = async (id: string) => {
    const n = page.locator(`.react-flow__node[data-id="${id}"]`);
    await n.focus();
    await n.click();
  };
  const add = async (name: string) => {
    await page.getByLabel('搜索动作', { exact: true }).fill(name);
    await button('添加 ' + name).click();
    return selected();
  };
  const wait = async (check: () => Promise<boolean>) => {
    const end = Date.now() + 15000;
    while (!(await check())) {
      if (Date.now() > end) throw new Error('等待编辑验收超时');
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const raw = page.locator('.node-advanced textarea');
  const position = page.getByLabel('动作添加位置', { exact: true });
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
  await button('本地设置').click();
  await button('启用内置浏览器').click();
  await button('启用内置浏览器').waitFor({ state: 'hidden' });
  await button('我的流程').click();
  await page.getByRole('button', { name: /^(新建流程|创建空白流程)$/ }).click();
  const title = page.locator('.title-input'),
    originalTitle = await title.inputValue();
  await title.press('End');
  await title.pressSequentially('ABC');
  await undo();
  assert.equal(await title.inputValue(), originalTitle);
  await redo();
  assert.ok((await title.inputValue()).endsWith('ABC'));
  await title.fill('流程结构编辑验收');
  await select('greeting');
  await button('删除节点').click();
  assert.match(await page.getByRole('alert').innerText(), /verify.*steps.greeting/);
  assert.equal(await count(), 2);
  await select('verify');
  await button('节点上移').click();
  assert.match(await page.getByRole('alert').innerText(), /verify.*steps.greeting/);
  await button('删除节点').click();
  await select('greeting');
  await button('删除节点').click();
  assert.equal(await count(), 0);
  await undo();
  assert.equal(await selected(), 'greeting');
  await redo();
  assert.equal(await count(), 0);
  evidence.checks.push('grouped-title-history-and-reference-guards');
  const open = await add('打开网页');
  await page.locator('#browser-url').fill(lab.url);
  await button('在后面插入').click();
  const fill = await add('填写内容');
  await page.locator('#browser-selector').fill('#full-name');
  await page.getByLabel('填写内容', { exact: true }).fill('原始填写');
  const check = await add('设置勾选状态');
  await page.locator('#browser-selector').fill('#channel-email');
  assert.equal(await position.inputValue(), check + ':after');
  await select(fill);
  await button('在前面插入').click();
  const marker = await add('数据');
  await page.locator('.node-advanced summary').click();
  await raw.fill(JSON.stringify({ id: marker, type: 'value', version: 1, value: 'marker' }));
  await select(fill);
  await button('复制节点').click();
  const copy = await selected();
  assert.notEqual(copy, fill);
  assert.equal(await page.getByLabel('填写内容', { exact: true }).inputValue(), '原始填写');
  await page.getByLabel('填写内容', { exact: true }).fill('副本最终填写');
  await undo();
  assert.equal(await page.getByLabel('填写内容', { exact: true }).inputValue(), '原始填写');
  await undo();
  assert.equal(await selected(), fill);
  assert.equal(await count(), 4);
  await redo();
  assert.equal(await selected(), copy);
  await redo();
  assert.equal(await page.getByLabel('填写内容', { exact: true }).inputValue(), '副本最终填写');
  // A text-field Cmd-Z must not remove a copied step from the structural history.
  await page.getByLabel('填写内容', { exact: true }).click();
  await page.getByLabel('填写内容', { exact: true }).press('Meta+z');
  assert.equal(await count(), 5);
  await page.getByLabel('填写内容', { exact: true }).fill('副本最终填写');
  await position.selectOption('main');
  const branch = await add('条件分支');
  await position.selectOption(branch + ':then');
  const loop = await add('串行循环');
  await position.selectOption(loop + ':body');
  const item = await add('数据');
  await page.locator('.node-advanced summary').click();
  await raw.fill(JSON.stringify({ id: item, type: 'value', version: 1, value: { $ref: 'item' } }));
  await page.getByLabel('步骤移动位置', { exact: true }).selectOption('main');
  await button('移动').click();
  assert.match(await page.getByRole('alert').innerText(), /item.*作用域|作用域/);
  await select(marker);
  await page.getByLabel('步骤移动位置', { exact: true }).selectOption(branch + ':else');
  await button('移动').click();
  await select(branch);
  await button('复制节点').click();
  const branchCopy = await selected(),
    copiedCount = await count();
  assert.notEqual(branchCopy, branch);
  await undo();
  assert.equal(await count(), copiedCount - 4);
  assert.equal(await selected(), branch);
  // Canvas shortcuts operate on the draft. Input focus continues to use native undo.
  await page.locator(`.react-flow__node[data-id="${branch}"]`).focus();
  await page.keyboard.press('Meta+Shift+z');
  assert.equal(await selected(), branchCopy);
  assert.equal(await count(), copiedCount);
  evidence.checks.push('relative-insertion-copy-move-nested-history-and-shortcuts');
  await button('参数与绑定').click();
  await page.getByLabel('本机浏览器', { exact: true }).selectOption('embedded');
  await undo();
  assert.equal(await page.getByLabel('本机浏览器', { exact: true }).inputValue(), '');
  await redo();
  assert.equal(await page.getByLabel('本机浏览器', { exact: true }).inputValue(), 'embedded');
  await button('保存').click();
  let flow: any;
  await wait(async () => {
    flow = (await call('bootstrap')).flows.find((f: any) => f.flow.name === '流程结构编辑验收');
    return !!flow && flow.flow.steps.length === 6;
  });
  assert.deepEqual(
    flow.flow.steps.map((n: any) => n.id),
    [open, fill, copy, check, branch, branchCopy],
  );
  assert.equal(flow.flow.steps[4].else[0].id, marker);
  const allIds = (nodes: any[]): string[] =>
    nodes.flatMap((n) => [
      n.id,
      ...allIds(n.then ?? []),
      ...allIds(n.else ?? []),
      ...allIds(n.body ?? []),
    ]);
  assert.equal(new Set(allIds(flow.flow.steps)).size, allIds(flow.flow.steps).length);
  assert.equal((await call('bootstrap')).runs.length, 0);
  assert.equal(lab.state.attempts, 0);
  await button('我的流程').click();
  await button('编辑 流程结构编辑验收').click();
  assert.equal(await button('撤销编辑').isEnabled(), false);
  assert.equal(await button('重做编辑').isEnabled(), false);
  await select(copy);
  assert.equal(await page.getByLabel('填写内容', { exact: true }).inputValue(), '副本最终填写');
  await button('打开网页面板').click();
  await page.getByLabel('网页地址', { exact: true }).fill(lab.url);
  await button('访问网页').click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 700));
  await wait(async () =>
    page.evaluate(() => {
      const main = document.querySelector('main')!;
      const heading = document.querySelector('.inspector-heading')!;
      const inspector = document.querySelector('.inspector')!;
      return (
        main.scrollWidth <= main.clientWidth + 1 &&
        heading.scrollWidth <= heading.clientWidth + 1 &&
        inspector.scrollWidth <= inspector.clientWidth + 1
      );
    }),
  );
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/flow-editing.png' });
  await button('逐步调试').click();
  let run: any;
  await wait(async () => {
    run = (await call('bootstrap')).runs.find((r: any) => r.flowId === flow.id);
    return run?.state === 'PAUSED';
  });
  // Save an edited draft while the existing run is paused at its immutable snapshot.
  await button('我的流程').click();
  await button('编辑 流程结构编辑验收').click();
  await select(copy);
  await page.getByLabel('填写内容', { exact: true }).fill('仅影响下一次运行');
  await button('保存').click();
  await wait(
    async () =>
      (await call('bootstrap')).flows.find((f: any) => f.id === flow.id).flow.steps[2].value ===
      '仅影响下一次运行',
  );
  await button('运行记录').click();
  await button('查看').click();
  for (let i = 0; i < 4; i++) {
    await button('执行下一步').click();
    await wait(async () => {
      const d = await call('run.detail', { id: run.id });
      return (
        d.run.state === 'PAUSED' &&
        d.events.filter((e: any) => e.type === 'node-end').length === i + 1
      );
    });
  }
  const values = await app.evaluate(async ({ BrowserWindow }) =>
    (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents.executeJavaScript(
      "({name:document.querySelector('#full-name').value,radio:document.querySelector('#channel-email').checked,width:innerWidth})",
    ),
  );
  assert.deepEqual(values, { name: '副本最终填写', radio: true, width: 1920 });
  await button('继续').click();
  await wait(async () => {
    const d = await call('run.detail', { id: run.id });
    if (d.run.state === 'FAILED') throw new Error(d.run.error);
    return d.run.state === 'SUCCEEDED';
  });
  assert.equal(lab.state.attempts, 0);
  evidence.checks.push('bindings-save-reopen-minimum-layout-and-immutable-debug-run');
  evidence.runId = run.id;
  evidence.passed = true;
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/flow-editing.json', JSON.stringify(evidence, null, 2));
  await app.close();
  await lab.close();
  console.log(JSON.stringify(evidence));
}
