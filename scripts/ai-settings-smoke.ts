import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import electronPath from 'electron';
import type { ElectronApplication, Page } from 'playwright-core';
import { desktopElectron, readDesktopMains } from './desktop-session.mjs';

// Only provider HTTP and explicitly identified fault cases are substituted.
// Real Renderer/Main/Host, OS protection, Store and Worker are exercised serially.
const evidence: any = {
  passed: false,
  checks: [],
  layouts: [],
  sessions: [],
  provider: 'local HTTP fixture; no real account request',
};
const data = await mkdtemp('/private/tmp/flowark-ai-settings-ui-');
const appPath = await mkdtemp(resolve('test-results/ai-settings-app-'));
const requests: { path: string; body: any }[] = [];
let mode: 'success' | 'hold' | 'authentication' | 'quota' | 'model' | 'output' = 'success';
let held: ServerResponse | undefined;
function respond(response: ServerResponse, deep: boolean) {
  response.setHeader('content-type', 'application/json');
  response.end(
    JSON.stringify(
      deep
        ? {
            id: 'fixture',
            model: 'fixture-returned-model',
            choices: [
              {
                finish_reason: 'stop',
                message: { content: JSON.stringify({ value: 'fictional-check' }) },
              },
            ],
          }
        : {
            id: 'fixture',
            model: 'fixture-returned-openai',
            status: 'completed',
            output: [
              {
                type: 'message',
                content: [
                  { type: 'output_text', text: JSON.stringify({ value: 'fictional-check' }) },
                ],
              },
            ],
          },
    ),
  );
}
const server = createServer(async (request, response) => {
  try {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ path: request.url!, body });
    assert.ok(String(request.headers.authorization).startsWith('Bearer fictional-'));
    if (mode === 'hold') {
      held = response;
      return;
    }
    if (['authentication', 'quota', 'model'].includes(mode)) {
      response.writeHead(
        { authentication: 401, quota: 429, model: 404 }[
          mode as 'authentication' | 'quota' | 'model'
        ],
      );
      response.end('provider raw body must not be exposed');
    } else if (mode === 'output') {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: 'malformed-json' } }],
        }),
      );
    } else respond(response, request.url === '/deepseek');
  } catch {
    response.writeHead(500).end();
  }
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${(server.address() as any).port}`;
await cp('dist', join(appPath, 'dist'), { recursive: true });
await cp('contracts', join(appPath, 'contracts'), { recursive: true });
await writeFile(
  join(appPath, 'package.json'),
  JSON.stringify({ name: 'flowark-ai-settings-fixture', version: '0.3.0', main: 'dist/main.cjs' }),
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
    js: `const actualFetch = globalThis.fetch; globalThis.fetch = (url, init) => {
    const paths = { 'https://api.deepseek.com/chat/completions': '/deepseek', 'https://api.openai.com/v1/responses': '/openai' };
    if (!paths[String(url)]) throw new Error('Unexpected AI fixture network');
    return actualFetch(${JSON.stringify(url)} + paths[String(url)], init);
  };`,
  },
});
let app: ElectronApplication | undefined;
let page!: Page;
const button = (name: string) => page.getByRole('button', { name, exact: true });
const call = (method: string, args: any = {}): Promise<any> =>
  page.evaluate(({ method, args }) => window.flowark.request(method, args), { method, args });
const config = (provider = 'deepseek') => call('ai.configuration.get', { provider });
const note = (name: string) => {
  evidence.checks.push(name);
  console.log('PASS ' + name);
};
async function wait(check: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(label);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
async function launch() {
  assert.equal(app, undefined);
  app = await desktopElectron.launch({
    executablePath: electronPath as unknown as string,
    args: [appPath],
    env: { ...process.env, FLOWARK_DATA_DIR: data },
  });
  evidence.sessions.push({ pid: app.process().pid, closed: false });
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => (evidence.pageErrors ??= []).push(error.message));
  await page.getByRole('heading', { name: '你想完成什么？' }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setTitle('FlowArk · AI 配置隔离验证（自动退出）'),
  );
  await page.evaluate(() => document.fonts.ready);
}
async function restoreProtection() {
  if (!app) return;
  await app.evaluate(({ safeStorage }) => {
    const original = (globalThis as any).aiProtection;
    if (original) {
      safeStorage.encryptStringAsync = original.encrypt;
      safeStorage.isAsyncEncryptionAvailable = original.available;
      delete (globalThis as any).aiProtection;
    }
  });
}
async function protectionFault(kind: 'encrypt' | 'availability') {
  await app!.evaluate(({ safeStorage }, kind) => {
    (globalThis as any).aiProtection = {
      encrypt: safeStorage.encryptStringAsync,
      available: safeStorage.isAsyncEncryptionAvailable,
    };
    if (kind === 'encrypt')
      safeStorage.encryptStringAsync = async (value: string) => {
        throw new Error('fault-must-remain-private ' + value);
      };
    else safeStorage.isAsyncEncryptionAvailable = async () => false;
  }, kind);
}
async function close() {
  if (!app) return;
  await restoreProtection();
  for (const provider of ['deepseek', 'openai-codex']) {
    const state = await config(provider);
    if (state.operation === 'testing')
      await call('ai.configuration.cancel', { provider, requestId: state.test.requestId });
  }
  for (const run of (await call('bootstrap')).runs)
    if (['QUEUED', 'RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING'].includes(run.state))
      await call('run.control', { id: run.id, action: 'cancel' });
  await wait(async () => !(await call('bootstrap')).execution.active, 'owned Worker still active');
  const child = app.process();
  await app.close();
  assert.equal(child.exitCode, 0);
  evidence.sessions.at(-1).closed = true;
  app = undefined;
  assert.deepEqual(readDesktopMains(), []);
}
async function openSettings(provider = 'DeepSeek') {
  await button('本地设置').click();
  await button('管理 ' + provider).click();
  await page.getByRole('heading', { name: provider, exact: true }).waitFor();
  await page.locator('.ai-provider-card').waitFor();
}
async function saved() {
  await page.locator('.ai-saved-key').waitFor();
}
async function capture(name: string, selector = '.ai-settings-columns') {
  for (const [width, height] of [
    [1440, 960],
    [1920, 1080],
    [1040, 700],
  ]) {
    await app!.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]),
      [width, height],
    );
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const layout = await page.evaluate((selector) => {
      const root = document.querySelector<HTMLElement>(selector)!;
      const r = root.getBoundingClientRect();
      return {
        bodyWidth: document.body.scrollWidth,
        viewport: innerWidth,
        root: { x: r.x, y: r.y, width: r.width, height: r.height },
        children: [...root.children].map((element) => {
          const r = element.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }),
      };
    }, selector);
    assert.ok(layout.bodyWidth <= layout.viewport, 'horizontal page overflow');
    if (selector === '.ai-missing-card') {
      assert.equal(layout.children[0].x, layout.root.x + 33, 'missing-resource card padding');
      assert.equal(layout.children[0].y, layout.root.y + 33, 'missing-resource top padding');
      assert.equal(layout.children[1].y - layout.children[0].y - layout.children[0].height, 24);
    }
    if (width === 1440 && selector === '.ai-settings-columns') {
      assert.equal(layout.children[0].x, 256);
      assert.equal(layout.children[1].x, 1008);
      assert.equal(Math.round(layout.children[0].width), 728);
      assert.equal(Math.round(layout.children[1].width), 400);
      assert.equal(layout.root.y, name === 'task-source' ? 230 : 294);
    }
    if (width === 1040 && selector === '.ai-settings-columns')
      assert.ok(
        layout.children[1].y > layout.children[0].y + layout.children[0].height,
        'compact settings cards must stack',
      );
    evidence.layouts.push({ name, width, height, ...layout });
    await page.screenshot({ path: join(data, `${name}-${width}.png`) });
  }
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
}
let failure: unknown;
try {
  await launch();
  await openSettings();
  assert.equal((await config()).configured, false);
  await page.getByPlaceholder('输入 DeepSeek API Key').fill('fictional-ai-settings-key-R9Q4');
  await button('保存配置').click();
  await saved();
  let current = await config();
  assert.equal(current.tail, 'R9Q4');
  assert.equal(current.test, null);
  assert.equal(requests.length, 0);
  assert.equal(await page.locator('.ai-settings-page input[type=password]').count(), 0);
  assert.ok(
    !(await readFile(join(data, 'credentials/deepseek.enc'))).includes(
      Buffer.from('fictional-ai-settings'),
    ),
  );
  assert.ok(!(await page.locator('body').innerText()).includes('fictional-ai-settings'));
  await capture('saved');
  note('save uses real protected storage, clears input and sends no HTTP or Run');

  mode = 'hold';
  await button('测试连接').click();
  await wait(async () => !!held, 'HTTP did not begin');
  assert.equal(await button('替换 Key').isEnabled(), false);
  await button('← 返回本地设置').click();
  await page.getByRole('dialog').waitFor();
  await button('继续等待').click();
  await button('取消测试').click();
  await page.getByRole('status').filter({ hasText: '测试已取消' }).waitFor();
  assert.equal((await config()).operation, null);
  respond(held!, true);
  held = undefined;
  assert.equal((await config()).test.status, 'cancelled');
  assert.equal(requests.length, 1);
  mode = 'success';
  await button('测试连接').click();
  await page.getByRole('status').filter({ hasText: '连接已验证' }).waitFor();
  current = await config();
  assert.equal(current.test.model, 'fixture-returned-model');
  assert.deepEqual(JSON.parse(requests.at(-1)!.body.messages[1].content), {
    value: 'fictional-check',
  });
  assert.equal(requests.at(-1)!.body.model, 'deepseek-flash');
  assert.equal((await call('bootstrap')).runs.length, 0);
  await page.screenshot({ path: join(data, 'verified-1440.png') });
  await close();
  await launch();
  await openSettings();
  assert.equal((await config()).test.status, 'passed');
  assert.equal(requests.length, 2);
  note('explicit fixed-content test, cancellation, actual model and offline reopen');

  for (const [nextMode, code] of [
    ['authentication', 'authentication'],
    ['quota', 'quota'],
    ['model', 'request'],
    ['output', 'output'],
  ] as const) {
    mode = nextMode;
    await button((await config()).test.status === 'passed' ? '重新测试' : '测试连接').click();
    await wait(async () => (await config()).test?.code === code, 'failure classification ' + code);
    await page.getByRole('status').filter({ hasText: '连接失败' }).waitFor();
    assert.equal((await config()).tail, 'R9Q4');
    assert.ok(!(await page.locator('body').innerText()).includes('provider raw body'));
  }
  await button('返回本地设置').click();
  await page.getByText('已配置 · 连接失败', { exact: true }).waitFor();
  await button('管理 DeepSeek').click();
  await saved();
  note(
    'authentication, quota, model and output failures retain Key and remain visible in settings overview',
  );

  await button('替换 Key').click();
  const replacement = page.getByPlaceholder('输入新 Key，留空则保留原 Key');
  assert.equal(await replacement.inputValue(), '');
  await page
    .locator('.ai-settings-page')
    .getByLabel('模型 ID', { exact: true })
    .fill('fixture-edited-model');
  await button('保存配置').click();
  await saved();
  current = await config();
  assert.equal(current.test, null);
  assert.equal(current.tail, 'R9Q4');
  await button('替换 Key').click();
  await replacement.fill('fictional-unsaved-key-8H1L');
  const beforeFailure = await readFile(join(data, 'credentials/deepseek.enc'));
  await protectionFault('encrypt');
  await button('保存配置').click();
  await page.getByRole('alert').filter({ hasText: '系统保护存储' }).waitFor();
  assert.equal(await replacement.inputValue(), 'fictional-unsaved-key-8H1L');
  assert.deepEqual(await readFile(join(data, 'credentials/deepseek.enc')), beforeFailure);
  assert.ok(!(await page.locator('body').innerText()).includes('fault-must-remain-private'));
  await restoreProtection();
  await button('取消').click();
  await button('继续编辑').click();
  assert.equal(await replacement.inputValue(), 'fictional-unsaved-key-8H1L');
  await button('取消').click();
  await button('不保存离开').click();
  await saved();
  assert.equal((await config()).revision, current.revision);
  await button('替换 Key').click();
  await replacement.fill('fictional-navigation-save-6F2A');
  await button('我的流程').click();
  await button('保存并离开').click();
  await page.getByRole('heading', { name: '从第一个流程开始', exact: true }).waitFor();
  assert.equal((await config()).tail, '6F2A');
  note(
    'blank replacement retains Key; failed writes retain input; all three leave choices preserve the chosen outcome',
  );

  await openSettings('OpenAI');
  await page.getByPlaceholder('输入 OpenAI API Key').fill('fictional-openai-key-5B3C');
  await button('保存配置').click();
  await saved();
  mode = 'success';
  await button('测试连接').click();
  await page.getByRole('status').filter({ hasText: '连接已验证' }).waitFor();
  assert.equal(requests.at(-1)!.path, '/openai');
  assert.equal(requests.at(-1)!.body.store, false);
  assert.deepEqual(JSON.parse(requests.at(-1)!.body.input), { value: 'fictional-check' });
  assert.equal((await config('openai-codex')).test.model, 'fixture-returned-openai');
  const otherCipher = await readFile(join(data, 'credentials/openai-codex.enc'));
  await openSettings();
  const flow = await call('flow.create');
  await call('flow.save', {
    flow: {
      ...flow.flow,
      steps: [{ id: 'hold', type: 'human', version: 1, message: 'fixture wait' }],
    },
    bindings: { files: {}, credentials: ['deepseek'] },
  });
  const run = await call('flow.run', { id: flow.id });
  await wait(
    async () => (await call('run.detail', { id: run.id })).run.state === 'WAITING_INPUT',
    'Worker wait',
  );
  await openSettings();
  assert.equal(await button('移除配置').isEnabled(), false);
  assert.equal(await button('替换 Key').isEnabled(), false);
  await call('run.control', { id: run.id, action: 'cancel' });
  await wait(async () => await button('移除配置').isEnabled(), 'resource not released');
  await button('移除配置').click();
  await page.getByRole('dialog').waitFor();
  await protectionFault('availability');
  await button('确认移除').click();
  await page.getByRole('alert').filter({ hasText: '系统保护存储' }).waitFor();
  await restoreProtection();
  assert.equal((await config()).configured, true);
  await button('移除配置').click();
  await button('确认移除').click();
  await page.getByPlaceholder('输入 DeepSeek API Key').waitFor();
  assert.equal((await config()).configured, false);
  assert.deepEqual(await readFile(join(data, 'credentials/openai-codex.enc')), otherCipher);
  note(
    'OpenAI Responses shape, real Worker resource protection, failed removal and provider isolation',
  );

  await button('开始任务').click();
  await page.getByLabel('你想完成的任务').fill('核对配置返回，保留虚构任务资料。');
  await button('开始规划').click();
  await button('附加文本资料').click();
  await page.getByLabel('资料 1 名称').fill('原任务资料');
  await page.getByLabel('资料 1 内容').fill('只在原任务使用的虚构输入');
  await page.locator('.task-understanding-provider > summary').click();
  await page.locator('.ai-task-provider input').fill('fixture-source-model');
  await button('配置 AI 服务').click();
  await page.locator('.ai-missing-card').waitFor();
  await capture('missing-ai', '.ai-missing-card');
  const task = (await call('task.list'))[0];
  const originalTask = (await call('task.detail', { id: task.id })).task;
  await button('去配置 AI 服务').click();
  await page.getByPlaceholder('输入 DeepSeek API Key').waitFor();
  assert.equal(
    await page.locator('.ai-settings-page').getByLabel('模型 ID').inputValue(),
    'fixture-source-model',
  );
  await page.getByPlaceholder('输入 DeepSeek API Key').fill('fictional-task-source-key-D1E2');
  await page.locator('.ai-settings-page').getByLabel('模型 ID').fill('fixture-source-saved-model');
  const beforeSource = requests.length;
  await button('保存配置').click();
  await saved();
  await capture('task-source');
  await button('← 返回原任务').click();
  assert.equal(
    await page.getByLabel('你的需求', { exact: true }).inputValue(),
    originalTask.description,
  );
  assert.equal(await page.getByLabel('资料 1 内容').inputValue(), '只在原任务使用的虚构输入');
  assert.equal(
    await page.locator('.ai-task-provider input').inputValue(),
    'fixture-source-saved-model',
  );
  assert.equal(await button('理解我的任务').isEnabled(), false);
  assert.equal(requests.length, beforeSource);
  assert.deepEqual((await call('task.detail', { id: task.id })).task.context, originalTask.context);
  assert.equal((await call('bootstrap')).runs.length, 1);
  note(
    'missing AI and task-source three-size layouts retain task context and saved model with no generation or automatic Run',
  );
  assert.deepEqual(evidence.pageErrors ?? [], []);
  await close();
  evidence.passed = true;
} catch (error) {
  failure = error;
  evidence.error = String(error);
  if (app) await page!.screenshot({ path: join(data, 'failure.png') }).catch(() => {});
} finally {
  try {
    await close();
  } catch (error) {
    evidence.closeError = String(error);
    evidence.passed = false;
  }
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  evidence.dataPath = data;
  evidence.requests = requests;
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/ai-settings.json', JSON.stringify(evidence, null, 2));
}
if (failure) throw failure;
assert.equal(evidence.passed, true, evidence.closeError);
console.log(
  JSON.stringify({
    passed: evidence.passed,
    checks: evidence.checks.length,
    sessions: evidence.sessions,
    dataPath: data,
  }),
);
