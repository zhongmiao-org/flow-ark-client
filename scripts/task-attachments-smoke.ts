import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { desktopElectron as electron } from './desktop-session.mjs';
import { type ElectronApplication, type Page } from 'playwright-core';
import electronPath from 'electron';
import { build } from 'esbuild';

const data = await mkdtemp(join(tmpdir(), 'flowark-attachment-ui-'));
const appPath = await mkdtemp(join(process.cwd(), 'test-results/attachment-app-'));
const textFile = join(data, '已选资料.txt'),
  picture = join(data, '目标截图.png'),
  corrupt = join(data, '损坏图片.png');
const selectedText = '这是明确选择的附件正文。\n只供规划参考，不是执行授权。';
await writeFile(textFile, selectedText);
const requests: any[] = [];
const server = createServer(async (req, res) => {
  try {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const parts = body.messages[1].content;
    const input = JSON.parse(Array.isArray(parts) ? parts[0].text : parts).request;
    requests.push({ input, parts });
    const result = {
      formatVersion: '1.0',
      kind: 'clarify',
      summary: '已收到所选资料和目标图片，请确认下一步。',
      questions: [{ id: 'format', prompt: '需要怎样整理？', options: ['保留要点', '逐项列出'] }],
      limitations: [],
      flow: null,
    };
    res.setHeader('Content-Type', 'application/json');
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
  } catch (e) {
    res.statusCode = 500;
    res.end('fixture rejected request');
  }
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(server.address() as any).port}/model`;
await cp('dist', join(appPath, 'dist'), { recursive: true });
await cp('contracts', join(appPath, 'contracts'), { recursive: true });
await writeFile(
  join(appPath, 'package.json'),
  JSON.stringify({ name: 'flowark-attachments-fixture', version: '0.3.0', main: 'dist/main.cjs' }),
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
    js: `const actualFetch = globalThis.fetch; globalThis.fetch = (url, init) => { if (String(url) !== 'https://api.deepseek.com/chat/completions') throw new Error('unexpected provider'); return actualFetch(${JSON.stringify(url)}, init); };`,
  },
});
const evidence: any = {
  passed: false,
  closed: false,
  data,
  layouts: [],
  processes: [],
  checks: [],
  provider: 'local HTTP fixture',
  picker: 'isolated Main showOpenDialog result fixture; real image decoder',
};
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
    await new Promise((r) => setTimeout(r, 70));
  }
}
async function launch() {
  assert.ok(!child || child.exitCode !== null || child.signalCode !== null);
  const existing = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
    .split('\n')
    .filter((line) =>
      /^\s*\d+\s+\/.*\/(?:FlowArk|Electron)\.app\/Contents\/MacOS\/(?:FlowArk|Electron)(?:\s|$)/.test(
        line,
      ),
    );
  assert.deepEqual(existing, [], 'existing desktop main must exit before testing');
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
    win.setTitle('FlowArk · 附件隔离验证（自动退出）');
  });
}
async function closeOwned() {
  if (!app) return;
  const owned = app,
    process = child!;
  const watchdog = setTimeout(() => {
    failure ??= new Error('cleanup timed out');
    process.kill('SIGKILL');
  }, 30000);
  try {
    for (const task of await call('task.list')) await call('task.cancel', { id: task.id });
    for (const run of (await call('bootstrap')).runs)
      if (['QUEUED', 'RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING'].includes(run.state))
        await call('run.control', { id: run.id, action: 'cancel' });
    await wait(async () => {
      const b = await call('bootstrap');
      return !b.execution.active && !b.runOverview.queued;
    }, 'owned runs did not exit');
    await owned.close();
  } catch (e) {
    failure ??= e;
    process.kill('SIGKILL');
  } finally {
    clearTimeout(watchdog);
    if (process.exitCode === null && process.signalCode === null) {
      process.kill('SIGKILL');
      await new Promise<void>((r) => {
        const timeout = setTimeout(r, 5000);
        process.once('exit', () => {
          clearTimeout(timeout);
          r();
        });
      });
    }
    evidence.processes.at(-1).closed = process.exitCode !== null || process.signalCode !== null;
    app = undefined;
    page = undefined;
    assert.ok(evidence.processes.at(-1).closed, 'owned main must actually exit');
  }
}
async function choose(name: string, file: string | null, expectedError = false) {
  await app!.evaluate(({ dialog }: any, file) => {
    dialog.showOpenDialog = async (_win: unknown, options: any) => {
      if (
        !['选择任务附件', '选择目标截图'].includes(options.title) ||
        JSON.stringify(options.properties) !== '["openFile"]'
      )
        throw new Error('unexpected picker');
      return { canceled: file === null, filePaths: file === null ? [] : [file] };
    };
  }, file);
  await button(name).click();
  await wait(async () => !(await button('附加文件').isDisabled()), 'picker did not settle');
  if (!expectedError)
    assert.equal(await page!.getByRole('alert').count(), 0, 'unexpected picker error');
}
try {
  await mkdir('test-results/figma', { recursive: true });
  await launch();
  await page!.screenshot({ path: picture, scale: 'css' });
  await writeFile(corrupt, (await readFile(picture)).subarray(0, 40));
  await page!.getByLabel('你想完成的任务').fill('根据我选中的文本和截图整理步骤');
  await button('开始规划').click();
  await button('保存任务草稿').waitFor();
  const taskId = (await call('task.list'))[0].id;
  const detail = () => call('task.detail', { id: taskId });
  const original = await detail();
  await choose('附加文件', null);
  assert.deepEqual(await detail(), original);
  assert.equal(requests.length, 0);
  await choose('附加文件', textFile);
  await button('预览 已选资料.txt').waitFor();
  await writeFile(textFile, '原文件已改变');
  await button('预览 已选资料.txt').click();
  assert.equal(await page!.getByLabel('附件预览').locator('pre').innerText(), selectedText);
  await button('关闭附件预览').click();
  await choose('目标截图', corrupt, true);
  await page!.getByRole('alert').filter({ hasText: '解码' }).waitFor();
  assert.equal((await detail()).task.attachments.length, 1);
  await button('关闭').click();
  await choose('目标截图', picture);
  await button('预览 目标截图.png').waitFor();
  await button('预览 目标截图.png').click();
  await wait(
    async () =>
      page!
        .getByLabel('附件预览')
        .locator('img')
        .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 1440),
    'real image preview missing',
  );
  await button('关闭附件预览').click();
  evidence.checks.push(
    'native-picker-cancel-text-immutable-copy-real-main-image-decode-corruption-rejected-preview-no-network',
  );
  for (const [width, height] of [
    [1440, 1080],
    [1280, 900],
    [1040, 700],
  ]) {
    await app!.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]),
      [width, height],
    );
    await page!.locator('main').evaluate((e) => e.scrollTo(0, 0));
    const layout = await page!.locator('.task-brief-columns').evaluate((e) => ({
      width: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth || e.scrollWidth > e.clientWidth,
      columns: [...e.children].map((c) => {
        const r = c.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    }));
    assert.equal(layout.overflow, false);
    if (width === 1440) {
      assert.equal(layout.columns[0].width, 470);
      assert.equal(layout.columns[1].width, 658);
      assert.equal(layout.columns[0].y, 230);
    }
    evidence.layouts.push(layout);
    await page!.screenshot({ path: `test-results/figma/attachments-${width}.png`, scale: 'css' });
  }
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1080));
  await button('理解与输出位置').click();
  await page!.getByRole('heading', { name: '任务理解卡', exact: true }).waitFor();
  assert.match(
    await page!.locator('.task-understanding-summary').innerText(),
    /已选资料.txt.*目标截图.png/s,
  );
  await button('理解不对，重新描述').click();
  await button('移除附件 目标截图.png').click();
  await wait(async () => (await detail()).task.attachments.length === 1, 'image not removed');
  assert.ok((await readFile(picture)).length > 40);
  await choose('目标截图', picture);
  const expectedImage = (await readFile(picture)).toString('base64');
  await rm(picture);
  await call('credentials.set', { id: 'deepseek', value: 'sk-local-attachments-fixture' });
  await page!.getByText('查看本次发送给 DeepSeek 的内容', { exact: true }).click();
  const disclosure = await page!.locator('.ai-task-disclosure').innerText();
  assert.match(disclosure, /已选资料.txt/);
  assert.match(disclosure, /目标截图.png/);
  assert.ok(!disclosure.includes(data));
  await page!.getByRole('checkbox', { name: '我已核对本次内容，将发送给 DeepSeek' }).check();
  await button('理解我的任务').click();
  await page!.getByRole('heading', { name: '任务理解卡', exact: true }).waitFor();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].input.context.length, 2);
  assert.equal(requests[0].input.context.find((c: any) => c.kind === 'file').text, selectedText);
  assert.equal(
    requests[0].parts.find((c: any) => c.type === 'image_url').image_url.url,
    `data:image/png;base64,${expectedImage}`,
  );
  assert.ok(!JSON.stringify(requests).includes(data));
  assert.equal((await call('bootstrap')).runs.length, 0);
  evidence.checks.push(
    'three-layouts-understanding-return-remove-reselect-disclosure-selected-text-and-real-image-body-no-path-no-run',
  );
  await closeOwned();
  await launch();
  await page!
    .locator('.ai-task-recents button')
    .filter({ hasText: '根据我选中的文本和截图整理步骤' })
    .click();
  await button('理解不对，重新描述').click();
  await button('预览 目标截图.png').click();
  await page!.getByLabel('附件预览').locator('img').waitFor();
  assert.equal(requests.length, 1);
  assert.equal((await detail()).task.attachments.length, 2);
  await button('关闭附件预览').click();
  await button('移除附件 已选资料.txt').click();
  assert.equal(await readFile(textFile, 'utf8'), '原文件已改变');
  await wait(async () => (await detail()).task.attachments.length === 1, 'text not removed');
  evidence.checks.push(
    'serial-reopen-keeps-verified-copies-with-missing-originals-no-model-replay-remove-keeps-original-file',
  );
  evidence.passed = true;
} catch (e) {
  failure = e;
  if (page)
    await page.screenshot({ path: 'test-results/figma/attachments-failure.png' }).catch(() => {});
} finally {
  await closeOwned();
  await new Promise<void>((r) => server.close(() => r()));
  evidence.errors = errors;
  evidence.closed = evidence.processes.every((p: any) => p.closed);
  evidence.passed &&= !failure && !errors.length && evidence.closed;
  if (failure) evidence.failure = String(failure);
  await writeFile('test-results/figma/attachments-summary.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
if (failure) throw failure;
assert.equal(evidence.passed, true);
