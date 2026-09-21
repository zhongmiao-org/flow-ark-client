import assert from 'node:assert/strict';
import { execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { cp, mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { desktopElectron as electron } from './desktop-session.mjs';
import { type ElectronApplication, type Page } from 'playwright-core';
import electronPath from 'electron';
import { OUTPUT_BINDING, OUTPUT_CONTEXT_ID } from '../src/shared/task-output';
import type { PlanningInput, PlanningResult, TaskDetail } from '../src/shared/planning';

// Renderer/Main/Host/Worker and local page are real. Provider HTTP and native
// directory-dialog results are fixtures. Native OS interaction is a separate check.
const data = await mkdtemp('/private/tmp/flowark-learning-ui-');
const output = join(data, 'output');
await mkdir(output);
await mkdir('test-results/figma', { recursive: true });
const appPath = await mkdtemp(resolve('test-results/learning-app-'));
const title = '示例资料页 · 首次教学验证';
const evidence: any = {
  passed: false,
  closed: false,
  data,
  checks: [],
  layouts: [],
  processes: [],
  provider: 'local HTTP fixture',
  directoryPicker: 'Main showOpenDialog result fixture; native OS interaction not covered',
};
const requests: PlanningInput[] = [];
let url = '';
const server = createServer(async (req, res) => {
  if (req.url !== '/model') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><title>${title}</title><h1>${title}</h1><p>本机无账号练习页</p>`);
    return;
  }
  try {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const input: PlanningInput = JSON.parse(JSON.parse(raw).messages[1].content).request;
    requests.push(input);
    const selection = input.context.find((c) => c.id === OUTPUT_CONTEXT_ID);
    assert.ok(selection, 'UI must select output before teaching generation');
    const choice = JSON.parse(selection.text);
    assert.equal(JSON.stringify(input).includes(output), false);
    const result: PlanningResult = {
      formatVersion: '1.0',
      kind: 'plan',
      summary: '读取所选网页标题并新建文本。',
      questions: [],
      limitations: [],
      flow: {
        id: input.flowId,
        formatVersion: '1.0',
        name: '网页标题归档',
        description: '',
        parameters: {},
        requiredCapabilities: [
          'browser',
          'assert',
          choice.onConflict === 'number' ? 'file-create-numbered-v1' : 'file',
        ],
        steps: [
          {
            id: 'open',
            type: 'browser',
            version: 1,
            operation: 'navigate',
            selector: '',
            value: url,
          },
          {
            id: 'read',
            type: 'browser',
            version: 1,
            operation: 'read',
            selector: 'h1',
            value: null,
          },
          {
            id: 'check',
            type: 'assert',
            version: 1,
            actual: { $ref: 'steps.read' },
            operator: 'notEquals',
            expected: '',
            name: '标题不为空？',
          },
          {
            id: 'save',
            type: 'file',
            ...(choice.onConflict === 'number'
              ? { version: 4 as const, operation: 'create' as const, onConflict: 'number' as const }
              : { version: 1 as const, operation: 'write' as const }),
            binding: OUTPUT_BINDING,
            name: choice.name,
            content: { $ref: 'steps.read' },
          },
        ],
      },
    };
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify({ resultJson: JSON.stringify(result) }) },
          },
        ],
      }),
    );
  } catch (error) {
    res.statusCode = 500;
    res.end(String(error));
  }
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
url = `http://127.0.0.1:${(server.address() as any).port}/page`;
await cp('dist', join(appPath, 'dist'), { recursive: true });
await cp('contracts', join(appPath, 'contracts'), { recursive: true });
await writeFile(
  join(appPath, 'package.json'),
  JSON.stringify({
    name: 'flowark-learning-ui-fixture',
    version: '0.3.0',
    main: 'dist/main.cjs',
  }),
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
    js: `const originalFetch = globalThis.fetch; globalThis.fetch = (url, init) => { if (String(url) !== 'https://api.deepseek.com/chat/completions') throw new Error('Unexpected provider URL'); return originalFetch(${JSON.stringify(url.replace('/page', '/model'))}, init); };`,
  },
});
let app: ElectronApplication | undefined,
  child: ChildProcess | undefined,
  page: Page | undefined,
  failure: unknown;
const errors: string[] = [];
const call = (method: string, args: any = {}): Promise<any> =>
  page!.evaluate(({ method, args }) => window.flowark.request(method, args), { method, args });
const button = (name: string) => page!.getByRole('button', { name, exact: true });
async function wait(check: () => Promise<boolean>, message: string) {
  const end = Date.now() + 20000;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(message);
    await new Promise((r) => setTimeout(r, 60));
  }
}
async function launch() {
  assert.ok(
    !child || child.exitCode !== null || child.signalCode !== null,
    'prior owned child must have exited',
  );
  // Read-only preflight: never add a test window alongside an existing desktop instance.
  const processes = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
    .split('\n')
    .filter((line) =>
      /^\s*\d+\s+\/.*\/(?:FlowArk|Electron)\.app\/Contents\/MacOS\/(?:FlowArk|Electron)(?:\s|$)/.test(
        line,
      ),
    );
  assert.deepEqual(processes, [], 'an existing desktop instance must exit before GUI testing');
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [appPath],
    env: { ...process.env, FLOWARK_DATA_DIR: data },
  });
  child = app.process();
  evidence.processes.push({ pid: child.pid, closed: false });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: '你想完成什么？', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1440, 1080);
    win.setTitle('FlowArk · 首次教学隔离验证（自动退出）');
  });
}
async function chooseDirectory(selected: string | null) {
  await app!.evaluate(({ dialog }: any, selected) => {
    dialog.showOpenDialog = async (_window: unknown, options: any) => {
      if (
        options.title !== '选择任务输出目录' ||
        JSON.stringify(options.properties) !== '["openDirectory"]'
      )
        throw new Error('unexpected native picker request');
      return { canceled: selected === null, filePaths: selected === null ? [] : [selected] };
    };
  }, selected);
  await page!.getByLabel('结果保存到哪里？', { exact: true }).click();
  await wait(
    async () =>
      !(await page!
        .locator('.ai-task-page')
        .getByRole('button', { name: '确认并生成方案', exact: true })
        .isDisabled()) || !(await page!.locator('#task-output-directory').isDisabled()),
    'directory choice did not settle',
  );
}
async function closeOwned() {
  if (!app) return;
  const owned = app,
    process = child!;
  const watchdog = setTimeout(() => {
    failure ??= new Error('test cleanup timed out');
    process.kill('SIGKILL');
  }, 30000);
  try {
    for (const task of await call('task.list')) await call('task.cancel', { id: task.id });
    for (const run of (await call('bootstrap')).runs)
      if (['QUEUED', 'RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING'].includes(run.state))
        await call('run.control', { id: run.id, action: 'cancel' });
    await wait(async () => {
      const s = await call('bootstrap');
      return !s.execution.active && !s.runOverview.queued;
    }, 'test run cleanup did not finish');
    await owned.close();
  } catch (error) {
    failure ??= error;
    process.kill('SIGKILL');
  } finally {
    clearTimeout(watchdog);
    if (process.exitCode === null && process.signalCode === null) {
      process.kill('SIGKILL');
      await new Promise<void>((r) => {
        const timer = setTimeout(r, 5000);
        process.once('exit', () => {
          clearTimeout(timer);
          r();
        });
      });
    }
    const closed = process.exitCode !== null || process.signalCode !== null;
    evidence.processes.at(-1).closed = closed;
    app = undefined;
    page = undefined;
    assert.ok(closed, 'test process must exit before return or relaunch');
  }
}
try {
  await launch();
  await page!.getByRole('button', { name: /跟着示例做一次/ }).click();
  await page!.getByRole('heading', { name: '第一次，让我们一起完成', exact: true }).waitFor();
  await button('← 返回').click();
  await page!.getByRole('heading', { name: '你想完成什么？', exact: true }).waitFor();
  assert.equal((await call('learning.status')).revision, 0);
  await page!.getByRole('button', { name: /跟着示例做一次/ }).click();
  await page!.getByRole('heading', { name: '第一次，让我们一起完成', exact: true }).waitFor();
  assert.equal((await call('task.list')).length, 0);
  assert.equal((await call('learning.status')).revision, 0);
  assert.equal((await call('browser.embedded.status')).started, false);
  for (const width of [1440, 1280, 1040]) {
    await app!.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 1080),
      width,
    );
    await wait(async () => page!.evaluate((w) => innerWidth === w, width), 'guide window width');
    await page!.evaluate(() => document.fonts.ready);
    const layout = await page!.evaluate(() => ({
      width: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
      columns: [...document.querySelectorAll('.learning-columns > section')].map((e) => {
        const b = e.getBoundingClientRect();
        return {
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          overflow: e.scrollWidth > e.clientWidth,
        };
      }),
    }));
    assert.equal(layout.overflow, false);
    assert.ok(layout.columns.every((c) => !c.overflow));
    if (width === 1440) {
      assert.equal(layout.columns[0].width, 400);
      assert.equal(layout.columns[1].width, 728);
      assert.equal(layout.columns[1].x - layout.columns[0].x - layout.columns[0].width, 24);
      assert.equal(layout.columns[0].height, 690);
      assert.equal(layout.columns[0].y, 230);
    }
    evidence.layouts.push(layout);
    await page!.screenshot({ path: `test-results/figma/learning-${width}.png`, scale: 'css' });
  }
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1080));
  await button('先跳过').click();
  assert.equal((await call('learning.status')).status, 'skipped');
  assert.equal((await call('task.list')).length, 0);
  await button('重新学习 · 2 分钟').click();
  await button('跟着做一次').click();
  const first = await call('learning.status');
  const id = first.taskId;
  assert.equal((await call('task.list')).length, 1);
  assert.equal(requests.length, 0);
  await button('配置 AI 服务').click();
  await page!.getByPlaceholder('输入或替换 API Key').fill('sk-only-local-learning-fixture');
  await button('保存密钥').click();
  await wait(
    async () => (await call('bootstrap')).credentials.includes('deepseek'),
    'fixture credential save',
  );
  await button('← 返回 AI 任务').click();
  assert.match(await page!.getByLabel('你的需求', { exact: true }).inputValue(), /同名自动加序号/);
  assert.equal(requests.length, 0);
  await button('网页链接与对象').click();
  assert.equal(
    await page!.getByLabel('网页地址', { exact: true }).inputValue(),
    'https://example.com',
  );
  await page!.getByLabel('网页地址', { exact: true }).fill(url);
  await button('打开此网页').click();
  await button('收起网页面板').click();
  await wait(async () => button('使用这个目标').isEnabled(), 'page ready');
  await button('使用这个目标').click();
  await wait(async () => !!(await call('learning.status')).achieved.target, 'selected learning');
  await page!.getByRole('heading', { name: '我理解你要……', exact: true }).waitFor();
  const beforeChoice: TaskDetail = await call('task.detail', { id });
  await chooseDirectory(null);
  assert.equal((await call('task.detail', { id })).task.revision, beforeChoice.task.revision);
  await page!
    .getByRole('checkbox', { name: '我已核对本次内容，将发送给 DeepSeek', exact: true })
    .check();
  assert.equal(
    await button('确认并生成方案').isEnabled(),
    false,
    'teaching requires a chosen output',
  );
  await chooseDirectory(output);
  await wait(
    async () => !!(await call('task.detail', { id })).task.outputTarget,
    'output selected',
  );
  assert.equal((await call('task.detail', { id })).task.outputTarget.name, '页面标题.txt');
  assert.equal(
    await page!
      .getByRole('checkbox', { name: '我已核对本次内容，将发送给 DeepSeek', exact: true })
      .isChecked(),
    false,
  );
  for (const width of [1440, 1280, 1040]) {
    await app!.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 1080),
      width,
    );
    await wait(async () => page!.evaluate((w) => innerWidth === w, width), 'understanding width');
    await page!.evaluate(() => {
      document.querySelector('main')?.scrollTo(0, 0);
      return document.fonts.ready;
    });
    const layout = await page!.evaluate(() => ({
      page: 'understanding',
      width: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
      columns: [...document.querySelectorAll('.task-understanding-columns > section')].map((e) => {
        const b = e.getBoundingClientRect();
        return {
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          overflow: e.scrollWidth > e.clientWidth,
        };
      }),
    }));
    assert.equal(layout.overflow, false);
    assert.ok(layout.columns.every((c) => !c.overflow));
    if (width === 1440) {
      assert.equal(layout.columns[0].width, 420);
      assert.equal(layout.columns[1].width, 708);
      assert.equal(layout.columns[0].y, 230);
      assert.equal(layout.columns[1].x, 700);
      assert.equal(layout.columns[0].height, 710);
      assert.equal(layout.columns[1].height, 710);
    }
    evidence.layouts.push(layout);
    await page!.screenshot({ path: `test-results/figma/understanding-${width}.png`, scale: 'css' });
  }
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1080));
  await page!.getByRole('radio', { name: '覆盖原文件', exact: true }).check();
  await page!.getByText('修改文件名或移除目录', { exact: true }).click();
  await page!.getByLabel('输出文件名', { exact: true }).fill('自定义标题.txt');
  await button('理解不对，重新描述').click();
  assert.equal((await call('task.detail', { id })).task.outputTarget.name, '自定义标题.txt');
  assert.equal((await call('task.detail', { id })).task.outputTarget.onConflict, 'overwrite');
  await button('理解与输出位置').click();
  await page!.getByText('修改文件名或移除目录', { exact: true }).click();
  assert.equal(
    await page!.getByLabel('输出文件名', { exact: true }).inputValue(),
    '自定义标题.txt',
  );
  await button('移除输出目录').click();
  await wait(async () => !(await call('task.detail', { id })).task.outputTarget, 'output cleared');
  await chooseDirectory(output);
  await page!.getByText('查看本次发送给 DeepSeek 的内容', { exact: true }).click();
  const disclosure = await page!.locator('.ai-task-disclosure').innerText();
  assert.match(disclosure, /task_output/);
  assert.match(disclosure, /页面标题.txt/);
  assert.equal(disclosure.includes(output), false);
  assert.equal(
    disclosure.includes((await call('task.detail', { id })).task.outputTarget.selectionId),
    false,
  );
  assert.equal(requests.length, 0);
  evidence.checks.push(
    'understanding-layouts-native-dialog-cancel-and-select-main-fixture-output-requirement-filename-policy-save-clear-disclosure-no-local-path',
  );

  await button('重新学习 · 2 分钟').click();
  await button('先跳过').click();
  assert.equal((await call('learning.status')).status, 'skipped');
  evidence.checks.push(
    'three-guide-layouts-read-only-entry-skip-single-task-provider-return-real-web-selection',
  );
  await closeOwned();
  if (failure) throw failure;
  await launch();
  await button('继续教学').click();
  assert.equal((await call('learning.status')).taskId, id);
  assert.equal((await call('task.list')).length, 1);
  assert.equal(requests.length, 0);
  assert.ok((await call('learning.status')).achieved.target);
  await button('查看或更换网页目标').click();
  await wait(
    async () => !(await button('使用这个目标').isEnabled()),
    'stale page must require selection',
  );
  await button('打开此网页').click();
  await button('收起网页面板').click();
  await wait(async () => button('使用这个目标').isEnabled(), 'reopened page ready');
  await button('使用这个目标').click();
  await page!
    .getByRole('checkbox', { name: '我已核对本次内容，将发送给 DeepSeek', exact: true })
    .check();
  await button('确认并生成方案').click();
  await button('采纳方案').waitFor();
  assert.equal((await call('learning.status')).achieved.plan, undefined);
  await button('采纳方案').click();
  await wait(async () => !!(await call('learning.status')).achieved.plan, 'adopted learning');
  let d: TaskDetail = await call('task.detail', { id });
  assert.equal(
    d.flow!.bindings.files[OUTPUT_BINDING],
    output,
    'directory must come from UI selection and adoption',
  );
  await wait(
    async () =>
      page!
        .locator('.ai-task-state')
        .innerText()
        .then((t) => t.includes('草稿已保存')),
    'saved plan',
  );
  await button('确认方案，去试运行').click();
  await wait(
    async () =>
      page!
        .getByRole('checkbox', { name: '我已核对操作对象、可能更改和保存位置', exact: true })
        .isEnabled(),
    'run review ready',
  );
  await page!
    .getByRole('checkbox', { name: '我已核对操作对象、可能更改和保存位置', exact: true })
    .check();
  await button('开始试运行').click();
  await page!.locator('[data-task-run-id]').waitFor();
  const run = (await call('bootstrap')).runs[0];
  await wait(
    async () =>
      ['SUCCEEDED', 'FAILED'].includes((await call('run.detail', { id: run.id })).run.state),
    'learning output',
  );
  const completed = await call('run.detail', { id: run.id });
  assert.equal(completed.run.state, 'SUCCEEDED', completed.run.error);
  assert.equal((await call('learning.status')).status, 'active');
  assert.equal(Object.keys((await call('learning.status')).achieved).length, 3);
  assert.equal(await readFile(join(output, '页面标题.txt'), 'utf8'), title);
  await button('预览文件').click();
  await wait(
    async () => (await call('learning.status')).status === 'completed',
    'real preview completion',
  );
  await page!.getByText('已完成第一次学习 · 已找到并预览真实结果。', { exact: true }).waitFor();
  await page!.screenshot({ path: 'test-results/figma/learning-completed.png', scale: 'css' });
  assert.equal(requests.length, 1);
  evidence.checks.push(
    'resume-same-task-reselect-stale-page-real-ai-fixture-adoption-confirmed-worker-run-authenticated-preview',
  );
  await button('返回结果摘要').click();
  await button('告诉 AI 怎么改').click();
  await button('查看或更换网页目标').click();
  await wait(async () => button('使用这个目标').isEnabled(), 'current page available');
  await button('使用这个目标').click();
  await page!.getByRole('radio', { name: '覆盖原文件', exact: true }).check();
  await page!
    .getByRole('checkbox', { name: '我已核对本次内容，将发送给 DeepSeek', exact: true })
    .check();
  await button('确认并生成方案').click();
  await button('采纳方案').waitFor();
  await button('采纳方案').click();
  await writeFile(join(output, '页面标题.txt'), '旧文本，应由明确覆盖操作替换');
  await button('确认方案，去试运行').click();
  await button('检查新的试运行').click();
  await wait(
    async () =>
      page!
        .getByRole('checkbox', { name: '我已核对操作对象、可能更改和保存位置', exact: true })
        .isEnabled(),
    'overwrite review ready',
  );
  assert.match(await page!.locator('main').innerText(), /覆盖同名文件/);
  await page!
    .getByRole('checkbox', { name: '我已核对操作对象、可能更改和保存位置', exact: true })
    .check();
  await button('开始试运行').click();
  await page!.locator('[data-task-run-id]').waitFor();
  const overwritten = (await call('bootstrap')).runs.find((r: any) => r.id !== run.id);
  await wait(
    async () =>
      ['SUCCEEDED', 'FAILED'].includes(
        (await call('run.detail', { id: overwritten.id })).run.state,
      ),
    'UI overwrite result',
  );
  assert.equal((await call('run.detail', { id: overwritten.id })).run.state, 'SUCCEEDED');
  assert.equal(await readFile(join(output, '页面标题.txt'), 'utf8'), title);
  assert.equal(await readFile(completed.artifacts[0].path, 'utf8'), title);
  assert.equal(requests.length, 2);
  evidence.checks.push(
    'explicit-overwrite-ui-generation-adoption-review-real-worker-keeps-prior-artifact',
  );

  await closeOwned();
  if (failure) throw failure;
  await launch();
  await button('查看教学结果').click();
  assert.equal((await call('learning.status')).status, 'completed');
  assert.equal((await call('bootstrap')).runs.length, 2);
  assert.equal(requests.length, 2);
  await button('重新学习 · 2 分钟').click();
  await button('重新开始学习').click();
  const restarted = await call('learning.status');
  assert.notEqual(restarted.taskId, id);
  assert.deepEqual(restarted.achieved, {});
  assert.equal((await call('task.list')).length, 2);
  assert.equal((await call('bootstrap')).runs.length, 2);
  assert.equal(await readFile(completed.artifacts[0].path, 'utf8'), title);
  assert.equal(requests.length, 2);
  assert.deepEqual(errors, []);
  evidence.checks.push(
    'serial-reopen-persists-completion-restart-keeps-old-task-run-file-no-model-or-run-replay',
  );
  evidence.passed = true;
} catch (error) {
  failure = error;
  await page
    ?.screenshot({ path: 'test-results/figma/learning-failure.png', scale: 'css' })
    .catch(() => {});
} finally {
  await closeOwned().catch((error) => {
    failure ??= error;
  });
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  evidence.closed = evidence.processes.every((p: any) => p.closed);
  evidence.errors = errors;
  evidence.passed &&= !failure && evidence.closed;
  if (failure) evidence.failure = String(failure);
  await writeFile('test-results/figma/learning-summary.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
if (failure) throw failure;
