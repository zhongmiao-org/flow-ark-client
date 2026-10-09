import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { desktopElectron as electron } from './desktop-session.mjs';
import { type ElectronApplication, type Page } from 'playwright-core';
import electronPath from 'electron';
import type { FlowRecord, Run, Step } from '../src/shared/types';
import { startFormLab } from './fixtures/platform-page';
import { formBrowser } from './fixtures/platform-flow';

// Real Vault IPC, Host, Worker, script SDK, persistence and embedded local form.
// The separately labelled Main encryption failure replaces only safeStorage's
// encrypt call; it is not an actual Keychain failure or a real provider request.
const data = await mkdtemp('/private/tmp/flowark-redaction-ui-');
const lab = await startFormLab();
const original = 'fictional-private-' + randomBytes(18).toString('hex');
const pending = 'fictional-pending-' + randomBytes(18).toString('hex');
const expectedHash = createHash('sha256').update(original).digest('hex');
const marker = 'sk-fictional-preflight-only';
const evidence: any = {
  passed: false,
  data,
  executable: process.env.FLOWARK_TEST_EXECUTABLE ?? null,
  checks: [],
  runs: [],
  exits: [],
  credentialProof: { sha256: expectedHash, length: original.length },
};
let app: ElectronApplication | undefined;
let page!: Page;
const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const wait = async (check: () => Promise<boolean>, label: string, timeout = 25000) => {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error('脱敏验收等待超时：' + label);
    await delay(60);
  }
};
const call = (method: string, args: any = {}): Promise<any> =>
  page.evaluate(({ method, args }) => window.flowark.request(method, args), { method, args });
const button = (name: string) => page.getByRole('button', { name, exact: true });
const output = () => page.getByRole('region', { name: '运行输出', exact: true });
const note = (name: string) => {
  evidence.checks.push(name);
  console.log(name);
};
const absent = (value: unknown, label: string, values = [original, pending]) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const value of values)
    assert.equal(text.includes(value), false, label + ' must not expose a fixture credential');
};
const executionCounts = () => {
  // Read only kind/count metadata; payloads remain owned by the real Host.
  const db = new DatabaseSync(join(data, 'flowark.sqlite'), { readOnly: true });
  try {
    return Object.fromEntries(
      ['run', 'snapshot', 'version'].map((kind) => [
        kind,
        Number(
          (db.prepare('SELECT COUNT(*) n FROM documents WHERE kind=?').get(kind) as { n: number })
            .n,
        ),
      ]),
    );
  } finally {
    db.close();
  }
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
  page.on('pageerror', (error) => (evidence.pageErrors ??= []).push(error.message));
  await page.waitForFunction(() => Boolean(window.flowark));
  const boot = await call('bootstrap');
  assert.ok(!boot.fault, boot.fault);
  assert.ok(!boot.runtimeBlock, boot.runtimeBlock);
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 700));
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
    assert.deepEqual(result, { code: 0, signal: null }, 'forced exit is not a passing quit');
  } finally {
    clearTimeout(timeout);
  }
};
const create = async (name: string, steps: Step[], credentials = ['deepseek'], browser = false) => {
  const record = await call('flow.create');
  const saved: FlowRecord = await call('flow.save', {
    flow: {
      ...record.flow,
      name,
      parameters: {},
      requiredCapabilities: ['script', 'value', 'assert', ...(browser ? ['browser'] : [])],
      steps,
    },
    bindings: { files: {}, credentials, ...(browser ? { browserId: 'embedded' } : {}) },
  });
  absent(saved.flow, 'stored flow source');
  return saved;
};
const run = async (id: string, debug = false): Promise<Run> => {
  const next = await call('flow.run', { id, debug });
  evidence.runs.push(next.id);
  return next;
};
const state = async (id: string, expected: string, nodeInstance?: string) => {
  let detail: any;
  await wait(
    async () => {
      detail = await call('run.detail', { id });
      if (
        detail.run.state !== expected &&
        ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(detail.run.state)
      )
        throw new Error('非预期终态：' + detail.run.state);
      return (
        detail.run.state === expected &&
        (!nodeInstance ||
          detail.events.filter((event: any) => event.type === 'debug-pause').at(-1)
            ?.nodeInstance === nodeInstance)
      );
    },
    id + ' -> ' + expected,
  );
  return detail;
};
const openRun = async (id: string) => {
  await button('运行记录').click();
  await page.getByRole('button', { name: /^(所有流程|已筛选流程)$/ }).click();
  await page.getByLabel('搜索运行记录', { exact: true }).fill(id);
  await button('应用筛选').click();
  await page.locator(`.run-history button[data-run-id="${id}"]`).click();
  await page.getByRole('region', { name: '运行概览', exact: true }).waitFor();
  await page.locator(`.run-detail-heading span[title="${id}"]`).waitFor();
};
const showSavedOutput = async (id: string) => {
  await openRun(id);
  await page.getByRole('tab', { name: '输出与产物', exact: true }).click();
  await output().locator('pre').waitFor();
  if (await output().getByRole('button', { name: '展开完整输出', exact: true }).count())
    await output().getByRole('button', { name: '展开完整输出', exact: true }).click();
  const displayed = JSON.parse(await output().locator('pre').innerText());
  absent(await page.locator('main').innerText(), 'Run detail UI');
  return displayed;
};
const verifyPayload = (payload: any) => {
  absent(payload, 'persisted SDK payload');
  assert.equal(payload.hash, expectedHash, 'credential RPC must return the original value');
  assert.equal(payload.length, original.length);
  assert.equal(Object.keys(payload.nested).length, 3, 'redacted keys must not discard entries');
  assert.deepEqual(Object.values(payload.nested).sort(), [
    'marker-a',
    'marker-b',
    'marker-reserved',
  ]);
  assert.deepEqual(payload.falsy, [false, 0, '', null]);
  assert.equal(payload.datum, '[REDACTED]');
};
const verifyDetail = (detail: any) => {
  absent(detail, 'saved Run detail and snapshot');
  verifyPayload(detail.output.inspect);
  const log = detail.events.find(
    (event: any) => event.type === 'log' && event.data?.value?.tag === 'redaction-sdk-log',
  );
  assert.ok(log, 'actual SDK logger event must be saved');
  verifyPayload(log.data.value.payload);
};
const code = `import { createHash } from 'node:crypto';
export default async ({ credential, logger, input }) => {
  const value = await credential('deepseek');
  const payload = {
    hash: createHash('sha256').update(value).digest('hex'),
    length: value.length,
    nested: { [value]: 'marker-a', ['prefix-' + value]: 'marker-b', '[REDACTED_KEY_1]': 'marker-reserved' },
    falsy: [false, 0, '', null],
    datum: value
  };
  logger.info({ tag: 'redaction-sdk-log', payload });
  if (input.fail) throw new Error('fictional-script-error ' + value);
  return payload;
}`;
const script = (fail = false): Step => ({
  id: 'inspect',
  name: '核对虚构凭据输出',
  type: 'script',
  version: 1,
  language: 'js',
  dependencies: [],
  code,
  input: { fail },
});
const nativeForm = () =>
  app!.evaluate(async ({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0].contentView
      .children[0] as Electron.WebContentsView;
    return view.webContents.executeJavaScript(
      `({width:innerWidth,name:document.querySelector('#fullName').value})`,
    );
  });
const restoreEncryption = async () => {
  if (!app) return;
  await app.evaluate(({ safeStorage }) => {
    const original = (globalThis as any).redactionEncryptOriginal;
    if (original) {
      safeStorage.encryptStringAsync = original;
      delete (globalThis as any).redactionEncryptOriginal;
    }
  });
};

try {
  await launch();
  await button('本地设置').click();
  await button('管理 DeepSeek').click();
  const keyInput = page.getByPlaceholder('输入 DeepSeek API Key', { exact: true });
  await keyInput.fill(original);
  await button('保存配置').click();
  await page.locator('.ai-saved-key').waitFor();
  assert.equal(await keyInput.count(), 0);
  assert.ok((await call('bootstrap')).credentials.includes('deepseek'));
  const ciphertext = await readFile(join(data, 'credentials', 'deepseek.enc'));
  assert.equal(ciphertext.includes(Buffer.from(original)), false);
  note('actual-vault-save-clears-input-and-keeps-plaintext-out-of-ciphertext');

  await button('返回本地设置').click();
  await button('打开网页面板').click();
  const normalFlow = await create(
    '脱敏：真实 SDK 与本地表单',
    [
      script(),
      formBrowser('open', 'navigate', '', lab.url),
      formBrowser('fill', 'fill', '#fullName', '虚构脱敏测试用户'),
      formBrowser('read', 'inputValue', '#fullName'),
      {
        id: 'verify',
        type: 'assert',
        version: 1,
        actual: { $ref: 'steps.read' },
        operator: 'equals',
        expected: '虚构脱敏测试用户',
      },
    ],
    ['deepseek'],
    true,
  );
  const ordinary = await run(normalFlow.id);
  const completed = await state(ordinary.id, 'SUCCEEDED');
  verifyDetail(completed);
  assert.deepEqual(await showSavedOutput(ordinary.id), completed.output);
  assert.deepEqual(await nativeForm(), { width: 1920, name: '虚构脱敏测试用户' });
  assert.equal(lab.state.attempts, 0);
  await output().screenshot({ path: join(data, 'saved-output.png') });
  await button('收起网页面板').click();
  note('sdk-original-hash-nested-keys-log-output-and-1920-form-without-submit');

  const debugFlow = await create('脱敏：逐步输出', [
    script(),
    { id: 'after', name: '核对后继续', type: 'value', version: 1, value: true },
  ]);
  const debug = await run(debugFlow.id, true);
  await state(debug.id, 'PAUSED', 'inspect');
  await openRun(debug.id);
  await button('执行下一步').click();
  const paused = await state(debug.id, 'PAUSED', 'after');
  absent(paused, 'debug detail');
  const preview = paused.events.find(
    (event: any) => event.nodeInstance === 'inspect' && event.data?.outputPreview,
  );
  assert.ok(preview, 'real script step must have a saved debug preview');
  verifyPayload(JSON.parse(preview.data.outputPreview));
  const stepOutput = page.getByRole('region', { name: '步骤输出', exact: true });
  await stepOutput.locator('pre').waitFor();
  verifyPayload(JSON.parse(await stepOutput.locator('pre').innerText()));
  absent(await page.locator('main').innerText(), 'debug UI');
  await button('继续').click();
  verifyDetail(await state(debug.id, 'SUCCEEDED'));
  note('real-debug-step-preview-and-final-output-hide-keys-without-changing-sdk-value');

  const failedFlow = await create('脱敏：脚本抛错', [script(true)]);
  const failed = await run(failedFlow.id);
  const failure = await state(failed.id, 'FAILED');
  absent(failure, 'failed Run');
  assert.match(failure.run.error, /fictional-script-error/);
  assert.match(failure.run.error, /\[REDACTED\]/);
  await openRun(failed.id);
  await wait(
    async () => (await page.locator('main').innerText()).includes('fictional-script-error'),
    '脚本错误展示',
  );
  absent(await page.locator('main').innerText(), 'script error UI');
  note('script-throw-remains-failed-with-readable-redacted-error');

  const rejectedFlow = await create(
    '脱敏：执行前拒绝',
    [{ id: 'never', type: 'value', version: 1, value: 'must-not-run' }],
    [marker],
  );
  const countsBeforeReject = executionCounts();
  // This is a real Host validation failure observed at the Renderer IPC caller.
  const capabilityError: string | null = await page.evaluate(
    async ({ flow, bindings, marker }: { flow: any; bindings: any; marker: string }) => {
      try {
        await window.flowark.request('flow.save', {
          flow: { ...flow, requiredCapabilities: [marker] },
          bindings,
        });
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    { flow: rejectedFlow.flow, bindings: rejectedFlow.bindings, marker } as {
      flow: any;
      bindings: any;
      marker: string;
    },
  );
  assert.equal(typeof capabilityError, 'string');
  assert.match(capabilityError!, /缺少能力/);
  assert.match(capabilityError!, /\[REDACTED\]/);
  absent(capabilityError, 'Host capability rejection', [marker]);
  await button('我的流程').click();
  await button('编辑 ' + rejectedFlow.flow.name).click();
  await button('运行').click();
  const rejectionAlert = page.getByRole('alert').filter({ hasText: '未配置凭据' });
  await rejectionAlert.waitFor();
  const preflightError = await rejectionAlert.innerText();
  assert.match(preflightError, /\[REDACTED\]/);
  absent(preflightError, 'Host preflight error UI', [marker]);
  assert.deepEqual(
    executionCounts(),
    countsBeforeReject,
    'rejection cannot create execution records',
  );
  evidence.hostRejections = { capabilityError, preflightError, counts: countsBeforeReject };
  await rejectionAlert.getByRole('button', { name: '关闭', exact: true }).click();
  note('host-validation-and-preflight-rejections-remain-errors-with-zero-execution-records');

  await button('本地设置').click();
  await button('管理 DeepSeek').click();
  await button('替换 Key').click();
  const replacementInput = page.getByPlaceholder('输入新 Key，留空则保留原 Key', { exact: true });
  await replacementInput.fill(pending);
  const countsBeforeVaultFailure = executionCounts();
  await app!.evaluate(({ safeStorage }, known) => {
    (globalThis as any).redactionEncryptOriginal = safeStorage.encryptStringAsync;
    safeStorage.encryptStringAsync = async (value: string) => {
      throw new Error('fictional-encrypt-failure pending=' + value + ' known=' + known);
    };
  }, original);
  try {
    await button('保存配置').click();
    const alert = page.getByRole('alert').filter({ hasText: '系统保护存储' });
    await alert.waitFor();
    const text = await alert.innerText();
    absent(text, 'Main Vault failure UI');
    assert.ok(!text.includes('fictional-encrypt-failure'));
    assert.equal(
      await replacementInput.inputValue(),
      pending,
      'failed save must retain typed value',
    );
    assert.deepEqual(await readFile(join(data, 'credentials', 'deepseek.enc')), ciphertext);
    assert.deepEqual(executionCounts(), countsBeforeVaultFailure);
    evidence.mainFailure = {
      boundary: 'safeStorage.encryptStringAsync rejection fixture only',
      text,
    };
    await alert.screenshot({ path: join(data, 'vault-failure.png') });
  } finally {
    await restoreEncryption();
  }
  await replacementInput.fill('');
  note('main-encryption-failure-masks-pending-and-known-values-preserves-input-and-old-vault');

  const beforeReopen = executionCounts();
  await gracefulQuit();
  await launch();
  assert.deepEqual(executionCounts(), beforeReopen, 'normal reopen must not replay a Run');
  assert.equal((await call('bootstrap')).execution.active, null);
  verifyDetail(await call('run.detail', { id: ordinary.id }));
  assert.deepEqual(await showSavedOutput(ordinary.id), completed.output);
  absent(await call('run.detail', { id: debug.id }), 'reopened debug history');
  const reopenedFailure = await call('run.detail', { id: failed.id });
  assert.equal(reopenedFailure.run.state, 'FAILED');
  absent(reopenedFailure, 'reopened error history');
  await openRun(failed.id);
  absent(await page.locator('main').innerText(), 'reopened error UI');
  // Explicit new execution proves failed replacement did not change the stored key.
  const renewed = await run(debugFlow.id);
  verifyDetail(await state(renewed.id, 'SUCCEEDED'));
  assert.equal(lab.state.attempts, 0);
  assert.deepEqual(evidence.pageErrors ?? [], []);
  note('normal-reopen-keeps-redacted-history-and-original-vault-without-replay');
  await gracefulQuit();
  evidence.passed = true;
} catch (error) {
  evidence.error = error instanceof Error ? error.stack : String(error);
  if (app && page) await page.screenshot({ path: join(data, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  if (app) {
    await restoreEncryption().catch((error) => (evidence.restoreError = String(error)));
    try {
      const boot = await call('bootstrap');
      for (const run of boot.runs as Run[])
        if (!['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(run.state))
          await call('run.control', { id: run.id, action: 'cancel' });
      await wait(async () => !(await call('bootstrap')).execution.active, '失败清理停止活动运行');
      await gracefulQuit();
    } catch (error) {
      evidence.cleanupError = String(error);
      await app?.close().catch(() => {});
    }
  }
  await lab.close();
  evidence.formAttempts = lab.state.attempts;
  await mkdir('test-results', { recursive: true });
  await writeFile(join(data, 'evidence.json'), JSON.stringify(evidence, null, 2));
  await writeFile('test-results/redaction.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
