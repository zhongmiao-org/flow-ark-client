import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import type { Step } from '../src/shared/types';
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
const evidence: any = {
  passed: false,
  closed: false,
  checks: [],
  layouts: [],
  provider: 'local HTTP fixture',
};
const data = await mkdtemp('/private/tmp/flowark-ai-step-');
await mkdir('test-results', { recursive: true });
const appPath = await mkdtemp(resolve('test-results/ai-step-app-'));
const requests: PlanningInput[] = [];
let mode: 'clarify' | 'plan' | 'hold' | 'outside' = 'clarify';
let value = '项目';
let held: { response: ServerResponse; input: PlanningInput } | undefined;
const result = (input: PlanningInput): PlanningResult => {
  const flow = structuredClone(input.baseFlow!);
  const step = flow.steps.find((step) => step.id === 'decision');
  assert.equal(step?.type, 'condition');
  if (step?.type === 'condition') {
    step.operator = 'contains';
    step.expected = value;
  }
  if (mode === 'outside') flow.steps[2].name = '不允许修改相邻步骤';
  return {
    formatVersion: '1.0',
    kind: 'plan',
    flow,
    summary: '只调整所选条件',
    questions: [],
    limitations: [],
  };
};
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
        questions: [{ id: 'word', prompt: '标题包含哪个词？', options: ['项目', '其他'] }],
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
    BrowserWindow.getAllWindows()[0].setTitle('FlowArk · AI 单步隔离测试（自动退出）'),
  );
  await page.evaluate(() => {
    document.querySelector('.window-titlebar')!.textContent =
      'FlowArk · AI 单步隔离测试（自动退出）';
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
async function size(width: number, height: number) {
  await app!.evaluate(
    ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height),
    { width, height },
  );
  await page.waitForFunction((size) => innerWidth === size.width && innerHeight === size.height, {
    width,
    height,
  });
}
async function capture(name: string) {
  const toast = page.locator('.notice button');
  if (await toast.isVisible()) await toast.click();
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
  await page.screenshot({ path: `test-results/figma/ai-step-${name}.png`, scale: 'css' });
}
async function review() {
  await page.getByRole('checkbox', { name: '我已核对本次内容，将发送给 DeepSeek' }).check();
}
async function generated(id: string) {
  await wait(
    async () => (await call('task.detail', { id })).task.status === 'plan',
    'plan not generated',
  );
  await button('采纳修改').waitFor();
}
let failure: unknown;
let taskId = '';
const detail = (): Promise<TaskDetail> => call('task.detail', { id: taskId });
async function generate(status: string, label = '生成这一步的修改') {
  await review();
  await button(label).click();
  await wait(async () => (await detail()).task.status === status, 'unexpected generation state');
}
try {
  await mkdir('test-results/figma', { recursive: true });
  await launch();
  await size(1440, 1080);
  const record = await call('flow.create');
  const steps: Step[] = Array.from({ length: 40 }, (_, i) => ({
    id: 'value_' + (i + 1),
    name: '步骤 ' + (i + 1),
    type: 'value',
    version: 1,
    value: i,
  }));
  steps[0] = {
    id: 'wait',
    name: '等待人工',
    type: 'human',
    version: 1,
    message: '测试旧快照，不自动继续',
  };
  steps[31] = {
    id: 'decision',
    name: '检查标题',
    type: 'condition',
    version: 1,
    actual: '本周项目记录',
    operator: 'equals',
    expected: '',
    then: [{ id: 'yes', type: 'value', version: 1, value: true }],
    else: [{ id: 'no', type: 'value', version: 1, value: false }],
  };
  const saved = await call('flow.save', {
    flow: {
      ...record.flow,
      name: 'AI 单步四十步验证',
      requiredCapabilities: ['value', 'condition', 'human'],
      steps,
    },
    bindings: record.bindings,
  });
  const created = await call('task.create', { flowId: saved.id });
  taskId = created.task.id;
  await call('task.save', {
    id: taskId,
    revision: created.task.revision,
    description: '保留完整任务描述',
    context: [{ id: 'chosen', kind: 'text', label: '已选资料', text: '只发送这份测试资料' }],
    answers: {},
  });
  const oldRun = await call('flow.run', { id: saved.id });
  await wait(
    async () => (await call('run.detail', { id: oldRun.id })).run.state === 'WAITING_INPUT',
    'old run not waiting',
  );
  const oldSnapshot = (await call('run.detail', { id: oldRun.id })).snapshot;
  await button('我的流程').click();
  await button('编辑 AI 单步四十步验证').click();
  await button('长流程大纲').click();
  const outline = () => page.getByRole('region', { name: '长流程工作区' });
  await outline().getByLabel('搜索步骤').fill('检查标题');
  await outline().getByLabel('搜索步骤').press('Enter');
  await button('AI 只修改这一步').click();
  await page
    .getByLabel('这一步怎么改', { exact: true })
    .fill('只把条件改为标题包含项目，其他步骤不动');
  assert.equal((await detail()).task.scope?.nodeId, 'decision');
  await page.locator('.ai-task-provider input').fill('fixture-model');
  await button('配置 AI 服务').click();
  await page.getByPlaceholder('输入或替换 API Key').fill('sk-only-local-step-fixture');
  await button('保存密钥').click();
  await wait(
    async () => (await call('bootstrap')).credentials.includes('deepseek'),
    'key not saved',
  );
  await button('← 返回 AI 任务').click();
  assert.equal(
    await page.getByLabel('这一步怎么改').inputValue(),
    '只把条件改为标题包含项目，其他步骤不动',
  );
  await review();
  await page.getByLabel('这一步怎么改').fill('只把第 32 步条件改为包含项目');
  assert.equal(await button('生成这一步的修改').isEnabled(), false);
  mode = 'outside';
  await generate('failed');
  await page.getByText(/超出单步范围；提案已拒绝/).waitFor();
  assert.deepEqual((await detail()).flow!.flow, saved.flow);
  evidence.checks.push(
    'outline-source-identity-draft-settings-return-confirmation-invalidated-outside-change-rejected',
  );
  mode = 'hold';
  await generate('generating');
  await wait(async () => !!held, 'held request missing');
  await button('取消生成').click();
  mode = 'plan';
  respond(held!.response, result(held!.input));
  held = undefined;
  await wait(async () => (await detail()).task.status === 'cancelled', 'cancel failed');
  assert.equal((await detail()).proposal, undefined);
  mode = 'clarify';
  await generate('clarify');
  await button('项目').click();
  mode = 'plan';
  await generate('plan', '确认并生成方案');
  await button('采纳修改').waitFor();
  assert.equal(requests.at(-1)!.answers.word, '项目');
  await button('继续描述修改').click();
  await page.getByLabel('这一步怎么改').fill('仍然只把第 32 步条件改为包含项目');
  assert.equal(await button('生成这一步的修改').isEnabled(), false);
  await generate('plan');
  await button('采纳修改').waitFor();
  assert.ok(requests.every((input) => input.description.startsWith('本次只修改步骤 decision')));
  assert.ok(!JSON.stringify(requests).includes(data));
  assert.ok(!JSON.stringify(requests).includes('sk-only-local-step-fixture'));
  for (const [w, h] of [
    [1440, 1080],
    [1920, 1080],
    [1040, 700],
  ]) {
    await size(w, h);
    await capture(String(w));
  }
  await size(1440, 1080);
  await button('不采纳').click();
  assert.ok((await detail()).task.scope);
  await generate('plan');
  await button('采纳修改').click();
  await wait(async () => !(await detail()).proposal, 'adoption missing');
  assert.equal((await detail()).task.scope, undefined);
  assert.equal((await detail()).task.description, '保留完整任务描述');
  assert.deepEqual((await call('run.detail', { id: oldRun.id })).snapshot, oldSnapshot);
  assert.equal((await call('bootstrap')).runs.length, 1);
  evidence.checks.push(
    'cancel-late-response-clarification-exact-request-three-widths-reject-adopt-old-snapshot-no-new-run',
  );
  await button('返回来源步骤').click();
  assert.equal(await outline().getByLabel('搜索步骤').inputValue(), '检查标题');
  assert.equal(
    await outline().locator('[data-outline-step="decision"]').getAttribute('aria-pressed'),
    'true',
  );
  await button('AI 只修改这一步').click();
  await page.getByLabel('这一步怎么改').fill('改成标题包含主题');
  await button('保存任务草稿').click();
  const persisted = (await detail()).task.scope;
  await close();
  await launch();
  await page.locator('.ai-task-recents button').filter({ hasText: '保留完整任务描述' }).click();
  assert.deepEqual((await detail()).task.scope, persisted);
  assert.equal(await page.getByLabel('这一步怎么改').inputValue(), persisted!.instruction);
  assert.equal((await call('bootstrap')).runs.length, 1);
  evidence.checks.push(
    'outline-return-retains-search-selection-scoped-draft-survives-serial-process-reopen',
  );
  value = '主题';
  await generate('plan');
  await button('采纳修改').click();
  await button('撤销最近采纳').click();
  assert.equal(((await detail()).flow!.flow.steps[31] as any).expected, '项目');
  await button('流程图').click();
  await page.locator('.ai-task-graph .react-flow__node').filter({ hasText: '检查标题' }).click();
  await button('用 AI 修改此步').click();
  assert.equal((await detail()).task.scope?.nodeId, 'decision');
  await page.getByLabel('这一步怎么改').fill('仍然只修改所选条件');
  await button('保存任务草稿').click();
  const external = (await detail()).flow!;
  external.flow.name = '外部手动修改';
  await call('flow.save', { flow: external.flow, bindings: external.bindings });
  await page.getByText(/单步修改的基线已变化/).waitFor();
  await review();
  assert.equal(await button('生成这一步的修改').isEnabled(), false);
  await button('改为修改完整任务').click();
  assert.equal((await detail()).task.scope, undefined);
  assert.equal(await page.getByLabel('你的需求', { exact: true }).inputValue(), '保留完整任务描述');
  assert.equal(
    await page.getByRole('checkbox', { name: '我已核对本次内容，将发送给 DeepSeek' }).isChecked(),
    false,
  );
  assert.equal((await call('bootstrap')).runs.length, 1);
  assert.deepEqual((await call('run.detail', { id: oldRun.id })).snapshot, oldSnapshot);
  assert.deepEqual(errors, []);
  evidence.checks.push('undo-graph-identity-stale-baseline-blocked-explicit-whole-task-switch');
  evidence.passed = true;
} catch (error) {
  failure = error;
  evidence.error = String(error);
  await page?.screenshot({ path: 'test-results/figma/ai-step-failure.png' }).catch(() => {});
} finally {
  try {
    await close();
  } catch (error) {
    failure ??= error;
    evidence.cleanupError = String(error);
  }
  held?.response.destroy();
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  if (failure) evidence.passed = false;
  await writeFile(
    'test-results/figma/ai-step-summary.json',
    JSON.stringify({ ...evidence, data }, null, 2),
  );
  console.log(JSON.stringify({ ...evidence, data }, null, 2));
}
if (failure) throw failure;
