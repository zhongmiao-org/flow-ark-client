import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { _electron as electron, type Page } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FlowRecord, Run, Step } from '../src/shared/types';
import { startFormLab } from './fixtures/form-lab';
import { formBrowser } from './fixtures/form-lab-flow';

const data = await mkdtemp('/private/tmp/flowark-rerun-ui-');
const lab = await startFormLab();
const receipts: string[] = [];
const receiver = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  receipts.push(JSON.parse(body).name);
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ received: receipts.length }));
});
await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
const receiptUrl = `http://127.0.0.1:${(receiver.address() as any).port}/receipt`;
const launch = () =>
  electron.launch({
    executablePath: process.env.FLOWARK_TEST_EXECUTABLE || (electronPath as unknown as string),
    args: process.env.FLOWARK_TEST_EXECUTABLE ? [] : [resolve('.')],
    env: { ...process.env, FLOWARK_DATA_DIR: data },
    timeout: 30000,
  });
let app = await launch();
let page: Page;
const evidence: any = { passed: false, data, checks: [], runs: [] };
const call = (method: string, args: any = {}): Promise<any> =>
  page.evaluate(({ method, args }) => (window as any).flowark.request(method, args), {
    method,
    args,
  });
const button = (name: string) => page.getByRole('button', { name, exact: true });
const reviewLabel = '已核对原运行的输出与外部结果，确认从头执行';
const previewForm = () => page.getByRole('form', { name: '重新运行预览', exact: true });
const wait = async (test: () => Promise<boolean>, message: string) => {
  const end = Date.now() + 25000;
  while (!(await test())) {
    if (Date.now() > end) throw new Error('重跑界面验证超时：' + message);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
const state = async (run: Run, expected: string) => {
  let detail: any;
  await wait(async () => {
    detail = await call('run.detail', { id: run.id });
    if (
      detail.run.state !== expected &&
      ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(detail.run.state)
    )
      throw new Error('非预期终态：' + JSON.stringify(detail.run));
    return detail.run.state === expected;
  }, expected);
  return detail;
};
const count = async () => (await call('bootstrap')).runOverview.total as number;
const runs = async () => (await call('bootstrap')).runs as Run[];
const formValues = () =>
  app.evaluate(async ({ BrowserWindow }) =>
    (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents
      .executeJavaScript(`({
    name:document.querySelector('#full-name').value,
    radio:document.querySelector('#channel-email').checked,
    department:document.querySelector('#department').value,
    width:innerWidth
  })`),
  );
const openRun = async (id: string) => {
  await button('运行记录').click();
  if (await button('全部记录').count()) await button('全部记录').click();
  await page.getByLabel('搜索运行记录', { exact: true }).fill(id);
  await button('查询').click();
  const row = page
    .locator('.run-history tbody tr')
    .filter({ has: page.locator(`small[title="${id}"]`) });
  await row.getByRole('button', { name: '查看', exact: true }).click();
  await page.getByRole('region', { name: '人工核对后重新运行', exact: true }).waitFor();
};
const preview = async () => {
  await button('预览重新运行').click();
  await previewForm().waitFor();
  assert.equal(await button('确认从头运行').isDisabled(), true);
};
const latestAfter = async (before: Set<string>) => {
  let run: Run | undefined;
  await wait(async () => {
    run = (await runs()).find((r) => !before.has(r.id));
    return Boolean(run);
  }, '新 Run');
  evidence.runs.push(run!.id);
  return run!;
};
const confirm = async () => {
  const before = new Set((await runs()).map((r) => r.id));
  await page.getByLabel(reviewLabel, { exact: true }).check();
  await button('确认从头运行').click();
  return latestAfter(before);
};
const note = (message: string) => {
  evidence.checks.push(message);
  console.log(message);
};
// Delay only a response after the actual product handler finishes. No host result is mocked.
const installReplyHook = () =>
  app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as any)._invokeHandlers as Map<
      string,
      (...args: any[]) => Promise<any>
    >;
    const original = handlers.get('flowark:request')!;
    const gate = {
      method: '',
      id: '',
      lose: false,
      pending: false,
      done: false,
      release: undefined as undefined | (() => void),
    };
    (globalThis as any).__rerunReply = gate;
    handlers.set('flowark:request', async (...args: any[]) => {
      const match = gate.method === args[1] && gate.id === args[2]?.id;
      if (match) gate.method = '';
      const result = await original(...args);
      if (match) {
        if (gate.lose) throw new Error('fixture: reply lost after admission');
        gate.pending = true;
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
        gate.done = true;
      }
      return result;
    });
  });
const hold = (method: string, id: string, lose = false) =>
  app.evaluate(
    (_, next) => {
      Object.assign((globalThis as any).__rerunReply, {
        ...next,
        pending: false,
        done: false,
        release: undefined,
      });
    },
    { method, id, lose },
  );
const pending = () =>
  wait(() => app.evaluate(() => Boolean((globalThis as any).__rerunReply.pending)), '暂缓真实回复');
const release = async () => {
  await app.evaluate(() => (globalThis as any).__rerunReply.release());
  await wait(
    () => app.evaluate(() => Boolean((globalThis as any).__rerunReply.done)),
    '释放真实回复',
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
};
try {
  page = await app.firstWindow();
  await page.waitForFunction(() => Boolean((window as any).flowark));
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
  await button('本地设置').click();
  await button('启用内置浏览器').click();
  await wait(
    async () => (await call('bootstrap')).browsers.some((b: any) => b.id === 'embedded'),
    '内置绑定',
  );
  await button('打开网页面板').click();
  const created: FlowRecord = await call('flow.create');
  const steps: Step[] = [
    formBrowser('open', 'navigate', '', lab.url),
    formBrowser('fill', 'fill', '#full-name', { $ref: 'params.name' }),
    formBrowser('radio', 'check', '#channel-email', true),
    formBrowser('select', 'select', '#department', 'engineering'),
    {
      id: 'receipt',
      type: 'http',
      version: 1,
      method: 'POST',
      url: receiptUrl,
      headers: { 'Content-Type': 'application/json' },
      body: { name: { $ref: 'params.name' } },
    },
    { id: 'inspect', type: 'human', version: 1, message: '核对实际表单后继续到失败断言' },
    { id: 'verify', type: 'assert', version: 1, actual: false, operator: 'equals', expected: true },
  ];
  const originalFlow = {
    ...created.flow,
    name: '虚构关联重跑',
    parameters: { name: '原快照虚构用户' },
    steps,
  };
  const bindings = { browserId: 'embedded', files: {}, credentials: [] };
  await call('flow.save', { flow: originalFlow, bindings });
  const original: Run = await call('flow.run', { id: created.id });
  await state(original, 'WAITING_INPUT');
  assert.deepEqual(await formValues(), {
    name: '原快照虚构用户',
    radio: true,
    department: 'engineering',
    width: 1920,
  });
  await call('run.control', { id: original.id, action: 'resume' });
  const originalDetail = await state(original, 'FAILED');
  assert.deepEqual(receipts, ['原快照虚构用户']);
  const savedFlow = {
    ...originalFlow,
    parameters: { name: '已保存虚构用户' },
    steps: steps
      .filter((node) => node.id !== 'inspect')
      .map((node) => (node.id === 'verify' ? { ...node, actual: true } : node)),
  };
  await call('flow.save', { flow: savedFlow, bindings });
  await openRun(original.id);
  assert.equal(
    await page.getByLabel('重新运行使用的内容', { exact: true }).inputValue(),
    'snapshot',
  );
  await preview();
  assert.equal(await count(), 1);
  assert.deepEqual(receipts, ['原快照虚构用户']);
  await button('取消重新运行').click();
  assert.equal(await previewForm().count(), 0);
  assert.equal(await count(), 1);
  note('preview-and-cancel-create-no-run-or-local-receipt');

  await preview();
  await page.getByLabel(reviewLabel, { exact: true }).check();
  await page.getByLabel('逐步调试新运行', { exact: true }).check();
  assert.equal(await previewForm().count(), 0);
  await page.getByLabel('逐步调试新运行', { exact: true }).uncheck();
  await preview();
  await page.getByLabel('重新运行使用的内容', { exact: true }).selectOption('saved');
  assert.equal(await previewForm().count(), 0);
  await page.getByLabel('重新运行使用的内容', { exact: true }).selectOption('snapshot');
  await preview();
  const snapshotRun = await confirm();
  await state(snapshotRun, 'WAITING_INPUT');
  assert.deepEqual(await formValues(), {
    name: '原快照虚构用户',
    radio: true,
    department: 'engineering',
    width: 1920,
  });
  await wait(async () => (await button('继续').count()) === 1, '原快照人工核对详情');
  await button('继续').click();
  const snapshotDetail = await state(snapshotRun, 'FAILED');
  assert.equal(snapshotDetail.run.rerun.runId, original.id);
  assert.equal(snapshotDetail.run.rerun.mode, 'snapshot');
  assert.equal(snapshotDetail.run.source, 'manual');
  assert.deepEqual(receipts, ['原快照虚构用户', '原快照虚构用户']);
  const preserved = await call('run.detail', { id: original.id });
  for (const key of ['run', 'events', 'snapshot', 'output', 'artifacts'])
    assert.deepEqual(preserved[key], originalDetail[key]);
  note('snapshot-rerun-retains-old-values-and-failure-without-changing-original-run');

  await openRun(original.id);
  await page.getByLabel('重新运行使用的内容', { exact: true }).selectOption('saved');
  await page.getByLabel('逐步调试新运行', { exact: true }).check();
  await preview();
  const savedRun = await confirm();
  await state(savedRun, 'PAUSED');
  await wait(async () => (await button('执行下一步').count()) === 1, '重跑调试详情');
  assert.equal(receipts.length, 2);
  await button('执行下一步').click();
  await wait(
    async () =>
      (await call('run.detail', { id: savedRun.id })).events.some(
        (e: any) => e.type === 'node-end' && e.nodeInstance === 'open',
      ),
    '首步打开',
  );
  await wait(
    async () => (await call('run.detail', { id: savedRun.id })).run.state === 'PAUSED',
    '再次调试暂停',
  );
  await button('继续').click();
  const savedDetail = await state(savedRun, 'SUCCEEDED');
  assert.equal(savedDetail.run.rerun.mode, 'saved');
  assert.notEqual(savedDetail.run.versionId, original.versionId);
  assert.deepEqual(receipts, ['原快照虚构用户', '原快照虚构用户', '已保存虚构用户']);
  assert.deepEqual(await formValues(), {
    name: '已保存虚构用户',
    radio: true,
    department: 'engineering',
    width: 1920,
  });
  await button('查看来源运行 ' + original.id).click();
  await button('查看派生运行 ' + savedRun.id).waitFor();
  await button('查看派生运行 ' + savedRun.id).click();
  await button('查看来源运行 ' + original.id).waitFor();
  note('saved-rerun-debug-starts-at-first-step-and-source-child-links-navigate');

  await installReplyHook();
  await openRun(original.id);
  await hold('run.rerun.preview', original.id);
  await button('预览重新运行').click();
  await pending();
  await page.getByLabel('重新运行使用的内容', { exact: true }).selectOption('saved');
  await release();
  assert.equal(await previewForm().count(), 0);
  assert.equal(await page.getByLabel('重新运行使用的内容', { exact: true }).inputValue(), 'saved');
  await hold('run.rerun.preview', original.id);
  await button('预览重新运行').click();
  await pending();
  await button('我的流程').click();
  await release();
  assert.equal(await previewForm().count(), 0);
  assert.equal(await button('全部记录').count(), 0);
  assert.equal(await count(), 3);
  note('late-preview-cannot-restore-old-mode-or-reopen-left-detail');

  await openRun(original.id);
  await page.getByLabel('重新运行使用的内容', { exact: true }).selectOption('saved');
  await preview();
  await hold('run.rerun.confirm', original.id, true);
  const lostRun = await confirm();
  await button('重试此次确认').waitFor();
  await state(lostRun, 'SUCCEEDED');
  assert.equal(receipts.length, 4);
  await call('flow.save', {
    flow: { ...savedFlow, parameters: { name: '确认之后保存的虚构用户' } },
    bindings,
  });
  await button('重试此次确认').click();
  await button('查看来源运行 ' + original.id).waitFor();
  assert.equal(await count(), 4);
  assert.equal(receipts.length, 4);
  assert.equal(receipts[3], '已保存虚构用户');
  note('lost-confirmation-retry-returns-one-run-even-after-current-draft-changes');

  await openRun(original.id);
  await page.getByLabel('重新运行使用的内容', { exact: true }).selectOption('saved');
  await preview();
  await hold('run.rerun.confirm', original.id);
  await page.getByLabel(reviewLabel, { exact: true }).check();
  const before = new Set((await runs()).map((run) => run.id));
  await button('确认从头运行').dblclick();
  await pending();
  assert.equal(await button('确认从头运行').isDisabled(), true);
  await button('我的流程').click();
  await release();
  const leftRun = await latestAfter(before);
  await state(leftRun, 'SUCCEEDED');
  assert.equal(await button('全部记录').count(), 0);
  assert.equal(await count(), 5);
  assert.equal(receipts.length, 5);
  assert.equal(receipts[4], '确认之后保存的虚构用户');
  note('leaving-during-confirmation-does-not-reopen-detail-or-cancel-created-run');

  await openRun(original.id);
  await hold('run.detail', savedRun.id);
  await button('查看派生运行 ' + savedRun.id).click();
  await pending();
  await button('全部记录').click();
  await release();
  assert.equal(await button('全部记录').count(), 0);
  assert.equal(await page.getByLabel('搜索运行记录', { exact: true }).inputValue(), original.id);
  note('late-related-run-navigation-preserves-history-search');

  await openRun(original.id);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 700));
  await preview();
  await previewForm().scrollIntoViewIfNeeded();
  assert.ok(
    await page.evaluate(() =>
      ['main', '.run-detail', '[aria-label="人工核对后重新运行"]'].every((selector) => {
        const element = document.querySelector(selector);
        return !element || element.scrollWidth <= element.clientWidth + 1;
      }),
    ),
  );
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/run-rerun.png' });
  await button('取消重新运行').click();
  assert.equal(lab.state.attempts, 0);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.waitForFunction(() => Boolean((window as any).flowark));
  await openRun(original.id);
  for (const id of [snapshotRun.id, savedRun.id, lostRun.id, leftRun.id])
    await button('查看派生运行 ' + id).waitFor();
  assert.equal(await count(), 5);
  assert.equal(receipts.length, 5);
  evidence.originalRunId = original.id;
  evidence.receipts = receipts;
  note('reopen-retains-all-relations-and-runs-with-no-replay');
  evidence.passed = true;
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/run-rerun.json', JSON.stringify(evidence, null, 2));
  await app.close();
  await lab.close();
  receiver.closeAllConnections();
  await new Promise<void>((resolve) => receiver.close(() => resolve()));
  console.log(JSON.stringify(evidence));
}
