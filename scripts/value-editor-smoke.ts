import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startFormLab } from './fixtures/platform-page';
const data = await mkdtemp('/private/tmp/flowark-values-');
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
  const label = (name: string) => page.getByLabel(name, { exact: true });
  const wait = async (check: () => Promise<boolean>) => {
    const end = Date.now() + 20000;
    while (!(await check())) {
      if (Date.now() > end) throw new Error('值编辑验收等待超时');
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const select = async (id: string) => {
    const node = page.locator(`.react-flow__node[data-id="${id}"]`);
    await node.focus();
    await node.click();
  };
  const add = async (name: string, title: string) => {
    await label('搜索动作').fill(name);
    await button('添加 ' + name).click();
    await label('步骤名称').fill(title);
    return (await page.locator('.flow-shape.is-selected').getAttribute('data-step-id'))!;
  };
  const ref = async (field: string, source: string, suffix = '') => {
    await button('选择变量 · ' + field).click();
    await label(field + '变量来源').selectOption(source);
    if (suffix) {
      await page
        .getByRole('group', { name: field + '变量选择', exact: true })
        .locator('summary')
        .click();
      await label(field + '变量子路径').fill(suffix);
    }
    await button('使用变量 · ' + field).click();
    assert.equal(
      await page
        .getByRole('region', { name: field + '配置', exact: true })
        .locator('.reference-value code')
        .innerText(),
      source + (suffix ? '.' + suffix : ''),
    );
  };
  const literal = async (field: string, type: string, text: string) => {
    await label(field + '类型').selectOption(type);
    if (type === 'boolean') await label(field).selectOption(text);
    else if (type !== 'null') await label(field).fill(text);
  };
  const parameter = async (name: string, type: string, text: string) => {
    await label('新参数名称').fill(name);
    await button('添加参数').click();
    await literal('参数 ' + name, type, text);
  };
  const raw = page.locator('.node-advanced textarea');
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
  await button('本地设置').click();
  await button('启用内置浏览器').click();
  await button('启用内置浏览器').waitFor({ state: 'hidden' });
  await button('我的流程').click();
  await button('新建流程').click();
  await page.locator('.title-input').fill('变量与表单编辑验收');
  await select('verify');
  await button('删除节点').click();
  await select('greeting');
  await button('删除节点').click();
  await button('参数与绑定').click();
  await parameter('site', 'string', lab.url);
  await parameter('userName', 'string', '虚构变量用户');
  await parameter('notify', 'boolean', 'true');
  await parameter('department', 'string', 'engineering');
  await parameter('minimumIndex', 'number', '-1');
  await parameter('optionalValue', 'null', '');
  await parameter('names', 'json', '["循环甲","循环乙"]');
  await label('本机浏览器').selectOption('embedded');
  const open = await add('打开网页', '打开本地表单');
  await ref('网页地址', 'params.site');
  const fill = await add('填写内容', '填写参数姓名');
  await label('目标元素选择器').fill('#full-name');
  await ref('填写内容', 'params.userName');
  await button('选择变量 · 填写内容').click();
  await label('填写内容变量搜索').fill('不存在的来源');
  assert.equal(await page.getByText('没有匹配的可用变量。', { exact: true }).count(), 1);
  await button('取消选择 · 填写内容').click();
  assert.match(
    await page.getByRole('region', { name: '填写内容配置', exact: true }).innerText(),
    /params.userName/,
  );
  await button('改为固定值 · 填写内容').click();
  assert.equal(await label('填写内容').inputValue(), '');
  await button('撤销编辑').click();
  assert.match(
    await page.getByRole('region', { name: '填写内容配置', exact: true }).innerText(),
    /params.userName/,
  );
  const check = await add('设置勾选状态', '使用布尔参数');
  await label('目标元素选择器').fill('#channel-email');
  await ref('目标状态', 'params.notify');
  assert.equal(await label('目标状态').count(), 0);
  const choice = await add('选择下拉选项', '使用部门参数');
  await label('目标元素选择器').fill('#department');
  await ref('选项值', 'params.department');
  assert.equal(await label('选择方式').count(), 0);
  const read = await add('读取当前输入值', '读取姓名');
  await label('目标元素选择器').fill('#full-name');
  const branch = await add('条件分支', '姓名一致');
  await ref('判断值', 'steps.' + read);
  await ref('比较值', 'params.userName');
  await label('动作添加位置').selectOption(branch + ':then');
  const verify = await add('结果断言', '成立分支核对');
  await ref('判断值', 'steps.' + read);
  await ref('比较值', 'params.userName');
  await label('动作添加位置').selectOption(branch + ':else');
  const fail = await add('结果断言', '错误分支不得执行');
  await literal('判断值', 'boolean', 'false');
  await button('选择变量 · 判断值').click();
  const branchOptions = await label('判断值变量来源')
    .locator('option')
    .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
  assert.ok(!branchOptions.includes('steps.' + verify));
  assert.ok(!branchOptions.includes('steps.' + branch));
  await button('取消选择 · 判断值').click();
  await label('动作添加位置').selectOption('main');
  const loop = await add('串行循环', '逐项填写说明');
  await ref('循环集合', 'params.names');
  await label('动作添加位置').selectOption(loop + ':body');
  const loopFill = await add('填写内容', '填写当前项');
  await label('目标元素选择器').fill('#notes');
  await ref('填写内容', 'item');
  const index = await add('数据', '记录当前序号');
  await ref('数据值', 'index');
  await add('结果断言', '核对数字序号');
  await ref('判断值', 'index');
  await label('判断方式').selectOption('gt');
  await ref('比较值', 'params.minimumIndex');
  await label('动作添加位置').selectOption('main');
  const readNotes = await add('读取当前输入值', '读取最终说明');
  await label('目标元素选择器').fill('#notes');
  const final = await add('结果断言', '最终说明核对');
  await ref('判断值', 'steps.' + readNotes);
  await literal('比较值', 'string', '循环乙');
  const script = await add('JS / TS 脚本', '使用前序输出');
  await ref('脚本输入', 'steps.' + read);
  await button('选择变量 · 脚本输入').click();
  const rootOptions = await label('脚本输入变量来源')
    .locator('option')
    .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
  for (const inaccessible of [
    'item',
    'index',
    'steps.' + loopFill,
    'steps.' + index,
    'steps.' + verify,
    'steps.' + fail,
    'steps.' + script,
  ])
    assert.ok(!rootOptions.includes(inaccessible), inaccessible);
  await button('取消选择 · 脚本输入').click();
  // Invalid suffix has no implicit rewrite or effect on the active draft value.
  await button('选择变量 · 脚本输入').click();
  await page
    .getByRole('group', { name: '脚本输入变量选择', exact: true })
    .locator('summary')
    .click();
  await label('脚本输入变量子路径').fill('constructor');
  assert.equal(await button('使用变量 · 脚本输入').isEnabled(), false);
  await button('取消选择 · 脚本输入').click();
  await button('参数与绑定').click();
  await button('删除参数 userName').click();
  assert.match(
    await page
      .getByRole('region', { name: '运行参数配置', exact: true })
      .getByRole('alert')
      .innerText(),
    /仍引用 params.userName/,
  );
  await label('参数 names').fill('[');
  await button('保存').click();
  assert.equal(
    await page.getByText('请先修正未完成的值配置，再保存或运行', { exact: true }).count(),
    1,
  );
  assert.equal((await call('bootstrap')).runs.length, 0);
  await label('参数 names').fill('["循环甲","循环乙"]');
  await button('保存').click();
  let saved: any;
  await wait(async () => {
    saved = (await call('bootstrap')).flows.find((f: any) => f.flow.name === '变量与表单编辑验收');
    return saved?.flow.steps.length === 10;
  });
  assert.deepEqual(saved.flow.parameters.names, ['循环甲', '循环乙']);
  assert.equal(saved.flow.parameters.notify, true);
  assert.equal(saved.flow.parameters.minimumIndex, -1);
  assert.equal(saved.flow.parameters.optionalValue, null);
  assert.equal((await call('bootstrap')).runs.length, 0);
  assert.equal(lab.state.attempts, 0);
  evidence.checks.push('typed-parameters-scope-cancel-history-and-invalid-input-guards');
  await button('我的流程').click();
  await button('编辑 变量与表单编辑验收').click();
  await select(fill);
  assert.match(
    await page.getByRole('region', { name: '填写内容配置', exact: true }).innerText(),
    /params.userName/,
  );
  await button('打开网页面板').click();
  await label('网页地址').fill(lab.url);
  await button('访问网页').click();
  await wait(async () => (await call('browser.embedded.status')).url === new URL(lab.url).href);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 700));
  await button('选择变量 · 填写内容').click();
  assert.ok(
    await page.evaluate(() =>
      ['main', '.inspector', '.reference-picker'].every((s) => {
        const e = document.querySelector(s)!;
        return e.scrollWidth <= e.clientWidth + 1;
      }),
    ),
  );
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/value-editor.png' });
  await button('取消选择 · 填写内容').click();
  await button('逐步调试').click();
  let run: any;
  await wait(async () => {
    run = (await call('bootstrap')).runs.find((r: any) => r.flowId === saved.id);
    return run?.state === 'PAUSED';
  });
  await button('执行下一步').click();
  await wait(async () => {
    const d = await call('run.detail', { id: run.id });
    return (
      d.run.state === 'PAUSED' &&
      d.events.some((e: any) => e.type === 'node-end' && e.nodeInstance === open)
    );
  });
  await button('继续').click();
  await wait(async () => {
    const d = await call('run.detail', { id: run.id });
    if (d.run.state === 'FAILED') throw new Error(d.run.error);
    return d.run.state === 'SUCCEEDED';
  });
  const values = await app.evaluate(async ({ BrowserWindow }) =>
    (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents.executeJavaScript(
      "({name:document.querySelector('#full-name').value,checked:document.querySelector('#channel-email').checked,department:document.querySelector('#department').value,notes:document.querySelector('#notes').value,width:innerWidth})",
    ),
  );
  assert.deepEqual(values, {
    name: '虚构变量用户',
    checked: true,
    department: 'engineering',
    notes: '循环乙',
    width: 1920,
  });
  const detail = await call('run.detail', { id: run.id }),
    ended = detail.events.filter((e: any) => e.type === 'node-end');
  assert.equal(detail.output[script], '虚构变量用户');
  assert.equal(detail.output[loop][0][index], 0);
  assert.equal(detail.output[loop][1][index], 1);
  assert.ok(!ended.some((e: any) => e.nodeInstance === `${branch}/${fail}`));
  assert.equal(lab.state.attempts, 0);
  evidence.checks.push('save-reopen-narrow-layout-step-debug-and-real-resolved-values');
  // Advanced unknown field paths remain explicit runtime errors, never fallback data.
  await button('我的流程').click();
  await button('编辑 变量与表单编辑验收').click();
  await select(script);
  await ref('脚本输入', 'steps.' + read, 'missing');
  await button('逐步调试').click();
  let bad: any;
  await wait(async () => {
    bad = (await call('bootstrap')).runs.find((r: any) => r.flowId === saved.id && r.id !== run.id);
    return bad?.state === 'PAUSED';
  });
  await button('继续').click();
  await wait(async () => {
    const d = await call('run.detail', { id: bad.id });
    return d.run.state === 'FAILED';
  });
  const failed = await call('run.detail', { id: bad.id });
  assert.match(failed.run.error, /引用值不存在/);
  assert.equal(lab.state.attempts, 0);
  evidence.checks.push('missing-dynamic-field-fails-without-fallback');
  evidence.runId = run.id;
  evidence.passed = true;
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/value-editor.json', JSON.stringify(evidence, null, 2));
  await app.close();
  await lab.close();
  console.log(JSON.stringify(evidence));
}
