import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync, type ChildProcess } from 'node:child_process';
import { desktopElectron as electron } from './desktop-session.mjs';
import { type ElectronApplication, type Page } from 'playwright-core';
import electronPath from 'electron';
const data = await mkdtemp('/private/tmp/flowark-file-create-ui-');
const output = join(data, 'output');
await mkdir(output);
await mkdir('test-results/figma', { recursive: true });
const title = '示例资料页 · 文本归档 💡';
const server = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><title>${title}</title><h1>${title}</h1><p>本机无账号练习页</p>`);
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(server.address() as any).port}`;
const evidence: any = { passed: false, closed: false, data, checks: [], processes: [] };
let app: ElectronApplication | undefined,
  page: Page | undefined,
  child: ChildProcess | undefined,
  failure: unknown;
const errors: string[] = [];
const call = (method: string, args: any = {}): Promise<any> =>
  page!.evaluate(({ method, args }) => window.flowark.request(method, args), { method, args });
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const wait = async (check: () => Promise<boolean>, message: string) => {
  const end = Date.now() + 20000;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(message);
    await new Promise((r) => setTimeout(r, 60));
  }
};
async function launch() {
  const active = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
    .split('\n')
    .filter((line) =>
      /^\s*\d+\s+\/.*\/(?:FlowArk|Electron)\.app\/Contents\/MacOS\/(?:FlowArk|Electron)(?:\s|$)/.test(
        line,
      ),
    );
  assert.deepEqual(active, [], 'existing GUI main process: do not launch another instance');
  assert.ok(
    !child || child.exitCode !== null || child.signalCode !== null,
    'prior owned process must exit before launch',
  );
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: ['.'],
    env: { ...process.env, FLOWARK_DATA_DIR: data },
  });
  child = app.process();
  evidence.processes.push({ pid: child.pid, closed: false });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: '你想完成什么？', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setTitle('FlowArk · 文本新建隔离验证（自动退出）');
    BrowserWindow.getAllWindows()[0].setSize(1440, 1080);
  });
}
async function closeOwned() {
  if (!app) return;
  const watchdog = setTimeout(() => {
    failure ??= new Error('owned cleanup timeout');
    child?.kill('SIGKILL');
  }, 30000);
  try {
    if (page && !page.isClosed()) {
      for (const run of (await call('bootstrap')).runs)
        if (['QUEUED', 'RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING'].includes(run.state))
          await call('run.control', { id: run.id, action: 'cancel' });
      await wait(async () => {
        const b = await call('bootstrap');
        return !b.execution?.active && !b.runOverview.active && !b.runOverview.queued;
      }, 'own runs did not finish cleanup');
    }
    await app.close();
  } catch (error) {
    failure ??= error;
    child?.kill('SIGKILL');
  } finally {
    clearTimeout(watchdog);
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5000);
        child!.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    const closed = !child || child.exitCode !== null || child.signalCode !== null;
    evidence.processes.at(-1).closed = closed;
    app = undefined;
    page = undefined;
    if (!closed) throw new Error('own process still alive');
  }
}
try {
  await launch();
  await call('browser.embedded.enable');
  await call('browser.embedded.navigate', { url });
  await call('browser.embedded.visibility', { visible: false });
  const record = await call('flow.create');
  await call('flow.save', {
    flow: {
      ...record.flow,
      name: '新建文本文件验收',
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
          id: 'title',
          type: 'browser',
          version: 1,
          operation: 'read',
          selector: 'h1',
          value: null,
        },
        {
          id: 'save',
          type: 'file',
          version: 1,
          operation: 'write',
          binding: 'output',
          name: 'title.txt',
          content: 'old draft',
        },
      ],
    },
    bindings: { ...record.bindings, files: { output }, browserId: 'embedded' },
  });
  const openEditor = async () => {
    await button('我的流程').click();
    await button('编辑 新建文本文件验收').click();
    await page!.locator('.flow-shape[data-step-id="save"]').click();
  };
  await openEditor();
  const config = () => page!.getByRole('region', { name: '文件配置', exact: true });
  const label = (name: string) => config().getByLabel(name, { exact: true });
  await label('操作').selectOption('create');
  await button('撤销编辑').click();
  assert.equal(await label('操作').inputValue(), 'write');
  await button('重做编辑').click();
  assert.equal(await label('操作').inputValue(), 'create');
  await label('输出文件名').fill('title.txt');
  await label('写入内容类型').selectOption('number');
  await label('写入内容').fill('42');
  await button('保存').click();
  await page!.getByText(/Error: 新建文本文件的内容必须是文本/).waitFor();
  assert.equal(
    (await call('bootstrap')).flows.find((r: any) => r.id === record.id).flow.steps[2].operation,
    'write',
  );
  await label('写入内容类型').selectOption('string');
  await button('选择变量 · 写入内容').click();
  await label('写入内容变量来源').selectOption('steps.title');
  await button('使用变量 · 写入内容').click();
  await button('保存').click();
  await wait(
    async () =>
      (await call('bootstrap')).flows.find((r: any) => r.id === record.id).flow.steps[2]
        .operation === 'create',
    'create draft not saved',
  );
  const saved = (await call('bootstrap')).flows.find((r: any) => r.id === record.id);
  assert.ok(saved.flow.requiredCapabilities.includes('file-create-v1'));
  assert.deepEqual(saved.flow.steps[2].content, { $ref: 'steps.title' });
  assert.equal((await call('bootstrap')).runs.length, 0);
  await page!.evaluate(() => document.fonts.ready);
  await page!.screenshot({ path: 'test-results/figma/file-create-1440.png', scale: 'css' });
  evidence.checks.push(
    'operation-switch-undo-redo-invalid-text-blocked-reference-save-capability-no-run',
  );
  const preview = await call('flow.run.preview', { id: record.id });
  assert.equal(preview.ready, true, JSON.stringify(preview.checks));
  assert.equal(preview.resources.find((r: any) => r.id === 'directory:output').access, 'write');
  assert.match(
    preview.effects.find((e: any) => e.nodeId === 'save').detail,
    /新建文本文件.*不覆盖/,
  );
  const run = await call('flow.run.confirm', {
    id: record.id,
    token: preview.token,
    requestId: randomUUID(),
    reviewed: true,
  });
  await wait(
    async () =>
      ['SUCCEEDED', 'FAILED'].includes((await call('run.detail', { id: run.id })).run.state),
    'first run did not finish',
  );
  const first = await call('run.detail', { id: run.id });
  assert.equal(first.run.state, 'SUCCEEDED', first.run.error);
  assert.equal(first.artifacts.length, 1);
  assert.equal(first.artifacts[0].integrity, 'verified');
  assert.equal(await readFile(join(output, 'title.txt'), 'utf8'), title);
  assert.equal(await readFile(first.artifacts[0].path, 'utf8'), title);
  evidence.checks.push(
    'review-write-only-directory-real-embedded-page-read-worker-created-text-and-verified-artifact',
  );
  const again = await call('flow.run', { id: record.id });
  await wait(
    async () =>
      ['SUCCEEDED', 'FAILED'].includes((await call('run.detail', { id: again.id })).run.state),
    'duplicate run did not finish',
  );
  const second = await call('run.detail', { id: again.id });
  assert.equal(second.run.state, 'FAILED');
  assert.match(second.run.error, /已存在/);
  assert.equal(second.artifacts.length, 0);
  assert.equal(await readFile(join(output, 'title.txt'), 'utf8'), title);
  assert.equal((await call('bootstrap')).runs.length, 2);
  evidence.checks.push('explicit-repeat-preserves-original-text-no-artifact-no-automatic-retry');
  await openEditor();
  await label('已有同名文件时').selectOption('number');
  await button('撤销编辑').click();
  assert.equal(await label('已有同名文件时').inputValue(), 'error');
  await button('重做编辑').click();
  assert.equal(await label('已有同名文件时').inputValue(), 'number');
  await button('保存').click();
  await wait(
    async () =>
      (await call('bootstrap')).flows.find((r: any) => r.id === record.id).flow.steps[2].version ===
      4,
    'numbered policy not saved',
  );
  const numbered = (await call('bootstrap')).flows.find((r: any) => r.id === record.id);
  assert.equal(numbered.flow.steps[2].onConflict, 'number');
  assert.deepEqual(numbered.flow.steps[2].content, saved.flow.steps[2].content);
  assert.deepEqual(numbered.bindings, saved.bindings);
  assert.ok(numbered.flow.requiredCapabilities.includes('file-create-numbered-v1'));
  assert.equal((await call('bootstrap')).runs.length, 2);
  await label('已有同名文件时').scrollIntoViewIfNeeded();
  await page!.screenshot({ path: 'test-results/figma/file-numbered-1440.png', scale: 'css' });
  await writeFile(join(output, 'title (1).txt'), 'protected existing output');
  const numberedPreview = await call('flow.run.preview', { id: record.id });
  assert.equal(numberedPreview.ready, true, JSON.stringify(numberedPreview.checks));
  assert.match(numberedPreview.effects.find((e: any) => e.nodeId === 'save').detail, /自动加序号/);
  const numberedRun = await call('flow.run.confirm', {
    id: record.id,
    token: numberedPreview.token,
    requestId: randomUUID(),
    reviewed: true,
  });
  await wait(
    async () =>
      ['SUCCEEDED', 'FAILED'].includes(
        (await call('run.detail', { id: numberedRun.id })).run.state,
      ),
    'numbered run did not finish',
  );
  const numberedDetail = await call('run.detail', { id: numberedRun.id });
  assert.equal(numberedDetail.run.state, 'SUCCEEDED', numberedDetail.run.error);
  assert.equal(numberedDetail.artifacts.length, 1);
  assert.equal(numberedDetail.artifacts[0].name, 'title (2).txt');
  assert.equal(numberedDetail.artifacts[0].integrity, 'verified');
  assert.equal(await readFile(numberedDetail.artifacts[0].path, 'utf8'), title);
  assert.equal(await readFile(join(output, 'title (2).txt'), 'utf8'), title);
  assert.equal(await readFile(join(output, 'title.txt'), 'utf8'), title);
  assert.equal(await readFile(join(output, 'title (1).txt'), 'utf8'), 'protected existing output');
  assert.equal((await call('run.detail', { id: run.id })).snapshot.steps[2].version, 3);
  evidence.checks.push(
    'numbered-policy-undo-redo-save-real-worker-preserves-two-existing-files-reports-actual-name',
  );
  await closeOwned();
  if (failure) throw failure;
  await launch();
  await openEditor();
  assert.equal(await label('操作').inputValue(), 'create');
  assert.equal(await label('已有同名文件时').inputValue(), 'number');
  const reopened = (await call('bootstrap')).flows.find((r: any) => r.id === record.id);
  assert.deepEqual(reopened.flow, numbered.flow);
  const historical = await call('run.detail', { id: run.id });
  assert.equal(historical.run.state, 'SUCCEEDED');
  assert.equal(historical.artifacts[0].integrity, 'verified');
  assert.equal((await call('bootstrap')).runs.length, 3);
  const numberedHistory = await call('run.detail', { id: numberedRun.id });
  assert.equal(numberedHistory.artifacts[0].name, 'title (2).txt');
  assert.equal(numberedHistory.artifacts[0].integrity, 'verified');
  assert.deepEqual(errors, []);
  evidence.checks.push(
    'serial-process-reopen-preserves-configuration-and-historical-artifact-no-extra-run',
  );
  evidence.passed = true;
} catch (error) {
  failure = error;
  await page
    ?.screenshot({ path: 'test-results/figma/file-create-failure.png', scale: 'css' })
    .catch(() => {});
} finally {
  await closeOwned().catch((error) => (failure ??= error));
  await new Promise<void>((r) => server.close(() => r()));
  evidence.closed = evidence.processes.every((p: any) => p.closed);
  if (failure) {
    evidence.passed = false;
    evidence.error = String(failure);
  }
  await writeFile('test-results/figma/file-create-summary.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
if (failure) throw failure;
