import assert from 'node:assert/strict';
import { _electron as electron, type Page } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Run, Step } from '../src/shared/types';
import { startFormLab } from './fixtures/platform-page';
import { formBrowser } from './fixtures/platform-flow';

// Actual host/Worker deadlines and embedded form actions; no clocks, states, or browser
// results are mocked. The isolated app contains only fictional flows and localhost pages.
const data = await mkdtemp('/private/tmp/flowark-node-timeout-ui-');
const lab = await startFormLab();
const app = await electron.launch({
  executablePath: process.env.FLOWARK_TEST_EXECUTABLE || (electronPath as unknown as string),
  args: process.env.FLOWARK_TEST_EXECUTABLE ? [] : [resolve('.')],
  env: {
    ...process.env,
    FLOWARK_DATA_DIR: data,
    PLAYWRIGHT_BROWSERS_PATH: join(data, 'empty-browser-cache'),
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
  },
  timeout: 30000,
});
let page: Page;
const evidence: any = { passed: false, data, url: lab.url, checks: [], runs: [] };
const call = (method: string, args: any = {}): Promise<any> =>
  page.evaluate(({ method, args }) => (window as any).flowark.request(method, args), {
    method,
    args,
  });
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const wait = async (predicate: () => Promise<boolean>, label: string, timeout = 20000) => {
  const end = performance.now() + timeout;
  while (!(await predicate())) {
    if (performance.now() > end) throw new Error('节点期限验收超时：' + label);
    await delay(50);
  }
};
const state = async (run: Run, expected: string) => {
  let detail: any;
  await wait(
    async () => {
      detail = await call('run.detail', { id: run.id });
      if (
        detail.run.state !== expected &&
        ['FAILED', 'SUCCEEDED', 'CANCELLED', 'INTERRUPTED'].includes(detail.run.state)
      )
        throw new Error('非预期运行终态：' + JSON.stringify(detail.run));
      return detail.run.state === expected;
    },
    run.name + ' -> ' + expected,
  );
  return detail;
};
const form = () =>
  app.evaluate(async ({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0].contentView
      .children[0] as Electron.WebContentsView;
    return view.webContents.executeJavaScript(`({
    name: document.querySelector('#full-name').value,
    radio: document.querySelector('#channel-email').checked,
    department: document.querySelector('#department').value,
    width: innerWidth
  })`);
  });
const note = (message: string) => {
  evidence.checks.push(message);
  console.log(message);
};
try {
  page = await app.firstWindow();
  await page.waitForFunction(() => !!(window as any).flowark);
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
  await page.getByRole('button', { name: '本地设置', exact: true }).click();
  await page.getByRole('button', { name: '启用内置浏览器', exact: true }).click();
  await wait(
    async () =>
      (await call('bootstrap')).browsers.some((binding: any) => binding.product === 'embedded'),
    '内置绑定',
  );
  await page.getByRole('button', { name: '打开网页面板', exact: true }).click();
  const browser = (await call('bootstrap')).browsers.find(
    (binding: any) => binding.product === 'embedded',
  );
  const create = async (name: string, steps: Step[]) => {
    const record = await call('flow.create');
    await call('flow.save', {
      flow: { ...record.flow, name, steps },
      bindings: { browserId: browser.id, files: {}, credentials: [] },
    });
    return record.id as string;
  };
  const prefix = () => [
    formBrowser('open', 'navigate', '', lab.url),
    formBrowser('fill', 'fill', '#full-name', '虚构超时前输入'),
    formBrowser('radio', 'check', '#channel-email', true),
    formBrowser('select', 'select', '#department', 'engineering'),
  ];
  const human = (id: string, timeoutMs?: number): Step => ({
    id,
    type: 'human',
    version: 1,
    message: '只等待期限，不提交表单',
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  const cases: { name: string; node: Step; expected: string; budget: number }[] = [
    { name: '人工等待期限', node: human('wait', 1500), expected: 'wait', budget: 1500 },
    {
      name: '条件整体期限',
      node: {
        id: 'branch',
        type: 'condition',
        version: 1,
        timeoutMs: 1500,
        actual: true,
        operator: 'equals',
        expected: true,
        then: [human('inside', 10000)],
        else: [],
      },
      expected: 'branch',
      budget: 1500,
    },
    {
      name: '循环整体期限',
      node: {
        id: 'loop',
        type: 'loop',
        version: 1,
        timeoutMs: 3000,
        items: ['虚构第一轮', '虚构第二轮', '禁止第三轮'],
        body: [formBrowser('iteration', 'fill', '#full-name', { $ref: 'item' }), human('inside')],
      },
      expected: 'loop',
      budget: 3000,
    },
  ];
  const recoveryId = await create('超时后内置浏览器恢复', [
    ...prefix(),
    formBrowser('recovered', 'fill', '#full-name', '虚构恢复输入'),
    formBrowser('read', 'inputValue', '#full-name'),
    {
      id: 'verify',
      type: 'assert',
      version: 1,
      actual: { $ref: 'steps.read' },
      operator: 'equals',
      expected: '虚构恢复输入',
    },
  ]);
  for (const scenario of cases) {
    const id = await create(scenario.name, [
      ...prefix(),
      scenario.node,
      formBrowser('must_not_fill', 'fill', '#full-name', '禁止超时后填写'),
      formBrowser('must_not_submit', 'click', '#submit'),
    ]);
    const run: Run = await call('flow.run', { id });
    await state(run, 'WAITING_INPUT');
    const before = await form();
    assert.equal(before.width, 1920);
    assert.equal(before.radio, true);
    assert.equal(before.department, 'engineering');
    assert.equal(before.name, scenario.expected === 'loop' ? '虚构第一轮' : '虚构超时前输入');
    if (scenario.expected === 'loop') {
      await call('run.control', { id: run.id, action: 'resume' });
      await wait(async () => {
        const detail = await call('run.detail', { id: run.id });
        if (['FAILED', 'INTERRUPTED'].includes(detail.run.state)) throw new Error(detail.run.error);
        return (
          detail.run.state === 'WAITING_INPUT' &&
          detail.events.some(
            (event: any) => event.nodeInstance === 'loop[1]/inside' && event.type === 'node-start',
          )
        );
      }, '第二轮真实等待');
      assert.equal((await form()).name, '虚构第二轮');
    }
    const failed = await state(run, 'FAILED');
    assert.ok(
      failed.run.error.includes(`${scenario.expected}（${scenario.budget} 毫秒）`),
      failed.run.error,
    );
    assert.ok(
      !failed.events.some((event: any) =>
        ['must_not_fill', 'must_not_submit'].includes(event.nodeInstance),
      ),
    );
    assert.ok(
      !failed.events.some(
        (event: any) => event.type === 'node-end' && event.nodeInstance === scenario.expected,
      ),
    );
    assert.ok(!failed.events.some((event: any) => event.nodeInstance.startsWith('loop[2]')));
    await wait(async () => !(await call('browser.embedded.status')).started, '超时后回收内置会话');
    assert.equal(lab.state.attempts, 0);
    evidence.runs.push({
      id: run.id,
      name: run.name,
      state: failed.run.state,
      error: failed.run.error,
      formBeforeTimeout: before,
    });
    const recovery: Run = await call('flow.run', { id: recoveryId });
    await state(recovery, 'SUCCEEDED');
    assert.deepEqual(await form(), {
      name: '虚构恢复输入',
      radio: true,
      department: 'engineering',
      width: 1920,
    });
    note(scenario.name + '失败后不执行后续动作，浏览器与运行槽重新可用');
  }
  const unlimitedId = await create('未设置期限的人工等待', [
    ...prefix(),
    human('manual'),
    { id: 'done', type: 'value', version: 1, value: true },
  ]);
  const unlimited: Run = await call('flow.run', { id: unlimitedId });
  await state(unlimited, 'WAITING_INPUT');
  await delay(1800);
  assert.equal((await call('run.detail', { id: unlimited.id })).run.state, 'WAITING_INPUT');
  await call('run.control', { id: unlimited.id, action: 'resume' });
  await state(unlimited, 'SUCCEEDED');
  note('未设期限的人工作业继续等待，确认后成功');
  const cancelId = await create('有期限时主动取消', [
    ...prefix(),
    human('manual', 10000),
    formBrowser('must_not_submit', 'click', '#submit'),
  ]);
  const cancel: Run = await call('flow.run', { id: cancelId });
  await state(cancel, 'WAITING_INPUT');
  await call('run.control', { id: cancel.id, action: 'cancel' });
  const cancelled = await state(cancel, 'CANCELLED');
  assert.ok(!cancelled.events.some((event: any) => event.nodeInstance === 'must_not_submit'));
  note('主动取消仍记CANCELLED，未误报超时');
  await page.getByRole('button', { name: '运行记录', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: evidence.runs[0].id.slice(0, 8) });
  await row.getByRole('button', { name: '查看', exact: true }).click();
  await page.locator('.alert.error').filter({ hasText: 'wait（1500 毫秒）' }).waitFor();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/node-timeout-history.png' });
  evidence.historyScreenshot = 'test-results/node-timeout-history.png';
  assert.equal(lab.state.attempts, 0);
  evidence.passed = true;
} catch (error) {
  evidence.error = String(error);
  evidence.bootstrap = await call('bootstrap').catch(() => undefined);
  throw error;
} finally {
  const child = app.process();
  const ended =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve({ code: child.exitCode, signal: child.signalCode })
      : new Promise<{ code: number | null; signal: string | null }>((resolve) =>
          child.once('exit', (code, signal) => resolve({ code, signal })),
        );
  const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
  try {
    const boot = await call('bootstrap').catch(() => ({ runs: [] }));
    for (const run of boot.runs.filter(
      (run: Run) => !['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(run.state),
    ))
      await call('run.control', { id: run.id, action: 'cancel' }).catch(() => {});
    await wait(async () => !(await call('bootstrap')).runOverview.active, '退出前回收').catch(
      () => {},
    );
    await app
      .evaluate(({ Menu }) => {
        setTimeout(
          () =>
            Menu.getApplicationMenu()
              ?.items[0].submenu?.items.find((item) => item.label === '退出 FlowArk')
              ?.click(),
          50,
        );
      })
      .catch(() => {});
    evidence.exit = await ended;
  } finally {
    clearTimeout(timeout);
  }
  await lab.close();
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/node-timeout.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
  assert.deepEqual(evidence.exit, { code: 0, signal: null });
}
