import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import electronPath from 'electron';
import type { Flow, Run } from '../src/shared/types';
import type { PlanningInput, PlanningResult, TaskDetail } from '../src/shared/planning';
import type { RepairInput, RepairPreview } from '../src/shared/task-repair';

// Real Renderer IPC, Main picker, encrypted Host, provider adapter and Worker.
// Only the provider HTTP endpoint is redirected inside an ignored private build.
// This is not evidence of a real DeepSeek/OpenAI connection or the repair UI.
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
const pick = async () => {
  const requestId = randomUUID();
  await call('browser.embedded.pick.start', { requestId });
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
  await wait(
    async () => (await call('browser.embedded.pick.status', { requestId })).phase === 'selected',
    'native pick did not select',
  );
  return requestId;
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
  await call('credentials.set', { id: 'deepseek', value: 'sk-repair-native-fixture' });
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
  const check = await call('flow.run.preview', {
    id: flow.id,
    task: { id: task.id, revision: task.revision },
  });
  assert.equal(check.ready, true, JSON.stringify(check.checks));
  const run: Run = await call('flow.run.confirm', {
    id: flow.id,
    task: { id: task.id, revision: task.revision },
    token: check.token,
    requestId: randomUUID(),
    reviewed: true,
  });
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
  args.pickRequestId = await pick();
  const fresh = await preview();
  await call('browser.embedded.navigate', { url });
  await assert.rejects(generate(fresh), /变化|选取/);
  assert.equal(requests.length, 0);
  args.pickRequestId = await pick();
  const hidden = await preview();
  await call('browser.embedded.visibility', { visible: false });
  await assert.rejects(generate(hidden), /展开|选取/);
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
  args.pickRequestId = await pick();
  await generate(await preview());
  await wait(
    async () => (await call('task.detail', { id: task.id })).task.status !== 'generating',
    'second repair did not finish',
  );
  detail = await call('task.detail', { id: task.id });
  assert.equal(detail.task.status, 'plan', detail.task.error);
  await call('task.adopt', {
    id: task.id,
    revision: task.revision,
    proposalId: detail.proposal!.id,
  });
  assert.equal((await call('bootstrap')).runs.length, 1);
  const still = await call('run.detail', { id: run.id });
  assert.deepEqual(still.run, original.run);
  assert.deepEqual(still.snapshot, original.snapshot);
  assert.deepEqual(still.events, original.events);
  const repeat = await call('run.rerun.preview', { id: run.id, mode: 'saved' });
  const confirmation = {
    id: run.id,
    mode: 'saved',
    token: repeat.token,
    requestId: randomUUID(),
    reviewed: true,
  };
  const next: Run = await call('run.rerun.confirm', confirmation);
  assert.equal((await call('run.rerun.confirm', confirmation)).id, next.id);
  await wait(
    async () =>
      (await call('run.detail', { id: next.id })).run.state === 'SUCCEEDED' &&
      !(await call('bootstrap')).execution?.active,
    'repaired run did not succeed',
  );
  assert.equal(next.rerun?.runId, run.id);
  assert.equal(await readFile(join(output, 'title.txt'), 'utf8'), '虚构新标题');
  assert.equal((await call('bootstrap')).runs.length, 2);
  evidence.checks.push(
    'real-native-selection-without-page-click',
    'duplicate-target-refresh-hide-and-reselection-rejected',
    'provider-adapter-target-only-proposal-and-zero-run-adoption',
    'original-run-snapshot-and-events-unchanged',
    'explicit-idempotent-linked-rerun-and-real-file',
  );
  evidence.requestCount = requests.length;
  evidence.passed = true;
} catch (error) {
  failure = error;
} finally {
  try {
    if (app && page) {
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
