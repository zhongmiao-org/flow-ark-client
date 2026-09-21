import assert from 'node:assert/strict';
import { execFileSync, type ChildProcess } from 'node:child_process';
import { createServer, type ServerResponse } from 'node:http';
import { build } from 'esbuild';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { desktopElectron as electron } from './desktop-session.mjs';
import { type ElectronApplication, type Page } from 'playwright-core';
import electronPath from 'electron';
import type { PlanningInput, PlanningResult, TaskDetail } from '../src/shared/planning';

// Only HTTP is replaced in a private, ignored test build. Renderer, IPC, Vault,
// Planning, encrypted Store, schema validation and Worker execution are real.
// This must never be used as evidence of a real DeepSeek/OpenAI connection.
const evidence: any = { passed: false, checks: [], layouts: [], provider: 'local HTTP fixture' };
const data = await mkdtemp('/private/tmp/flowark-figma-task-');
await mkdir('test-results', { recursive: true });
const appPath = await mkdtemp(resolve('test-results/figma-task-app-'));
const requests: PlanningInput[] = [];
let mode: 'clarify' | 'plan' | 'hold' = 'clarify';
let value = 'first';
let held: { response: ServerResponse; input: PlanningInput } | undefined;
const result = (input: PlanningInput): PlanningResult => ({
  formatVersion: '1.0',
  kind: 'plan',
  summary: '生成示例值，并通过条件与循环核对。',
  questions: [],
  limitations: [],
  flow: {
    formatVersion: '1.0',
    id: input.flowId,
    name: 'AI 文本核对',
    description: '虚构值验证流程',
    parameters: {},
    requiredCapabilities: ['value', 'condition', 'loop'],
    steps: [
      { id: 'value', name: '生成示例值', type: 'value', version: 1, value },
      {
        id: 'choose',
        name: '核对示例值',
        type: 'condition',
        version: 1,
        actual: { $ref: 'steps.value' },
        operator: 'equals',
        expected: value,
        then: [{ id: 'yes', type: 'value', version: 1, value: '已核对' }],
        else: [{ id: 'no', type: 'value', version: 1, value: '不匹配' }],
      },
      {
        id: 'each',
        name: '逐项读取',
        type: 'loop',
        version: 1,
        items: [2, 4],
        body: [{ id: 'itemResult', type: 'value', version: 1, value: { $ref: 'item' } }],
      },
    ],
  },
});
function respond(response: ServerResponse, output: PlanningResult) {
  response.setHeader('content-type', 'application/json');
  response.end(
    JSON.stringify({
      id: 'fictional-http-response',
      model: 'fixture-model',
      choices: [
        {
          finish_reason: 'stop',
          message: { content: JSON.stringify({ resultJson: JSON.stringify(output) }) },
        },
      ],
    }),
  );
}
const server = createServer(async (request, response) => {
  try {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const input: PlanningInput = JSON.parse(body.messages[1].content).request;
    requests.push(input);
    if (mode === 'hold') {
      held = { response, input };
      return;
    }
    if (mode === 'clarify')
      respond(response, {
        formatVersion: '1.0',
        kind: 'clarify',
        flow: null,
        summary: '先确认结果要保留在哪里。',
        questions: [
          { id: 'output', prompt: '结果保存到哪里？', options: ['仅保留运行结果', '稍后选择目录'] },
        ],
        limitations: [],
      });
    else respond(response, result(input));
  } catch (error) {
    response.statusCode = 500;
    response.end(String(error));
  }
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const fixtureUrl = `http://127.0.0.1:${(server.address() as any).port}`;
await cp('dist', join(appPath, 'dist'), { recursive: true });
await cp('contracts', join(appPath, 'contracts'), { recursive: true });
await writeFile(
  join(appPath, 'package.json'),
  JSON.stringify({ name: 'flowark-task-ui-fixture', version: '0.3.0', main: 'dist/main.cjs' }),
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
    js: `const fixtureFetch = globalThis.fetch; globalThis.fetch = (url, init) => {
    if (String(url) !== 'https://api.deepseek.com/chat/completions') throw new Error('Unexpected network in task UI fixture');
    return fixtureFetch(${JSON.stringify(fixtureUrl)}, init);
  };`,
  },
});
let app: ElectronApplication | undefined;
let child: ChildProcess | undefined;
let page!: Page;
const button = (name: string) => page.getByRole('button', { name, exact: true });
const call = (method: string, args: any = {}): Promise<any> =>
  page.evaluate(({ method, args }) => window.flowark.request(method, args), { method, args });
const wait = async (check: () => Promise<boolean>, label: string) => {
  const deadline = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(label);
    await new Promise((done) => setTimeout(done, 80));
  }
};
const bounded = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('隔离测试收尾超时')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
};
const errors: string[] = [];
async function launch() {
  const active = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
    .split('\n')
    .filter((line) =>
      /^\s*\d+\s+\/.*\/(?:FlowArk|Electron)\.app\/Contents\/MacOS\/(?:FlowArk|Electron)(?:\s|$)/.test(
        line,
      ),
    );
  assert.deepEqual(active, [], 'existing GUI main process: do not launch another instance');
  assert.equal(app, undefined);
  assert.ok(
    !child || child.exitCode !== null || child.signalCode !== null,
    'previous process must exit',
  );
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [appPath],
    env: { ...process.env, FLOWARK_DATA_DIR: data },
  });
  child = app.process();
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: '你想完成什么？' }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setTitle('FlowArk · AI 任务隔离测试（自动退出）'),
  );
  await page.evaluate(() => {
    document.querySelector('.window-titlebar')!.textContent =
      'FlowArk · AI 任务隔离测试（自动退出）';
  });
  await page.evaluate(() => document.fonts.ready);
}
async function close() {
  if (!app || !child) return;
  const owned = app,
    process = child;
  try {
    await bounded(
      (async () => {
        for (const task of await call('task.list')) await call('task.cancel', { id: task.id });
        for (const run of (await call('bootstrap')).runs)
          if (['QUEUED', 'RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING'].includes(run.state))
            await call('run.control', { id: run.id, action: 'cancel' });
        await wait(async () => {
          const state = await call('bootstrap');
          return !state.execution?.active && !state.runOverview.queued;
        }, 'owned run still active');
        await owned.close();
        await wait(
          async () => process.exitCode !== null || process.signalCode !== null,
          'process did not exit',
        );
      })(),
      30000,
    );
  } finally {
    if (process.exitCode === null && process.signalCode === null) {
      process.kill('SIGKILL');
      await bounded(new Promise<void>((done) => process.once('exit', () => done())), 5000);
    }
    app = undefined;
    evidence.closed = process.exitCode !== null || process.signalCode !== null;
  }
}
async function capture(name: string) {
  await page.mouse.move(0, 0);
  await page.locator('main').evaluate((e) => e.scrollTo(0, 0));
  const layout = await page.evaluate(() => {
    const element = document.querySelector('.ai-task-page:not([hidden])')!;
    return {
      width: innerWidth,
      height: innerHeight,
      overflow: element.scrollWidth > element.clientWidth,
      rootOverflow: document.documentElement.scrollWidth > innerWidth,
      sidebar: document.querySelector('.sidebar')!.getBoundingClientRect().width,
      columns: [...element.querySelectorAll('.ai-task-columns > section')].map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    };
  });
  assert.equal(layout.overflow, false);
  assert.equal(layout.rootOverflow, false);
  evidence.layouts.push({ name, ...layout });
  await page.screenshot({ path: `test-results/figma/task-${name}.png`, scale: 'css' });
}
async function review() {
  await page.getByRole('checkbox', { name: '我已核对本次内容，将发送给 DeepSeek' }).check();
}
async function generated(id: string) {
  await wait(
    async () => (await call('task.detail', { id })).task.status === 'plan',
    'plan not generated',
  );
  await button('采纳方案').waitFor();
}
let failure: unknown;
try {
  await mkdir('test-results/figma', { recursive: true });
  await launch();
  await capture('home-1440');
  await page.getByLabel('你想完成的任务').fill('整理我提供的文本，核对并保留结果。');
  await button('开始规划').click();
  await button('附加文本资料').click();
  await page.getByLabel('资料 1 名称').fill('用户选择的虚构资料');
  await page.getByLabel('资料 1 内容').fill('这是唯一选中的文本。');
  await button('保存任务草稿').click();
  const taskId = (await call('task.list'))[0].id;
  assert.equal(
    (await call('task.detail', { id: taskId })).task.context[0].text,
    '这是唯一选中的文本。',
  );
  assert.equal((await call('bootstrap')).flows.length, 0);
  await capture('brief-1440');
  await page.locator('.task-understanding-provider > summary').click();
  await page.locator('.ai-task-provider input').fill('fixture-model');
  await button('配置 AI 服务').click();
  await button('去配置 AI 服务').click();
  await page.getByRole('heading', { name: 'DeepSeek', exact: true }).waitFor();
  assert.equal(
    await page.locator('.ai-settings-page').getByLabel('模型 ID', { exact: true }).inputValue(),
    'fixture-model',
  );
  await page.getByPlaceholder('输入 DeepSeek API Key').fill('sk-only-local-fixture');
  await button('保存配置').click();
  await wait(
    async () => (await call('bootstrap')).credentials.includes('deepseek'),
    'fixture key not saved',
  );
  await button('← 返回原任务').click();
  assert.equal(await page.locator('.ai-task-provider input').inputValue(), 'fixture-model');
  assert.equal(await page.getByLabel('资料 1 内容').inputValue(), '这是唯一选中的文本。');
  assert.equal(await button('理解我的任务').isEnabled(), false);
  await review();
  await page.getByLabel('你的需求', { exact: true }).fill('整理所选文本，并核对结果。');
  assert.equal(await button('理解我的任务').isEnabled(), false, 'changing context resets review');
  await review();
  await button('理解我的任务').click();
  await page.getByRole('heading', { name: '我理解你要……' }).waitFor();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].context[0]!.text, '这是唯一选中的文本。');
  assert.ok(!JSON.stringify(requests).includes(data));
  assert.ok(!JSON.stringify(requests).includes('sk-only-local-fixture'));
  await button('仅保留运行结果').click();
  mode = 'hold';
  await review();
  await button('确认并生成方案').click();
  await button('取消生成').waitFor();
  await wait(async () => !!held, 'request was not held');
  await button('取消生成').click();
  respond(held!.response, result(held!.input));
  held = undefined;
  await wait(
    async () => (await call('task.detail', { id: taskId })).task.status === 'cancelled',
    'cancel not persisted',
  );
  assert.equal((await call('bootstrap')).runs.length, 0);
  mode = 'plan';
  await review();
  await button('确认并生成方案').click();
  await generated(taskId);
  assert.equal(requests.at(-1)!.answers.output, '仅保留运行结果');
  const listIds = await page
    .locator('.ai-task-step')
    .evaluateAll((elements) => elements.map((e) => e.getAttribute('data-step-id')));
  assert.deepEqual(listIds, ['value', 'choose', 'yes', 'no', 'each', 'itemResult']);
  await page.locator('.ai-task-step[data-step-id="each"]').click();
  await button('流程图').click();
  await page.locator('.ai-task-graph .flow-shape[data-step-id="each"]').waitFor();
  assert.equal(
    await page.locator('.ai-task-graph .flow-shape.is-selected').getAttribute('data-step-id'),
    'each',
  );
  const graphIds = await page
    .locator('.ai-task-graph .flow-shape[data-step-id]')
    .evaluateAll((elements) => elements.map((e) => e.getAttribute('data-step-id')));
  assert.deepEqual(graphIds.sort(), [...listIds].sort());
  await button('步骤清单').click();
  assert.equal(
    await page.locator('.ai-task-step[data-step-id="each"]').getAttribute('aria-pressed'),
    'true',
  );
  for (const [width, height] of [
    [1440, 960],
    [1920, 1080],
    [1040, 700],
  ]) {
    await app!.evaluate(
      ({ BrowserWindow }, { width, height }) =>
        BrowserWindow.getAllWindows()[0].setSize(width, height),
      { width, height },
    );
    await page.waitForFunction(
      ({ width, height }) => innerWidth === width && innerHeight === height,
      { width, height },
    );
    await capture('plan-' + width);
  }
  await button('采纳方案').click();
  await button('撤销最近采纳').waitFor();
  assert.equal((await call('bootstrap')).flows.length, 1);
  await button('撤销最近采纳').click();
  await wait(
    async () => (await call('bootstrap')).flows.length === 0,
    'undo did not remove new draft',
  );
  await review();
  await button('理解我的任务').click();
  await generated(taskId);
  await button('采纳方案').click();
  await button('确认方案，去试运行').click();
  await page
    .locator('.run-review-page:not([hidden])')
    .getByRole('heading', { name: '检查通过', exact: true })
    .waitFor();
  await page
    .getByRole('checkbox', { name: '我已核对操作对象、可能更改和保存位置', exact: true })
    .check();
  await button('开始试运行').click();
  await wait(
    async () => (await call('bootstrap')).runs[0]?.state === 'SUCCEEDED',
    'real Worker did not finish',
  );
  const runId = (await call('bootstrap')).runs[0].id;
  assert.equal((await call('run.detail', { id: runId })).output.value, 'first');
  await button('← 返回 AI 任务').click();
  value = 'second';
  await page.getByLabel('你的需求', { exact: true }).fill('把示例值改成 second，保留条件和循环。');
  await review();
  await button('生成修改方案').click();
  await generated(taskId);
  const before: TaskDetail = await call('task.detail', { id: taskId });
  const editedFlow = { ...before.flow!.flow, description: '手动修改的基线' };
  await call('flow.save', { flow: editedFlow, bindings: before.flow!.bindings });
  await page.getByRole('alert').filter({ hasText: '原流程或绑定已变化' }).waitFor();
  assert.equal(await button('采纳方案').isEnabled(), false);
  await review();
  await button('生成修改方案').click();
  await generated(taskId);
  await capture('diff-1040');
  await button('不采纳').click();
  assert.equal((await call('task.detail', { id: taskId })).flow.flow.description, '手动修改的基线');
  await review();
  await button('生成修改方案').click();
  await generated(taskId);
  await button('采纳方案').click();
  await button('撤销最近采纳').waitFor();
  await button('撤销最近采纳').click();
  await wait(
    async () =>
      (await call('task.detail', { id: taskId })).flow.flow.description === '手动修改的基线',
    'undo not persisted',
  );
  assert.equal((await call('run.detail', { id: runId })).output.value, 'first');
  assert.equal((await call('bootstrap')).runs.length, 1);
  const external: TaskDetail = await call('task.detail', { id: taskId });
  await page.getByLabel('你的需求', { exact: true }).fill('尚未保存的输入');
  await call('task.save', {
    id: taskId,
    revision: external.task.revision,
    description: '其他位置保存的描述',
    context: external.task.context,
    answers: external.task.answers,
  });
  await button('重新读取任务').waitFor();
  assert.equal(await page.getByLabel('你的需求', { exact: true }).inputValue(), '尚未保存的输入');
  assert.equal(await button('保存任务草稿').isEnabled(), false);
  await button('重新读取任务').click();
  await wait(
    async () =>
      (await page.getByLabel('你的需求', { exact: true }).inputValue()) === '其他位置保存的描述',
    '重新读取未完成',
  );
  assert.equal(
    await page.getByLabel('你的需求', { exact: true }).inputValue(),
    '其他位置保存的描述',
  );
  const count = requests.length;
  await close();
  await launch();
  await page.locator('.ai-task-recents button').first().click();
  assert.equal(
    await page.getByLabel('你的需求', { exact: true }).inputValue(),
    '其他位置保存的描述',
  );
  assert.equal(requests.length, count, 'restart must not retry a generation');
  assert.equal((await call('bootstrap')).runs.length, 1);
  assert.deepEqual(errors, []);
  evidence.checks = [
    'real-task-save',
    'settings-return',
    'review-invalidated-on-edit',
    'selected-context-only',
    'clarification',
    'cancel-and-late-result',
    'same-list-graph-node-identities',
    'three-sizes',
    'adopt-undo',
    'real-worker-result',
    'flow-conflict',
    'reject-keeps-manual-edit',
    'old-run-unchanged',
    'task-revision-conflict-keeps-input',
    'serial-restart-no-retry',
  ];
  evidence.passed = true;
} catch (error) {
  failure = error;
  if (page!) await page.screenshot({ path: 'test-results/figma/task-failure.png' }).catch(() => {});
} finally {
  try {
    await close();
    evidence.closed = true;
  } catch (error) {
    failure ??= error;
  }
  held?.response.destroy();
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  if (failure) {
    evidence.passed = false;
    evidence.error = String(failure);
  }
  evidence.data = data;
  evidence.appPath = appPath;
  evidence.requestCount = requests.length;
  await writeFile('test-results/figma/task-summary.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
if (failure) throw failure;
