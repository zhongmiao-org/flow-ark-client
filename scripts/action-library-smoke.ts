import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const data = await mkdtemp('/private/tmp/flowark-action-library-');
const app = await electron.launch({
  executablePath: process.env.FLOWARK_TEST_EXECUTABLE || (electronPath as unknown as string),
  args: process.env.FLOWARK_TEST_EXECUTABLE ? [] : [resolve('.')],
  env: { ...process.env, FLOWARK_DATA_DIR: data },
});
const evidence: any = { passed: false, data };
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!(window as any).flowark);
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
  const state = () => page.evaluate(() => (window as any).flowark.request('bootstrap'));
  await page.getByRole('button', { name: /^(新建流程|创建空白流程)$/ }).click();
  await page.locator('.title-input').fill('动作库作用域验证');
  const search = page.getByLabel('搜索动作', { exact: true });
  const position = page.getByLabel('动作添加位置', { exact: true });
  const add = async (name: string) => {
    await search.fill(name);
    await page.getByRole('button', { name: '添加 ' + name, exact: true }).click();
    return (await page.locator('.flow-shape.is-selected').getAttribute('data-step-id'))!;
  };
  // Category filtering, search across categories, keywords, empty state, keyboard addition.
  await page.getByLabel('动作分类', { exact: true }).selectOption('流程控制');
  assert.equal(await page.locator('.action-list button').count(), 4);
  await search.fill('RaDio');
  assert.equal(await page.locator('.action-list button').count(), 1);
  assert.equal(await page.getByLabel('动作分类', { exact: true }).inputValue(), '全部');
  assert.equal(
    await page.locator('.action-list button').getAttribute('aria-label'),
    '添加 设置勾选状态',
  );
  await search.fill('没有这样的动作');
  assert.equal(await page.locator('.action-list button').count(), 0);
  assert.ok(await page.getByRole('status').textContent());
  await search.fill('条件');
  const conditionButton = page.getByRole('button', { name: '添加 条件分支', exact: true });
  await conditionButton.focus();
  await page.keyboard.press('Enter');
  const condition = (await page.locator('.flow-shape.is-selected').getAttribute('data-step-id'))!;
  await position.selectOption(condition + ':then');
  const first = await add('填写内容');
  await page.getByLabel('目标元素选择器', { exact: true }).fill('#full-name');
  await page.getByLabel('填写内容', { exact: true }).fill('分支内数据');
  const second = await add('设置勾选状态');
  assert.equal(await position.inputValue(), condition + ':then');
  await page.getByLabel('目标元素选择器', { exact: true }).fill('#feature-audit');
  const loop = await add('串行循环');
  await position.selectOption(loop + ':body');
  const inner = await add('数据');
  await position.selectOption(condition + ':else');
  const alternate = await add('等待人工');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  let flow = (await state()).flows.find((f: any) => f.flow.name === '动作库作用域验证');
  const branch = flow.flow.steps.find((s: any) => s.id === condition);
  assert.deepEqual(
    branch.then.map((s: any) => s.id),
    [first, second, loop],
  );
  assert.deepEqual(
    branch.then[2].body.map((s: any) => s.id),
    [inner],
  );
  assert.deepEqual(
    branch.else.map((s: any) => s.id),
    [alternate],
  );
  evidence.nestedScope = true;
  // Removing the destination must require an explicit new choice, never append to main silently.
  await position.selectOption(condition + ':then');
  const selectNode = async (id: string) => {
    const node = page.locator(`.react-flow__node[data-id="${id}"]`);
    await node.focus();
    await node.click();
  };
  await selectNode(condition);
  await page.getByLabel('删除节点', { exact: true }).click();
  assert.equal(await position.inputValue(), '');
  assert.equal(await page.locator('.action-list button:enabled').count(), 0);
  await position.selectOption('main');
  await add('数据');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  flow = (await state()).flows.find((f: any) => f.id === flow.id);
  assert.equal(flow.flow.steps.length, 3); // The default two steps and one explicit addition.
  evidence.deletedDestination = true;
  await page.getByRole('button', { name: '我的流程', exact: true }).click();
  await page.getByRole('button', { name: '编辑 动作库作用域验证', exact: true }).click();
  assert.equal(await search.inputValue(), '');
  assert.equal(await position.inputValue(), 'main');
  assert.equal(await page.locator('.action-list button').count(), 21);
  assert.equal((await state()).runs.length, 0);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/action-library.png' });
  evidence.passed = true;
  console.log(JSON.stringify(evidence));
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/action-library.json', JSON.stringify(evidence, null, 2));
  await app.close();
}
