import assert from 'node:assert/strict';
import { execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { cp, mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import electronPath from 'electron';
import type { PlanningInput, PlanningResult, TaskDetail } from '../src/shared/planning';

// Renderer/Main/Host/Worker and local page are real. Only provider HTTP is redirected
// in an ignored private build. This does not validate a live AI provider or account.
const data = await mkdtemp('/private/tmp/flowark-web-target-ui-');
const output = join(data, 'output');
await mkdir(output);
await mkdir('test-results/figma', { recursive: true });
const appPath = await mkdtemp(resolve('test-results/web-target-app-'));
const title = '示例资料页 · 网页目标核对';
const evidence: any = {
  passed: false,
  closed: false,
  data,
  checks: [],
  layouts: [],
  processes: [],
  provider: 'local HTTP fixture',
};
const requests: PlanningInput[] = [];
let pause = false;
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
        requiredCapabilities: ['browser', 'file-create-v1'],
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
          ...(pause
            ? [
                {
                  id: 'wait',
                  type: 'human' as const,
                  version: 1 as const,
                  message: '等待外部刷新验证',
                },
              ]
            : []),
          {
            id: 'save',
            type: 'file',
            version: 3,
            operation: 'create',
            binding: 'output',
            name: pause ? 'after-refresh.txt' : 'title.txt',
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
    name: 'flowark-web-target-ui-fixture',
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
    win.setTitle('FlowArk · 网页目标隔离验证（自动退出）');
  });
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
async function select(d: TaskDetail) {
  const identity = { id: d.task.id, revision: d.task.revision };
  const p = await call('task.web.preview', identity);
  assert.equal(p.ready, true, p.reason);
  return call('task.web.select', { ...identity, token: p.token }) as Promise<TaskDetail>;
}
async function generate(d: TaskDetail) {
  await call('task.generate', {
    id: d.task.id,
    revision: d.task.revision,
    provider: 'deepseek',
    model: 'fixture',
    reviewed: true,
  });
  await wait(
    async () => (await call('task.detail', { id: d.task.id })).task.status !== 'generating',
    'generation did not finish',
  );
  const next = await call('task.detail', { id: d.task.id });
  assert.equal(next.task.status, 'plan', next.task.error);
  return call('task.adopt', {
    id: next.task.id,
    revision: next.task.revision,
    proposalId: next.proposal.id,
  }) as Promise<TaskDetail>;
}
try {
  await launch();
  await page!.getByLabel('你想完成的任务').fill('读取我选择的网页标题并保存文本');
  await button('开始规划').click();
  await button('网页链接与对象').click();
  await page!.getByRole('heading', { name: '这次要操作哪里？', exact: true }).waitFor();
  assert.equal(await button('使用这个目标').isEnabled(), false);
  assert.equal(
    (await call('browser.embedded.status')).started,
    false,
    'preview cannot create a page',
  );
  await page!.getByLabel('网页地址', { exact: true }).fill(url);
  await button('打开此网页').click();
  await button('收起网页面板').click();
  await wait(async () => button('使用这个目标').isEnabled(), 'page did not become selectable');
  assert.equal((await call('bootstrap')).runs.length, 0);
  for (const width of [1440, 1280, 1040]) {
    await app!.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 1080),
      width,
    );
    await page!.evaluate(() => document.fonts.ready);
    await wait(
      async () => page!.evaluate((w) => innerWidth === w, width),
      'window width did not settle',
    );
    const layout = await page!.evaluate(() => ({
      width: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
      columns: [...document.querySelectorAll('.task-web-columns > section')].map((e) => {
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
    }
    evidence.layouts.push(layout);
    await page!.screenshot({ path: `test-results/figma/web-target-${width}.png`, scale: 'css' });
  }
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1080));
  await button('使用这个目标').click();
  await page!.getByLabel('已选网页来源').waitFor();
  const id = (await call('task.list'))[0].id;
  let d: TaskDetail = await call('task.detail', { id });
  const firstSelection = d.task.webTarget!;
  assert.equal(d.task.context.length, 0);
  assert.equal(d.task.webTarget!.page.url, url);
  await button('查看或更换网页目标').click();
  await button('返回描述与资料').click();
  assert.equal(
    await page!.getByLabel('你的需求', { exact: true }).inputValue(),
    '读取我选择的网页标题并保存文本',
  );
  await page!.getByText('查看本次发送给 DeepSeek 的内容', { exact: true }).click();
  assert.match(await page!.locator('.ai-task-disclosure').innerText(), /未核对/);
  assert.doesNotMatch(
    await page!.locator('.ai-task-disclosure').innerText(),
    /documentRevision|resourceId/,
  );
  evidence.checks.push(
    'real-source-open-select-return-disclosure-no-hidden-page-read-or-run-three-widths',
  );
  await call('credentials.set', { id: 'deepseek', value: 'sk-only-local-web-fixture' });
  d = await generate(d);
  assert.equal(requests[0].context.length, 1);
  assert.doesNotMatch(JSON.stringify(requests), /resourceId|selectionId|documentRevision/);
  const saved = await call('flow.save', {
    flow: d.flow!.flow,
    bindings: { ...d.flow!.bindings, files: { output } },
  });
  assert.deepEqual(saved.webTarget, firstSelection);
  const review = await call('flow.run.preview', { id: d.task.flowId });
  assert.equal(review.ready, true, JSON.stringify(review.checks));
  const run = await call('flow.run.confirm', {
    id: d.task.flowId,
    token: review.token,
    reviewed: true,
    requestId: randomUUID(),
  });
  assert.equal(run.rejected, undefined, run.message);
  await wait(
    async () =>
      ['SUCCEEDED', 'FAILED'].includes((await call('run.detail', { id: run.id })).run.state),
    'read-create run did not finish',
  );
  const completed = await call('run.detail', { id: run.id });
  assert.equal(completed.run.state, 'SUCCEEDED', completed.run.error);
  assert.equal(await readFile(join(output, 'title.txt'), 'utf8'), title);
  assert.equal(completed.artifacts[0].integrity, 'verified');
  evidence.checks.push('real-main-selected-navigate-read-real-host-worker-text-artifact');
  await wait(async () => !(await call('bootstrap')).execution.active, 'run cleanup');
  await assert.rejects(
    call('flow.run', { id: d.task.flowId }),
    /刷新|切换/,
    'a new run cannot inherit run-local navigation',
  );
  d = await select(await call('task.detail', { id }));
  pause = true;
  d = await generate(d);
  const second = await call('flow.run', { id: d.task.flowId });
  await wait(
    async () => (await call('run.detail', { id: second.id })).run.state === 'WAITING_INPUT',
    'run did not pause',
  );
  // Real native page refresh outside the declared Run command; same URL is insufficient.
  await app!.evaluate(async ({ webContents }) => {
    const web = webContents
      .getAllWebContents()
      .find((wc) => wc.getURL().startsWith('http://127.0.0.1:'))!;
    await web.loadURL(web.getURL());
  });
  await call('run.control', { id: second.id, action: 'resume' });
  await wait(
    async () =>
      ['SUCCEEDED', 'FAILED'].includes((await call('run.detail', { id: second.id })).run.state),
    'refreshed run did not finish',
  );
  assert.equal((await call('run.detail', { id: second.id })).run.state, 'FAILED');
  await assert.rejects(access(join(output, 'after-refresh.txt')));
  assert.equal(await readFile(join(output, 'title.txt'), 'utf8'), title);
  evidence.checks.push('external-same-url-refresh-invalidates-next-file-node-no-extra-output');
  await closeOwned();
  if (failure) throw failure;
  await launch();
  const restored: TaskDetail = await call('task.detail', { id });
  assert.ok(restored.task.webTarget);
  assert.equal(
    (await call('task.web.preview', { id, revision: restored.task.revision })).ready,
    false,
  );
  await assert.rejects(call('flow.run', { id: restored.task.flowId }), /打开|选择|网页/);
  assert.equal((await call('bootstrap')).runs.length, 2);
  assert.deepEqual(errors, []);
  evidence.checks.push(
    'serial-process-reopen-preserves-source-and-history-but-requires-new-selection',
  );
  evidence.passed = true;
} catch (error) {
  failure = error;
  await page
    ?.screenshot({ path: 'test-results/figma/web-target-failure.png', scale: 'css' })
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
  await writeFile('test-results/figma/web-target-summary.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
if (failure) throw failure;
