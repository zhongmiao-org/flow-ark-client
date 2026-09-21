import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import electronPath from 'electron';
import type { Flow, Run, Step } from '../src/shared/types';
const data = await mkdtemp('/private/tmp/flowark-task-result-'),
  files = join(data, 'files');
await mkdir(files);
await mkdir('test-results/figma', { recursive: true });
let posts = 0;
const server = createServer((req, res) => {
  if (req.method === 'POST') {
    posts++;
    res.end('receipt-' + posts);
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<h1>虚构结果标题 sk-preview-fixture opaque-local-preview-key</h1>');
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(server.address() as any).port}/`;
const evidence: any = { passed: false, closed: false, data, checks: [], layouts: [] };
let app: ElectronApplication | undefined, page: Page | undefined, failure: unknown;
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const call = (method: string, args: any = {}): Promise<any> =>
  page!.evaluate(({ method, args }) => window.flowark.request(method, args), { method, args });
async function wait(predicate: () => Promise<boolean>, label: string) {
  const end = Date.now() + 20000;
  while (!(await predicate())) {
    if (Date.now() > end) throw new Error(label);
    await new Promise((r) => setTimeout(r, 70));
  }
}
const screen = () => page!.locator('.task-run-page');
const runId = async () => (await screen().getAttribute('data-task-run-id'))!;
const state = async (id: string, value: string) =>
  wait(
    async () => (await call('run.detail', { id })).run.state === value,
    'run did not reach ' + value,
  );
async function capture(kind: string) {
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
    await page!.waitForFunction(
      ({ width, height }) => innerWidth === width && innerHeight === height,
      { width, height },
    );
    await page!.locator('main').evaluate((e) => e.scrollTo(0, 0));
    const layout = await screen().evaluate((e) => ({
      width: innerWidth,
      height: innerHeight,
      overflow: e.scrollWidth > e.clientWidth,
      rootOverflow: document.documentElement.scrollWidth > innerWidth,
    }));
    assert.equal(layout.overflow, false);
    assert.equal(layout.rootOverflow, false);
    evidence.layouts.push({ kind, ...layout });
    await page!.mouse.move(0, 0);
    await page!.screenshot({ path: `test-results/figma/task-${kind}-${width}.png`, scale: 'css' });
  }
}
async function prepare(name: string, steps: Step[]): Promise<Flow> {
  const task = (await call('task.create')).task;
  await call('task.save', {
    id: task.id,
    revision: task.revision,
    description: name,
    context: [],
    answers: {},
  });
  const flow: Flow = {
    id: task.flowId,
    name,
    description: '',
    formatVersion: '1.0',
    parameters: {},
    requiredCapabilities: ['browser', 'file', 'http'],
    steps,
  };
  await call('flow.save', {
    flow,
    bindings: { files: { work: files }, credentials: [], browserId: 'embedded' },
  });
  await page!.locator('.sidebar').getByRole('button', { name: '我的流程', exact: true }).click();
  await page!.locator('.sidebar').getByRole('button', { name: '开始任务', exact: true }).click();
  if (await button('回到开始').count()) await button('回到开始').click();
  // A retained task page offers its own home button.
  if (await button('返回开始任务').isVisible()) await button('返回开始任务').click();
  await page!.locator('.ai-task-recents button').filter({ hasText: name }).click();
  return flow;
}
async function start(debug = false) {
  await button('确认方案，去试运行').click();
  const check = page!.locator('.run-review-page:not([hidden])');
  await check.getByRole('heading', { name: '检查通过', exact: true }).waitFor();
  if (debug) {
    await check.getByRole('checkbox', { name: '逐步调试，在每个步骤前暂停' }).check();
    await check.getByRole('heading', { name: '检查通过', exact: true }).waitFor();
  }
  await check.getByRole('checkbox', { name: '我已核对操作对象、可能更改和保存位置' }).check();
  await button('开始试运行').click();
  await screen().waitFor();
  return runId();
}
try {
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: ['.'],
    env: { ...process.env, FLOWARK_DATA_DIR: data },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: '你想完成什么？' }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setTitle('FlowArk · 结果页隔离测试（自动退出）'),
  );
  await page.evaluate(() => {
    document.querySelector('.window-titlebar')!.textContent =
      'FlowArk · 结果页隔离测试（自动退出）';
  });
  await page.evaluate(() => document.fonts.ready);
  await call('browser.embedded.enable');
  await call('credentials.set', { id: 'deepseek', value: 'opaque-local-preview-key' });
  const first = await prepare('虚构结果回读', [
    {
      id: 'open',
      type: 'browser',
      version: 1,
      name: '打开资料页',
      operation: 'navigate',
      selector: '',
      value: url,
    },
    {
      id: 'read',
      type: 'browser',
      version: 1,
      name: '读取标题',
      operation: 'read',
      selector: 'h1',
      value: null,
    },
    {
      id: 'human',
      type: 'human',
      version: 1,
      name: '等待核对标题',
      message: '请核对虚构标题，再继续保存',
    },
    {
      id: 'save',
      type: 'file',
      version: 1,
      operation: 'write',
      binding: 'work',
      name: 'title.txt',
      content: { $ref: 'steps.read' },
    },
    {
      id: 'other',
      type: 'file',
      version: 1,
      operation: 'write',
      binding: 'work',
      name: 'other.txt',
      content: '第二个真实副本',
    },
    {
      id: 'branch',
      type: 'condition',
      version: 1,
      actual: true,
      operator: 'equals',
      expected: true,
      then: [{ id: 'done', type: 'value', version: 1, value: 'done' }],
      else: [{ id: 'unused', type: 'value', version: 1, value: 'unused' }],
    },
  ] as Step[]);
  const id = await start();
  await state(id, 'WAITING_INPUT');
  await button('继续').waitFor();
  await capture('running');
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as any)._invokeHandlers,
      original = handlers.get('flowark:request');
    const fixture: any = { original, mode: '', release: undefined };
    (globalThis as any).resultFixture = fixture;
    handlers.set('flowark:request', async (...args: any[]) => {
      const result = await original(...args);
      if (fixture.mode === 'unknown' && args[1] === 'run.detail')
        return { ...result, execution: undefined };
      if (fixture.mode === 'fault' && args[1] === 'run.detail')
        return { ...result, fault: 'fixture: saved state only' };
      if (fixture.mode === 'hold-preview' && args[1] === 'artifact.preview') {
        fixture.mode = '';
        await new Promise<void>((r) => (fixture.release = r));
      }
      return result;
    });
  });
  const mode = (value: string) =>
    app!.evaluate((_, value) => {
      (globalThis as any).resultFixture.mode = value;
    }, value);
  await mode('unknown');
  await screen().getByRole('heading', { name: '执行结果需要核对', exact: true }).waitFor();
  assert.equal(await screen().getByRole('button', { name: '继续', exact: true }).count(), 0);
  await mode('fault');
  await screen()
    .getByText('已停止接收新任务；状态为最后成功保存的记录，当前执行和最终结果请核对。')
    .waitFor();
  await mode('');
  await button('继续').waitFor();
  await button('继续').click();
  await state(id, 'SUCCEEDED');
  await screen().getByRole('heading', { name: '本次试运行已完成', exact: true }).waitFor();
  assert.equal(
    await readFile(join(files, 'title.txt'), 'utf8'),
    '虚构结果标题 sk-preview-fixture opaque-local-preview-key',
  );
  await capture('result');
  assert.match(await screen().innerText(), /2 个文件产物/);
  assert.match(await screen().innerText(), /尚未执行：1/);
  evidence.checks.push('real-waiting-progress-fault-and-unknown-observation-success-three-sizes');
  const detail = await call('run.detail', { id });
  const artifact = detail.artifacts.find((a: any) => a.name === 'title.txt');
  await screen()
    .locator(`[data-artifact-id="${artifact.artifactId}"]`)
    .getByRole('button', { name: '预览文件' })
    .click();
  await page.locator('[data-artifact-preview]').waitFor();
  assert.equal(
    await page.locator('[data-artifact-preview]').innerText(),
    '虚构结果标题 [REDACTED] [REDACTED]',
  );
  await capture('result-details');
  await page
    .locator('#task-artifact')
    .selectOption(detail.artifacts.find((a: any) => a.name === 'other.txt').artifactId);
  await wait(
    async () => (await page!.locator('[data-artifact-preview]').innerText()) === '第二个真实副本',
    'selection did not change',
  );
  await button('← 返回结果摘要').click();
  assert.equal((await call('bootstrap')).runs.length, 1);
  await mode('hold-preview');
  await screen()
    .locator(`[data-artifact-id="${artifact.artifactId}"]`)
    .getByRole('button', { name: '预览文件' })
    .click();
  await wait(
    () => app!.evaluate(() => !!(globalThis as any).resultFixture.release),
    'preview reply not held',
  );
  await button('← 返回结果摘要').click();
  await app.evaluate(() => {
    (globalThis as any).resultFixture.release();
    (globalThis as any).resultFixture.release = undefined;
  });
  assert.equal(await page.locator('[data-artifact-preview]').count(), 0);
  await writeFile(artifact.path, 'tampered same artifact');
  await wait(
    async () =>
      await screen()
        .locator(`[data-artifact-id="${artifact.artifactId}"]`)
        .innerText()
        .then((s) => s.includes('已改动')),
    'artifact integrity did not update',
  );
  assert.equal(
    await screen()
      .locator(`[data-artifact-id="${artifact.artifactId}"]`)
      .getByRole('button', { name: '预览文件' })
      .isEnabled(),
    false,
  );
  evidence.checks.push('verified-file-preview-redaction-selection-late-reply-and-tamper');
  await button('告诉 AI 怎么改').click();
  await page.getByRole('heading', { name: '描述需求，带上必要资料' }).waitFor();
  assert.equal(await page.getByLabel('你的需求', { exact: true }).inputValue(), '虚构结果回读');
  assert.equal((await call('bootstrap')).runs.length, 1);
  evidence.checks.push('modify-returns-original-task-without-generation-or-run');
  const failureFlow = await prepare('虚构失败与关联重跑', [
    {
      id: 'write',
      type: 'file',
      version: 1,
      operation: 'write',
      binding: 'work',
      name: 'partial.txt',
      content: 'partial output',
    },
    {
      id: 'post',
      type: 'http',
      version: 1,
      name: '发送本地测试回执',
      method: 'POST',
      headers: {},
      url,
      body: 'fictional',
    },
    {
      id: 'fail',
      type: 'assert',
      version: 1,
      name: '核对测试条件',
      actual: false,
      operator: 'equals',
      expected: true,
    },
    { id: 'later', type: 'value', version: 1, name: '尚未执行的后续步骤', value: 'later' },
  ] as Step[]);
  const failed = await start();
  await state(failed, 'FAILED');
  await screen().getByRole('heading', { name: '停在：核对测试条件' }).waitFor();
  assert.equal(posts, 1);
  assert.equal(await readFile(join(files, 'partial.txt'), 'utf8'), 'partial output');
  await capture('failure');
  assert.ok(!(await screen().innerText()).includes('未写入文件'));
  await button('详细信息').click();
  await button('← 返回结果摘要').click();
  assert.equal(posts, 1);
  (failureFlow.steps[2] as any).actual = true;
  await call('flow.save', {
    flow: failureFlow,
    bindings: { files: { work: files }, credentials: [], browserId: 'embedded' },
  });
  await button('核对后重新运行').click();
  await button('预览重新运行').click();
  await page
    .getByRole('checkbox', { name: '已核对原运行的输出与外部结果，确认从头执行' })
    .waitFor();
  assert.equal(posts, 1);
  await page.getByRole('checkbox', { name: '已核对原运行的输出与外部结果，确认从头执行' }).check();
  await page.getByRole('button', { name: '确认从头运行', exact: true }).click();
  await wait(async () => (await runId()) !== failed, 'new run not shown');
  const rerun = await runId();
  await state(rerun, 'SUCCEEDED');
  assert.equal((await call('run.detail', { id: rerun })).run.rerun.runId, failed);
  assert.equal(posts, 2);
  evidence.checks.push('real-partial-failure-preserves-file-and-explicit-related-rerun-only');
  await button('回到任务').click();
  await button('确认方案，去试运行').click();
  await button('检查新的试运行').click();
  const check = page.locator('.run-review-page:not([hidden])');
  await check.getByRole('heading', { name: '检查通过', exact: true }).waitFor();
  await check.getByRole('checkbox', { name: '逐步调试，在每个步骤前暂停' }).check();
  await check.getByRole('heading', { name: '检查通过', exact: true }).waitFor();
  await check.getByRole('checkbox', { name: '我已核对操作对象、可能更改和保存位置' }).check();
  await button('开始试运行').click();
  await screen().waitFor();
  const paused = await runId();
  await state(paused, 'PAUSED');
  await button('执行下一步').waitFor();
  await button('取消运行').click();
  await state(paused, 'CANCELLED');
  await screen().getByRole('heading', { name: '本次试运行已取消' }).waitFor();
  assert.equal(posts, 2);
  evidence.checks.push('real-debug-pause-and-cancel-do-not-repeat-side-effects');
  assert.deepEqual(errors, []);
  evidence.passed = true;
} catch (error) {
  failure = error;
  await page
    ?.screenshot({ path: 'test-results/figma/task-result-failure.png', scale: 'css' })
    .catch(() => {});
} finally {
  try {
    if (app && page) {
      await app.evaluate(({ ipcMain }) => {
        const f = (globalThis as any).resultFixture;
        if (f) {
          f.release?.();
          (ipcMain as any)._invokeHandlers.set('flowark:request', f.original);
        }
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
  await writeFile('test-results/figma/task-result-summary.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
if (failure) throw failure;
