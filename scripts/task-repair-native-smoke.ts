import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { desktopElectron as electron } from './desktop-session.mjs';
import { type ElectronApplication, type Page } from 'playwright-core';
import electronPath from 'electron';
import type { Flow, Run } from '../src/shared/types';
import type { PlanningInput, PlanningResult, TaskDetail } from '../src/shared/planning';
import type { RepairInput, RepairPreview } from '../src/shared/task-repair';

// Real Renderer IPC, Main picker, encrypted Host, provider adapter and Worker.
// Only the provider HTTP endpoint is redirected inside an ignored private build.
// This is not evidence of a real DeepSeek/OpenAI connection.
const data = await mkdtemp('/private/tmp/flowark-repair-native-');
await mkdir('test-results/figma', { recursive: true });
const appPath = await mkdtemp(resolve('test-results/repair-native-app-'));
const output = join(data, 'output');
await mkdir(output);
const requests: PlanningInput[] = [];
const server = createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(
      '<title>修复验证</title><h1 id="new-title">虚构新标题</h1><button onclick="window.clicked=(window.clicked||0)+1">不可误点</button>',
    );
    return;
  }
  try {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const input: PlanningInput = JSON.parse(JSON.parse(raw).messages[1].content).request;
    requests.push(input);
    const repair = JSON.parse(input.context[0]!.text);
    const flow = structuredClone(input.baseFlow!);
    const node = flow.steps.find((n) => n.id === repair.source.nodeId)!;
    Object.assign(node, { selector: repair.target.selector, framePath: repair.target.framePath });
    const result: PlanningResult = {
      formatVersion: '1.0',
      kind: 'plan',
      summary: '修复已选标题目标',
      flow,
      questions: [],
      limitations: [],
    };
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        id: 'fixture-response',
        model: 'fixture-model',
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify({ resultJson: JSON.stringify(result) }) },
          },
        ],
      }),
    );
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e));
  }
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(server.address() as any).port}/`;
await cp('dist', join(appPath, 'dist'), { recursive: true });
await cp('contracts', join(appPath, 'contracts'), { recursive: true });
await writeFile(
  join(appPath, 'package.json'),
  JSON.stringify({ name: 'repair-native-fixture', version: '0.3.0', main: 'dist/main.cjs' }),
);
await build({
  entryPoints: ['src/host/entry.ts'],
  outfile: join(appPath, 'dist/host.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  packages: 'external',
  banner: {
    js: `const fixtureFetch=globalThis.fetch;globalThis.fetch=(url,init)=>{if(String(url)!=='https://api.deepseek.com/chat/completions')throw new Error('Unexpected fixture network');return fixtureFetch(${JSON.stringify(url)},init)};`,
  },
});
const evidence: any = {
  passed: false,
  closed: false,
  data,
  appPath,
  checks: [],
  layouts: [],
  provider: 'local HTTP fixture',
};
let app: ElectronApplication | undefined, page: Page | undefined, failure: unknown;
const call = (method: string, args: any = {}): Promise<any> =>
  page!.evaluate(({ method, args }) => window.flowark.request(method, args), { method, args });
const wait = async (condition: () => Promise<boolean>, reason: string) => {
  const end = Date.now() + 20000;
  while (!(await condition())) {
    if (Date.now() > end) throw new Error(reason);
    await new Promise((r) => setTimeout(r, 80));
  }
};
const site = (expression: string) =>
  app!.evaluate(async ({ BrowserWindow }, expression) => {
    const view = BrowserWindow.getAllWindows()[0].contentView.children[0] as any;
    return view.webContents.executeJavaScript(expression);
  }, expression);
const nativeClick = async () => {
  await app!.evaluate(async ({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0].contentView.children[0] as any;
    const wc = view.webContents;
    const point = await wc.executeJavaScript(
      `(()=>{const r=document.querySelector('#new-title').getBoundingClientRect();return {x:Math.round(r.x+30),y:Math.round(r.y+r.height/2)}})()`,
    );
    const scale = view.getBounds().width / 1920;
    point.x = Math.round(point.x * scale);
    point.y = Math.round(point.y * scale);
    wc.sendInputEvent({ type: 'mouseMove', ...point });
    wc.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
  });
};
const pick = async () => {
  const requestId = randomUUID();
  await call('browser.embedded.pick.start', { requestId });
  await nativeClick();
  await wait(
    async () => (await call('browser.embedded.pick.status', { requestId })).phase === 'selected',
    'native pick did not select',
  );
  return requestId;
};
const repairPage = () => page!.locator('.task-repair-page:not([hidden])');
const checkPage = () => page!.locator('.run-review-page:not([hidden])');
const fixtureMode = (mode: string) =>
  app!.evaluate((_, mode) => {
    (globalThis as any).repairFixture.mode = mode;
  }, mode);
const pickInUI = async () => {
  await app!.evaluate(() => {
    (globalThis as any).repairFixture.pickId = '';
  });
  await repairPage().getByRole('button', { name: '从网页选取', exact: true }).click();
  await wait(
    async () => app!.evaluate(() => !!(globalThis as any).repairFixture.pickId),
    'native picker did not start',
  );
  await nativeClick();
  await repairPage().getByRole('heading', { name: '已选目标', exact: true }).waitFor();
  await repairPage().getByRole('button', { name: '确认这个目标', exact: true }).click();
  await repairPage().getByRole('heading', { name: '检查修复提议' }).waitFor();
  await repairPage().getByLabel('模型', { exact: true }).fill('fixture-model');
  await repairPage().getByRole('checkbox', { name: '我已核对发送内容、供应商和模型' }).check();
  await repairPage().getByRole('button', { name: '让 AI 提议修复', exact: true }).click();
  await repairPage().getByRole('heading', { name: '只改变目标引用', exact: true }).waitFor();
};
const capture = async (kind: string) => {
  for (const [width, height] of [
    [1440, 960],
    [1920, 1080],
    [1040, 700],
  ]) {
    await app!.evaluate(
      ({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]);
      },
      [width, height],
    );
    await page!.waitForFunction((w) => window.innerWidth === w, width);
    await page!.evaluate(() => document.querySelector('main')?.scrollTo(0, 0));
    const layout = await repairPage().evaluate((root) => ({
      overflow: root.scrollWidth > root.clientWidth + 1,
      rootOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      columns: [...root.querySelectorAll('.task-run-columns > section')].map((n) => {
        const r = n.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    }));
    assert.equal(layout.overflow, false, `${kind} ${width}`);
    assert.equal(layout.rootOverflow, false, `${kind} root ${width}`);
    evidence.layouts.push({ kind, width, height, ...layout });
    await page!.screenshot({ path: `test-results/figma/task-${kind}-${width}.png`, scale: 'css' });
  }
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
};
try {
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [appPath],
    env: { ...process.env, FLOWARK_DATA_DIR: data },
  });
  page = await app.firstWindow();
  await page.getByRole('heading', { name: '你想完成什么？' }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setTitle('FlowArk · 目标修复隔离测试（自动退出）'),
  );
  await page.evaluate(() => {
    document.querySelector('.window-titlebar')!.textContent =
      'FlowArk · 目标修复隔离测试（自动退出）';
  });
  await call('browser.embedded.enable');
  await call('ai.configuration.save', {
    provider: 'deepseek',
    revision: null,
    model: 'deepseek-flash',
    apiKey: 'sk-repair-native-fixture',
  });
  const created = (await call('task.create')).task;
  const task = (
    await call('task.save', {
      id: created.id,
      revision: created.revision,
      description: '读取选定标题并保存',
      context: [],
      answers: {},
    })
  ).task;
  const flow: Flow = {
    id: task.flowId,
    name: '虚构原生目标修复',
    description: '',
    formatVersion: '1.0',
    parameters: {},
    requiredCapabilities: ['browser', 'file'],
    steps: [
      {
        id: 'open',
        type: 'browser',
        version: 2,
        operation: 'navigate',
        selector: '',
        framePath: [],
        value: url,
      },
      {
        id: 'title',
        type: 'browser',
        version: 2,
        operation: 'read',
        name: '读取标题',
        selector: '#missing-old-title',
        framePath: [],
        value: null,
        timeoutMs: 3000,
      },
      {
        id: 'save',
        type: 'file',
        version: 1,
        operation: 'write',
        binding: 'work',
        name: 'title.txt',
        content: { $ref: 'steps.title' },
      },
    ],
  };
  await call('flow.save', {
    flow,
    bindings: { browserId: 'embedded', files: { work: output }, credentials: [] },
  });
  await page.locator('.sidebar').getByRole('button', { name: '我的流程', exact: true }).click();
  await page.locator('.sidebar').getByRole('button', { name: '开始任务', exact: true }).click();
  await page.locator('.ai-task-recents button').filter({ hasText: task.description }).click();
  await page.getByRole('button', { name: '确认方案，去试运行', exact: true }).click();
  await checkPage().getByRole('heading', { name: '检查通过', exact: true }).waitFor();
  await checkPage().getByRole('checkbox', { name: '我已核对操作对象、可能更改和保存位置' }).check();
  await checkPage().getByRole('button', { name: '开始试运行', exact: true }).click();
  const runPage = page.locator('.task-run-page');
  await runPage.waitFor();
  const run: Run = (
    await call('run.detail', { id: await runPage.getAttribute('data-task-run-id') })
  ).run;
  await wait(
    async () =>
      (await call('run.detail', { id: run.id })).run.state === 'FAILED' &&
      !(await call('bootstrap')).execution?.active,
    'original failure not settled',
  );
  const original = await call('run.detail', { id: run.id });
  await page.getByRole('button', { name: '打开网页面板', exact: true }).click();
  await call('browser.embedded.navigate', { url });
  const args: RepairInput = {
    id: task.id,
    revision: task.revision,
    runId: run.id,
    nodeId: 'title',
    pickRequestId: await pick(),
  };
  const preview = (): Promise<RepairPreview> => call('task.repair.preview', args);
  const generate = (p: RepairPreview) =>
    call('task.repair.generate', {
      ...args,
      token: p.token,
      provider: 'deepseek',
      model: 'fixture-model',
      reviewed: true,
    });
  const first = await preview();
  assert.equal(first.selection.target.selector, '#new-title');
  assert.equal(await site('window.clicked||0'), 0);
  assert.equal(requests.length, 0);
  await site(
    `document.querySelector('#new-title').insertAdjacentHTML('afterend','<h1 id="new-title">duplicate</h1>')`,
  );
  await assert.rejects(generate(first), /唯一|匹配/);
  await site(`document.querySelectorAll('#new-title')[1].remove()`);
  await assert.rejects(generate(first), /变化|选取/);
  args.pickRequestId = await pick();
  const fresh = await preview();
  await call('browser.embedded.navigate', { url });
  await assert.rejects(generate(fresh), /变化|选取/);
  assert.equal(requests.length, 0);
  args.pickRequestId = await pick();
  const hidden = await preview();
  await call('browser.embedded.visibility', { visible: false });
  assert.equal((await preview()).token, hidden.token);
  assert.equal(requests.length, 0);
  await call('browser.embedded.pick.cancel', { requestId: args.pickRequestId });
  await assert.rejects(generate(hidden), /展开|选取|目标/);
  await call('browser.embedded.visibility', { visible: true });
  args.pickRequestId = await pick();
  const ready = await preview();
  await generate(ready);
  await wait(
    async () => (await call('task.detail', { id: task.id })).task.status !== 'generating',
    'repair generation did not finish',
  );
  let detail: TaskDetail = await call('task.detail', { id: task.id });
  assert.equal(detail.task.status, 'plan', detail.task.error);
  assert.equal(detail.changes.length, 1);
  assert.equal(requests.length, 1);
  assert.equal((await call('bootstrap')).runs.length, 1);
  // Re-selecting even the same element replaces the native request and invalidates adoption.
  await pick();
  await assert.rejects(
    call('task.adopt', { id: task.id, revision: task.revision, proposalId: detail.proposal!.id }),
    /选取|目标/,
  );
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as any)._invokeHandlers as Map<
      string,
      (...args: any[]) => Promise<any>
    >;
    const original = handlers.get('flowark:request')!;
    const state: any = { original, mode: '', pickId: '', confirmations: [] };
    (globalThis as any).repairFixture = state;
    handlers.set('flowark:request', async (...args: any[]) => {
      const method = args[1];
      if (method === 'flow.run.confirm') state.confirmations.push(structuredClone(args[2]));
      const result = await original(...args);
      if (method === 'browser.embedded.pick.start' && result.phase === 'picking')
        state.pickId = args[2].requestId;
      if (
        (state.mode === 'lose-adopt' && method === 'task.adopt') ||
        (state.mode === 'lose-confirm' && method === 'flow.run.confirm')
      ) {
        state.mode = '';
        throw new Error('fixture: reply lost after commit');
      }
      return result;
    });
  });
  await page.getByRole('button', { name: '重新选择网页目标', exact: true }).click();
  await repairPage().getByRole('heading', { name: '重新选择要修复的网页目标' }).waitFor();
  await pickInUI();
  detail = await call('task.detail', { id: task.id });
  assert.equal(detail.task.status, 'plan', detail.task.error);
  assert.equal(requests.length, 2);
  await capture('repair');
  await site(`document.querySelector('#new-title').setAttribute('aria-label','目标暂时变化')`);
  await repairPage().getByRole('button', { name: '采纳并检查起点', exact: true }).click();
  await repairPage().getByRole('button', { name: '取消等待并核对当前方案', exact: true }).click();
  await repairPage().getByRole('heading', { name: '重新选择要修复的网页目标' }).waitFor();
  assert.equal((await call('task.detail', { id: task.id })).task.appliedRepair, undefined);
  assert.equal((await call('bootstrap')).runs.length, 1);
  await site(`document.querySelector('#new-title').removeAttribute('aria-label')`);
  await pickInUI();
  await fixtureMode('lose-adopt');
  await repairPage().getByRole('button', { name: '采纳并检查起点', exact: true }).click();
  await repairPage().getByRole('heading', { name: '修复后怎样重新执行？' }).waitFor();
  assert.equal((await call('bootstrap')).runs.length, 1);
  const still = await call('run.detail', { id: run.id });
  assert.deepEqual(still.run, original.run);
  assert.deepEqual(still.snapshot, original.snapshot);
  assert.deepEqual(still.events, original.events);
  await capture('restart');
  const prior = () =>
    repairPage().getByRole('checkbox', {
      name: '我已核对原运行的输出与外部结果，确认可以从头执行',
    });
  assert.equal(await prior().isChecked(), false);
  assert.equal(
    await repairPage().getByRole('button', { name: '确认，重新检查', exact: true }).isDisabled(),
    true,
  );
  await prior().check();
  await repairPage().getByRole('button', { name: '确认，重新检查', exact: true }).click();
  await checkPage().getByRole('heading', { name: '检查通过', exact: true }).waitFor();
  await checkPage().getByRole('heading', { name: '关联原运行，从头执行', exact: true }).waitFor();
  await checkPage().getByRole('checkbox', { name: '我已核对操作对象、可能更改和保存位置' }).check();
  await checkPage().getByRole('button', { name: '回去修改', exact: true }).click();
  assert.equal(await prior().isChecked(), false);
  await prior().check();
  await repairPage().getByRole('button', { name: '确认，重新检查', exact: true }).click();
  await checkPage().getByRole('heading', { name: '检查通过', exact: true }).waitFor();
  const reviewed = checkPage().getByRole('checkbox', {
    name: '我已核对操作对象、可能更改和保存位置',
  });
  assert.equal(await reviewed.isChecked(), false);
  await reviewed.check();
  await fixtureMode('lose-confirm');
  await checkPage().getByRole('button', { name: '开始试运行', exact: true }).click();
  await checkPage().getByRole('heading', { name: '确认结果尚未核对', exact: true }).waitFor();
  await checkPage().getByRole('button', { name: '回去修改', exact: true }).click();
  await prior().check();
  await repairPage().getByRole('button', { name: '确认，重新检查', exact: true }).click();
  await checkPage().getByRole('button', { name: '查询本次确认结果', exact: true }).click();
  await wait(
    async () => (await runPage.getAttribute('data-task-run-id')) !== run.id,
    'new run page not opened',
  );
  const next: Run = (
    await call('run.detail', { id: await runPage.getAttribute('data-task-run-id') })
  ).run;
  await wait(
    async () =>
      (await call('run.detail', { id: next.id })).run.state === 'SUCCEEDED' &&
      !(await call('bootstrap')).execution?.active,
    'repaired run did not succeed',
  );
  assert.equal(next.rerun?.runId, run.id);
  assert.equal(next.task?.id, task.id);
  assert.ok(next.review);
  const confirmations = await app.evaluate(() => (globalThis as any).repairFixture.confirmations);
  assert.equal(confirmations.length, 2);
  assert.deepEqual(confirmations[0], confirmations[1]);
  assert.equal(await readFile(join(output, 'title.txt'), 'utf8'), '虚构新标题');
  assert.equal((await call('bootstrap')).runs.length, 2);
  evidence.checks.push(
    'real-native-selection-without-page-click',
    'duplicate-target-refresh-cancel-and-reselection-rejected-confirmed-target-survives-hide',
    'provider-adapter-target-only-proposal-and-zero-run-adoption',
    'original-run-snapshot-and-events-unchanged',
    'repair-restart-three-sizes-return-clears-both-approvals',
    'failed-adoption-cancel-and-lost-adoption-receipt-recovery',
    'full-reviewed-linked-rerun-lost-reply-same-request-and-real-file',
  );
  evidence.requestCount = requests.length;
  evidence.passed = true;
} catch (error) {
  failure = error;
} finally {
  try {
    if (app && page) {
      await app.evaluate(({ ipcMain }) => {
        const state = (globalThis as any).repairFixture;
        if (state) (ipcMain as any)._invokeHandlers.set('flowark:request', state.original);
      });
      for (const task of await call('task.list')) await call('task.cancel', { id: task.id });
      for (const run of (await call('bootstrap')).runs as Run[])
        if (['QUEUED', 'RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING'].includes(run.state))
          await call('run.control', { id: run.id, action: 'cancel' });
      await wait(
        async () => !(await call('bootstrap')).execution?.active,
        'owned run did not finish',
      );
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          app.close(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('owned close timed out')), 20000);
          }),
        ]);
        evidence.closed = true;
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (error) {
    app?.process().kill('SIGKILL');
    failure ??= error;
  }
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  if (failure) {
    evidence.passed = false;
    evidence.error = String(failure);
  }
  await writeFile(
    'test-results/figma/task-repair-native-summary.json',
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence, null, 2));
}
if (failure) throw failure;
