import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import electronPath from 'electron';
import type { Run, Step } from '../src/shared/types';
import { startFormLab } from './fixtures/platform-page';
import { formBrowser } from './fixtures/platform-flow';

// Real Host, Worker, script supervision, persistence and embedded localhost form.
// Only the separately labelled storage-fault presentation case replaces replies;
// it does not claim to reproduce SQLITE_FULL or a physical disk failure.
const data = await mkdtemp('/private/tmp/flowark-observation-ui-');
const lab = await startFormLab();
const requests: string[] = [];
const gates = new Map<string, ServerResponse>();
const receiver = createServer((request, response) => {
  const path = request.url ?? '/';
  requests.push(path);
  if (path !== '/unreported' && path !== '/progress') {
    response.writeHead(404).end();
    return;
  }
  if (gates.has(path)) {
    response.writeHead(409).end('duplicate gate request');
    return;
  }
  gates.set(path, response);
});
await new Promise<void>((done) => receiver.listen(0, '127.0.0.1', done));
const gateUrl = `http://127.0.0.1:${(receiver.address() as { port: number }).port}`;
let app: ElectronApplication | undefined;
let page!: Page;
const evidence: any = {
  passed: false,
  data,
  executable: process.env.FLOWARK_TEST_EXECUTABLE ?? null,
  checks: [],
  runs: [],
  snapshots: [],
  exits: [],
};
const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const wait = async (check: () => Promise<boolean>, label: string, timeout = 25000) => {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error('运行观察等待超时：' + label);
    await delay(50);
  }
};
const call = (method: string, args: any = {}): Promise<any> =>
  page.evaluate(({ method, args }) => (window as any).flowark.request(method, args), {
    method,
    args,
  });
const button = (name: string) => page.getByRole('button', { name, exact: true });
const overview = () => page.getByRole('region', { name: '运行概览', exact: true });
const output = () => page.getByRole('region', { name: '运行输出', exact: true });
const currentStep = () => page.getByTestId('run-current-step');
const elapsed = () => page.getByTestId('run-elapsed');
const progress = () => page.getByTestId('run-progress');
const note = (check: string) => {
  evidence.checks.push(check);
  console.log(check);
};
const launch = async () => {
  app = await electron.launch({
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
  page = await app.firstWindow();
  await page.waitForFunction(() => !!(window as any).flowark);
  const boot = await call('bootstrap');
  assert.ok(!boot.fault, boot.fault);
  assert.ok(boot.execution, 'new Host must expose actual execution observation');
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
};
const openRun = async (id: string) => {
  await button('运行记录').click();
  if (await button('全部记录').count()) await button('全部记录').click();
  await page.getByLabel('搜索运行记录', { exact: true }).fill(id);
  await button('查询').click();
  const row = page
    .locator('.run-history tbody tr')
    .filter({ has: page.locator(`small[title="${id}"]`) });
  await row.getByRole('button', { name: '查看', exact: true }).click();
  await overview().waitFor();
  await wait(
    async () => (await page.locator('.run-meta').innerText()).includes(id.slice(0, 8)),
    'selected Run detail',
  );
};
const create = async (name: string, steps: Step[], browser = false) => {
  const record = await call('flow.create');
  await call('flow.save', {
    flow: { ...record.flow, name, steps },
    bindings: { files: {}, credentials: [], ...(browser ? { browserId: 'embedded' } : {}) },
  });
  return record.id as string;
};
const run = async (id: string, debug = false): Promise<Run> => {
  const result = await call('flow.run', { id, debug });
  evidence.runs.push(result.id);
  return result;
};
const state = async (id: string, expected: string) => {
  let detail: any;
  await wait(
    async () => {
      detail = await call('run.detail', { id });
      if (
        detail.run.state !== expected &&
        ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(detail.run.state)
      )
        throw new Error('非预期终态：' + JSON.stringify(detail.run));
      return detail.run.state === expected;
    },
    id + ' -> ' + expected,
  );
  return detail;
};
const duration = async () => {
  const value = await elapsed().getAttribute('data-duration-ms');
  assert.ok(value !== null && value !== '', 'elapsed must expose an observed duration');
  const milliseconds = Number(value);
  assert.ok(Number.isFinite(milliseconds) && milliseconds >= 0, value);
  return milliseconds;
};
const increasing = async (label: string) => {
  await wait(async () => (await elapsed().getAttribute('data-elapsed-kind')) === 'live', label);
  const before = await duration();
  await wait(async () => (await duration()) >= before + 1000, label + ' increments');
  evidence.snapshots.push({
    label,
    before,
    after: await duration(),
    text: await elapsed().innerText(),
  });
};
const fixed = async (label: string) => {
  await wait(async () => (await elapsed().getAttribute('data-elapsed-kind')) === 'final', label);
  const before = await duration();
  await delay(1250);
  assert.equal(
    await duration(),
    before,
    label + ' must not continue counting after terminal state',
  );
  evidence.snapshots.push({ label, duration: before, text: await elapsed().innerText() });
  return before;
};
const gracefulQuit = async () => {
  const current = app!;
  const child = current.process();
  const ended = new Promise<{ code: number | null; signal: string | null }>((done) =>
    child.once('exit', (code, signal) => done({ code, signal })),
  );
  const timeout = setTimeout(() => child.kill('SIGKILL'), 25000);
  try {
    await current.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()?.items[0].submenu?.items.find(
        (item) => item.label === '退出 FlowArk',
      );
      if (!item) throw new Error('退出菜单缺失');
      item.click();
    });
    const result = await ended;
    app = undefined;
    evidence.exits.push(result);
    assert.deepEqual(result, { code: 0, signal: null }, 'test-forced exit is not a passing quit');
  } finally {
    clearTimeout(timeout);
  }
};
const release = (path: string) => {
  const response = gates.get(path);
  assert.ok(response, path + ' must be requested by the actual script');
  response.writeHead(200, { 'Content-Type': 'text/plain' }).end('continue');
};
const nativeForm = () =>
  app!.evaluate(async ({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0].contentView
      .children[0] as Electron.WebContentsView;
    return view.webContents.executeJavaScript(`({width:innerWidth,
      name:document.querySelector('#full-name').value,
      radio:document.querySelector('#channel-email').checked,
      select:document.querySelector('#department').value})`);
  });

try {
  await launch();
  await call('browser.embedded.enable');
  await button('打开网页面板').click();
  const scriptName = '等待本地虚构核对回执';
  const expected = {
    flag: false,
    count: 0,
    empty: '',
    nil: null,
    object: {},
    items: Array.from({ length: 12 }, (_, index) => `虚构输出 ${index} ` + 'x'.repeat(1000)),
    marker: '虚构输出末尾标记 observation-complete',
  };
  const flowId = await create(
    '运行观察：普通执行与已保存输出',
    [
      formBrowser('open', 'navigate', '', lab.url),
      formBrowser('name', 'fill', '#full-name', '虚构观察用户'),
      formBrowser('radio', 'check', '#channel-email', true),
      formBrowser('select', 'select', '#department', 'engineering'),
      {
        id: 'inspect',
        name: scriptName,
        type: 'script',
        version: 1,
        language: 'js',
        dependencies: [],
        timeoutMs: 60000,
        input: { gateUrl, expected },
        code: `export default async ({input,progress}) => {
        await fetch(input.gateUrl + '/unreported');
        progress(2,5);
        await fetch(input.gateUrl + '/progress');
        return input.expected;
      };`,
      },
      { id: 'false_value', name: '保留 false', type: 'value', version: 1, value: false },
      { id: 'zero_value', name: '保留零', type: 'value', version: 1, value: 0 },
      { id: 'null_value', name: '保留 null', type: 'value', version: 1, value: null },
      { id: 'empty_value', name: '保留空字符串', type: 'value', version: 1, value: '' },
    ],
    true,
  );
  const ordinary = await run(flowId);
  await wait(async () => gates.has('/unreported'), 'real unreported script gate');
  await openRun(ordinary.id);
  await wait(
    async () => (await currentStep().innerText()).includes(scriptName),
    'snapshot step name',
  );
  assert.equal(await overview().locator('code').innerText(), 'inspect');
  const beforeProgress = await call('run.detail', { id: ordinary.id });
  assert.equal(beforeProgress.execution.active.runId, ordinary.id);
  assert.equal(
    beforeProgress.events.some((event: any) => event.type === 'progress'),
    false,
  );
  assert.match(await progress().innerText(), /未报告/);
  await increasing('script-without-progress');
  assert.deepEqual(await nativeForm(), {
    width: 1920,
    name: '虚构观察用户',
    radio: true,
    select: 'engineering',
  });
  // A later draft name must not replace the immutable execution snapshot name.
  const saved = (await call('bootstrap')).flows.find((item: any) => item.id === flowId);
  await call('flow.save', {
    flow: {
      ...saved.flow,
      steps: saved.flow.steps.map((step: any) =>
        step.id === 'inspect' ? { ...step, name: '后来修改的草稿名称' } : step,
      ),
    },
    bindings: saved.bindings,
  });
  await delay(2250); // Allow the real bootstrap/detail polling to observe the changed draft.
  assert.match(await currentStep().innerText(), new RegExp(scriptName));
  assert.ok(!(await currentStep().innerText()).includes('后来修改'));
  release('/unreported');
  await wait(async () => gates.has('/progress'), 'real reported script gate');
  await wait(async () => /2\s*\/\s*5/.test(await progress().innerText()), 'reported 2 / 5');
  const reported = await call('run.detail', { id: ordinary.id });
  assert.ok(
    reported.events.some(
      (event: any) =>
        event.type === 'progress' &&
        event.nodeInstance === 'inspect' &&
        event.data.completed === 2 &&
        event.data.total === 5,
    ),
  );
  note('actual-script-snapshot-name-live-duration-and-node-scoped-progress-with-1920-form');
  release('/progress');
  const completed = await state(ordinary.id, 'SUCCEEDED');
  assert.deepEqual(completed.output.inspect, expected);
  for (const [key, value] of Object.entries({
    false_value: false,
    zero_value: 0,
    null_value: null,
    empty_value: '',
  }))
    assert.deepEqual(completed.output[key], value);
  const finalDuration = await fixed('ordinary-terminal');
  await output().waitFor();
  await output().getByRole('button', { name: '展开完整输出', exact: true }).waitFor();
  const previewText = await output().locator('pre').innerText();
  assert.ok(previewText.length < JSON.stringify(completed.output, null, 2).length);
  assert.ok(!previewText.includes(expected.marker));
  const runCount = (await call('bootstrap')).runOverview.total;
  const gateCount = requests.length;
  await output().getByRole('button', { name: '展开完整输出', exact: true }).click();
  assert.deepEqual(JSON.parse(await output().locator('pre').innerText()), completed.output);
  assert.ok((await output().locator('pre').innerText()).includes(expected.marker));
  await output().getByRole('button', { name: '收起输出', exact: true }).click();
  assert.equal(await output().locator('pre').innerText(), previewText);
  assert.equal((await call('bootstrap')).runOverview.total, runCount);
  assert.equal(requests.length, gateCount, 'expanding output never re-executes the script');
  note('ordinary-persisted-falsy-and-large-output-expansion-is-read-only-and-duration-freezes');

  const debugId = await create('运行观察：暂停与人工等待', [
    { id: 'before_wait', name: '暂停前虚构核对', type: 'value', version: 1, value: 0 },
    {
      id: 'human_review',
      name: '等待人工核对虚构资料',
      type: 'human',
      version: 1,
      message: '仅测试等待与取消',
    },
    { id: 'after_wait', name: '取消后不得执行', type: 'value', version: 1, value: 'unexpected' },
  ]);
  const debug = await run(debugId, true);
  await state(debug.id, 'PAUSED');
  await openRun(debug.id);
  await wait(
    async () => (await currentStep().innerText()).includes('暂停前虚构核对'),
    'next debug position',
  );
  await increasing('debug-paused-total-duration');
  await button('执行下一步').click();
  await wait(
    async () => (await currentStep().innerText()).includes('等待人工核对虚构资料'),
    'next human position',
  );
  await state(debug.id, 'PAUSED');
  await button('继续').click();
  await state(debug.id, 'WAITING_INPUT');
  await wait(
    async () => (await overview().locator('code').innerText()) === 'human_review',
    'actual human instance',
  );
  await increasing('human-wait-total-duration');
  assert.match(await progress().innerText(), /未报告/);
  await button('取消').click();
  const cancelled = await state(debug.id, 'CANCELLED');
  assert.ok(!cancelled.events.some((event: any) => event.nodeInstance === 'after_wait'));
  await fixed('cancelled-terminal');
  assert.equal(lab.state.attempts, 0);
  note('real-debug-next-step-human-wait-cancel-and-final-duration');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: join(data, 'cancelled.png') });
  await gracefulQuit();
  await launch();
  const reopened = await call('bootstrap');
  assert.equal(reopened.runOverview.total, runCount + 1);
  assert.equal(reopened.execution.active, null);
  assert.equal(requests.length, gateCount);
  await openRun(ordinary.id);
  assert.equal(await fixed('reopened-terminal'), finalDuration);
  await output().getByRole('button', { name: '展开完整输出', exact: true }).click();
  assert.deepEqual(JSON.parse(await output().locator('pre').innerText()), completed.output);
  await openRun(debug.id);
  assert.equal((await call('run.detail', { id: debug.id })).run.state, 'CANCELLED');
  assert.equal(await button('执行下一步').count(), 0);
  note('normal-reopen-preserves-output-and-terminal-time-without-replay');

  // Presentation-only fixture: the real saved successful Run remains untouched.
  // Replace its detail/bootstrap replies with a last-saved RUNNING observation.
  await app!.evaluate(({ ipcMain }, id) => {
    const handlers = (ipcMain as any)._invokeHandlers as Map<
      string,
      (...args: any[]) => Promise<any>
    >;
    const original = handlers.get('flowark:request')!;
    (globalThis as any).observationOriginal = original;
    (globalThis as any).observationFault = { active: false, state: 'RUNNING' };
    handlers.set('flowark:request', async (...args: any[]) => {
      const result = await Reflect.apply(original, undefined, args);
      if (args[1] !== 'bootstrap' && !(args[1] === 'run.detail' && args[2]?.id === id))
        return result;
      const next = structuredClone(result);
      const fixture = (globalThis as any).observationFault;
      next.fault = 'fixture: SQLITE_FULL presentation only';
      next.execution = {
        observedAt: new Date().toISOString(),
        active: fixture.active ? { runId: id, phase: 'executing' } : null,
      };
      if (args[1] === 'run.detail') {
        next.run.state = fixture.state;
        next.events = next.events.filter(
          (event: any) =>
            event.type !== 'state' ||
            !['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(event.data.state),
        );
        delete next.output;
      } else
        next.runs = next.runs.map((run: any) =>
          run.id === id ? { ...run, state: fixture.state } : run,
        );
      return next;
    });
  }, ordinary.id);
  await openRun(ordinary.id);
  await wait(
    async () => (await page.locator('main').innerText()).includes('最后成功保存'),
    'persistent storage-fault notice',
  );
  await page.getByText('运行状态未能完整保存', { exact: true }).waitFor();
  assert.match(await overview().innerText(), /最后保存|待核对/);
  assert.notEqual(await elapsed().getAttribute('data-elapsed-kind'), 'live');
  for (const label of ['步骤后暂停', '执行下一步', '继续', '取消'])
    assert.equal(
      await button(label).count(),
      0,
      'inactive last-saved Run must not expose ' + label,
    );
  assert.ok(!(await overview().innerText()).includes('所有进程已停止'));
  await page.screenshot({ path: join(data, 'fault-presentation.png') });
  await button('我的流程').click();
  await wait(
    async () => (await page.locator('.overview').innerText()).includes('已停止接收新任务'),
    'fault must not advertise an available execution slot',
  );
  assert.ok(!(await page.locator('.overview').innerText()).includes('可以开始新任务'));
  for (const fixtureState of ['RUNNING', 'PAUSED']) {
    await app!.evaluate((_electron, state) => {
      (globalThis as any).observationFault = { active: true, state };
    }, fixtureState);
    await openRun(ordinary.id);
    await wait(
      async () => (await button('取消').count()) === 1,
      'active fault retains cancellation',
    );
    for (const label of ['步骤后暂停', '执行下一步', '继续'])
      assert.equal(await button(label).count(), 0, 'fault must not expose ' + label);
    assert.match(await overview().innerText(), /最后成功保存/);
  }
  // Do not click the synthetic active control: no real Run was made active here.
  evidence.faultBoundary =
    'Main reply transformation only; actual SQLITE_FULL is verified separately';
  await app!.evaluate(({ ipcMain }) => {
    (ipcMain as any)._invokeHandlers.set(
      'flowark:request',
      (globalThis as any).observationOriginal,
    );
  });
  assert.equal((await call('run.detail', { id: ordinary.id })).run.state, 'SUCCEEDED');
  assert.deepEqual((await call('run.detail', { id: ordinary.id })).output, completed.output);
  await openRun(ordinary.id);
  await wait(
    async () => !(await page.locator('main').innerText()).includes('最后成功保存'),
    'restored genuine observations',
  );
  assert.equal(await button('取消').count(), 0);
  note(
    'reply-only-fault-fixture-protects-inactive-and-active-controls-without-changing-saved-history',
  );
  await gracefulQuit();
  evidence.passed = true;
} catch (error) {
  evidence.error = error instanceof Error ? error.stack : String(error);
  if (app && page) {
    evidence.failure = {
      browser: await call('browser.embedded.status').catch((error) => ({ error: String(error) })),
      overview: await overview()
        .innerText()
        .catch(() => null),
      main: await page
        .locator('main')
        .innerText()
        .catch(() => null),
    };
    await page.screenshot({ path: join(data, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  for (const response of gates.values())
    if (!response.writableEnded) response.end('fixture cleanup');
  if (app) await app.close().catch((error) => (evidence.cleanupError = String(error)));
  await lab.close();
  receiver.closeAllConnections();
  await new Promise<void>((done) => receiver.close(() => done()));
  evidence.requests = requests;
  await mkdir('test-results', { recursive: true });
  await writeFile(join(data, 'evidence.json'), JSON.stringify(evidence, null, 2));
  await writeFile('test-results/run-observation.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
