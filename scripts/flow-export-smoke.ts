import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startFormLab } from './fixtures/form-lab';
import { packageFlow, validateTemplate } from '../src/recruiting/templates';
import type { FlowRecord, Template } from '../src/shared/types';

const data = await mkdtemp('/private/tmp/flowark-export-ui-');
const lab = await startFormLab();
const app = await electron.launch({
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
const evidence: any = { passed: false, data, checks: [] };
const note = (check: string) => {
  evidence.checks.push(check);
  console.log(check);
};
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.flowark);
  const call = (method: string, args: any = {}): Promise<any> =>
    page.evaluate(({ method, args }) => window.flowark.request(method, args), { method, args });
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const label = (name: string) => page.getByLabel(name, { exact: true });
  const wait = async (check: () => Promise<boolean>, message: string) => {
    const end = Date.now() + 20000;
    while (!(await check())) {
      if (Date.now() > end) throw new Error('导出验收超时：' + message);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
  await button('打开网页面板').click();
  await label('网页地址').fill(lab.url);
  await button('访问网页').click();
  await wait(
    async () => (await call('browser.embedded.status')).url === new URL(lab.url).href,
    '内置本地表单',
  );
  assert.equal(
    await app.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView
        .children[0] as Electron.WebContentsView;
      return view.webContents.executeJavaScript('innerWidth');
    }),
    1920,
  );
  const created: FlowRecord = await call('flow.create');
  const configuration = {
    adapter: 'flow-parameters-v1',
    schema: {
      type: 'object',
      properties: { privateValue: { type: 'string', default: 'public default' } },
      required: ['privateValue'],
      additionalProperties: false,
    },
    values: { privateValue: 'FICTIONAL_PRIVATE_PARAMETER' },
  };
  const saved: FlowRecord = await call('flow.save', {
    flow: {
      ...created.flow,
      name: '虚构草稿导出验收',
      parameters: configuration.values,
      requiredCapabilities: ['value'],
      steps: [{ id: 'value', type: 'value', version: 1, value: 'FICTIONAL_PRIVATE_LITERAL' }],
    },
    bindings: {
      browserId: 'embedded',
      files: { work: data },
      credentials: ['deepseek'],
      scriptPackages: { 'fictional-package': { path: data, version: '1.0.0' } },
      configuration,
    },
  });
  const stored = async (): Promise<FlowRecord> =>
    (await call('bootstrap')).flows.find((record: FlowRecord) => record.id === saved.id);
  await button('编辑 ' + saved.flow.name).click();
  const node = page.locator('.react-flow__node[data-id="value"]');
  await node.focus();
  await node.click();
  assert.equal(await label('数据值').inputValue(), 'FICTIONAL_PRIVATE_LITERAL');
  await label('数据值').fill('REDACTED_CURRENT_DRAFT');

  // Dialog replies and selected paths are injected only into this isolated test app.
  // The UI, IPC validation, host export/import and filesystem writes remain real.
  await app.evaluate(({ dialog }) => {
    const fixture: any = {
      review: 'cancel',
      saveCanceled: true,
      path: '',
      openPath: '',
      reviews: 0,
      saves: 0,
      imports: 0,
      resolveReview: null,
      originalReview: dialog.showMessageBox,
      originalSave: dialog.showSaveDialog,
      originalOpen: dialog.showOpenDialog,
    };
    (globalThis as any).flowExportDialogs = fixture;
    dialog.showMessageBox = (async (...args: any[]) => {
      const options = args.at(-1);
      if (options.message === '确认已审阅流程中的字面量与脚本') {
        fixture.reviews++;
        if (fixture.review === 'hold')
          return new Promise((resolve) => {
            fixture.resolveReview = resolve;
          });
        return { response: fixture.review === 'accept' ? 1 : 0, checkboxChecked: false };
      }
      if (options.message === '确认模板来源可信') {
        fixture.imports++;
        return { response: 1, checkboxChecked: false };
      }
      return fixture.originalReview(...args);
    }) as typeof dialog.showMessageBox;
    dialog.showSaveDialog = (async () => {
      fixture.saves++;
      return { canceled: fixture.saveCanceled, filePath: fixture.path };
    }) as typeof dialog.showSaveDialog;
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [fixture.openPath],
    })) as typeof dialog.showOpenDialog;
  });
  const configure = (values: Record<string, unknown>) =>
    app.evaluate((_electron, values) => {
      Object.assign((globalThis as any).flowExportDialogs, values);
    }, values);
  const counts = () =>
    app.evaluate(() => {
      const f = (globalThis as any).flowExportDialogs;
      return { reviews: f.reviews, saves: f.saves, imports: f.imports, held: !!f.resolveReview };
    });
  const clickExport = async () => {
    const before = await counts();
    await button('导出').click();
    await wait(async () => (await counts()).reviews === before.reviews + 1, '审阅确认');
    await wait(async () => await button('导出').isEnabled(), '导出完成或取消');
  };
  const noFile = async (path: string) => assert.rejects(access(path), { code: 'ENOENT' });
  const cancelledReview = join(data, 'cancel-review.json');
  await configure({ path: cancelledReview, review: 'cancel', saveCanceled: false });
  await clickExport();
  assert.equal((await counts()).saves, 0);
  await noFile(cancelledReview);
  assert.deepEqual(await stored(), saved);
  const cancelledSave = join(data, 'cancel-save.json');
  await configure({ path: cancelledSave, review: 'accept', saveCanceled: true });
  await clickExport();
  assert.equal((await counts()).saves, 1);
  await noFile(cancelledSave);
  assert.deepEqual(await stored(), saved);
  assert.equal(await label('数据值').inputValue(), 'REDACTED_CURRENT_DRAFT');
  note('cancel-review-and-save-preserve-database-draft-and-write-no-file');

  const firstPath = join(data, 'current-draft.json');
  await configure({ path: firstPath, review: 'accept', saveCanceled: false });
  await clickExport();
  const first: Template = validateTemplate(JSON.parse(await readFile(firstPath, 'utf8')));
  assert.equal((first.flow.steps[0] as any).value, 'REDACTED_CURRENT_DRAFT');
  assert.deepEqual(first.flow.parameters, { privateValue: null });
  for (const excluded of ['FICTIONAL_PRIVATE_', data, 'deepseek', 'scriptPackages', 'browserId'])
    assert.ok(!JSON.stringify(first).includes(excluded), excluded);
  assert.deepEqual(await stored(), saved);
  assert.equal(first.manifest.version, '0.0.0-local.sha256-' + first.manifest.digest);
  const repeatedPath = join(data, 'repeat.json');
  await configure({ path: repeatedPath });
  await clickExport();
  assert.equal(
    JSON.parse(await readFile(repeatedPath, 'utf8')).manifest.version,
    first.manifest.version,
  );
  note('unsaved-reviewed-literal-exported-without-private-bindings-and-repeat-version-stable');

  const reviewsBeforeInvalid = (await counts()).reviews;
  await label('数据值类型').selectOption('number');
  await label('数据值').fill('-');
  await button('导出').click();
  await page.getByText('请先修正未完成的值配置，再导出', { exact: true }).waitFor();
  await wait(async () => await button('导出').isEnabled(), '无效值拒绝');
  assert.equal((await counts()).reviews, reviewsBeforeInvalid);
  assert.deepEqual(await stored(), saved);
  await label('数据值类型').selectOption('string');
  await label('数据值').fill('FROZEN_AT_EXPORT_CLICK');
  note('unfinished-value-rejected-before-opening-dialog');

  const frozenPath = join(data, 'frozen.json');
  await configure({ path: frozenPath, review: 'hold' });
  await button('导出').click();
  await wait(async () => (await counts()).held, '固定快照等待确认');
  await label('数据值').fill('EDITED_AFTER_EXPORT_CLICK');
  const concurrent = structuredClone(saved);
  concurrent.flow.steps = [
    { id: 'value', type: 'value', version: 1, value: 'SAVED_DURING_REVIEW' },
  ];
  const concurrentSaved = await call('flow.save', {
    flow: concurrent.flow,
    bindings: concurrent.bindings,
  });
  await app.evaluate(() => {
    const f = (globalThis as any).flowExportDialogs;
    f.resolveReview({ response: 1, checkboxChecked: false });
    f.resolveReview = null;
  });
  await wait(async () => await button('导出').isEnabled(), '固定快照保存');
  const frozen: Template = validateTemplate(JSON.parse(await readFile(frozenPath, 'utf8')));
  assert.equal((frozen.flow.steps[0] as any).value, 'FROZEN_AT_EXPORT_CLICK');
  assert.notEqual(frozen.manifest.version, first.manifest.version);
  assert.deepEqual(await stored(), concurrentSaved);
  assert.equal(await label('数据值').inputValue(), 'EDITED_AFTER_EXPORT_CLICK');
  const latestPath = join(data, 'latest.json');
  await configure({ path: latestPath, review: 'accept' });
  await clickExport();
  const latest: Template = validateTemplate(JSON.parse(await readFile(latestPath, 'utf8')));
  assert.equal((latest.flow.steps[0] as any).value, 'EDITED_AFTER_EXPORT_CLICK');
  assert.notEqual(latest.manifest.version, frozen.manifest.version);
  assert.deepEqual(await stored(), concurrentSaved);
  note('pending-review-keeps-click-time-snapshot-despite-editor-and-database-changes');

  await button('我的流程').click();
  const beforeImport = await call('bootstrap');
  await configure({ openPath: firstPath });
  await button('导入').click();
  await wait(
    async () => (await call('bootstrap')).flows.length === beforeImport.flows.length + 1,
    '导入当前包',
  );
  let boot = await call('bootstrap');
  const imported: FlowRecord = boot.flows.find(
    (record: FlowRecord) =>
      record.id !== saved.id && record.flow.sourceTemplate?.digest === first.manifest.digest,
  );
  assert.ok(imported);
  assert.deepEqual(imported.bindings.files, {});
  assert.deepEqual(imported.bindings.credentials, []);
  assert.equal(imported.bindings.browserId, undefined);
  assert.equal(imported.bindings.scriptPackages, undefined);
  assert.deepEqual(imported.bindings.configuration?.values, { privateValue: 'public default' });
  assert.deepEqual(await stored(), concurrentSaved);

  const legacyPath = join(data, 'legacy.json');
  const legacy = packageFlow(
    {
      ...first.flow,
      name: '虚构旧模板',
      steps: [
        {
          id: 'script',
          type: 'script',
          version: 1,
          language: 'js',
          input: null,
          dependencies: [],
          code: 'export default async () => { throw new Error("MUST_NOT_EXECUTE"); };',
        },
      ],
    },
    'local',
    undefined,
    '1.1.0',
  );
  await writeFile(legacyPath, JSON.stringify(legacy));
  await configure({ openPath: legacyPath });
  await button('导入').click();
  await wait(
    async () => (await call('bootstrap')).flows.length === beforeImport.flows.length + 2,
    '导入旧包',
  );
  boot = await call('bootstrap');
  const legacyImported: FlowRecord = boot.flows.find(
    (record: FlowRecord) => record.flow.name === '虚构旧模板',
  );
  assert.equal(legacyImported.flow.sourceTemplate?.version, '1.1.0');
  assert.deepEqual(boot.runs, beforeImport.runs);
  assert.deepEqual(boot.schedules, beforeImport.schedules);
  assert.equal(boot.runOverview.total, 0);
  assert.equal(lab.state.attempts, 0);
  note('new-and-old-packages-import-as-independent-drafts-without-runs-or-form-submission');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/flow-export.png' });
  evidence.passed = true;
  evidence.exports = [first.manifest, frozen.manifest, latest.manifest].map(
    ({ id, version, digest }) => ({ id, version, digest }),
  );
} catch (error) {
  evidence.error = String(error);
  try {
    await mkdir('test-results', { recursive: true });
    const failedPage = app.windows().find((window) => !window.isClosed());
    if (failedPage) {
      evidence.browserStatus = await failedPage
        .evaluate(() => window.flowark.request('browser.embedded.status'))
        .catch((error) => ({ error: String(error) }));
      evidence.uiErrors = await failedPage
        .locator('[role="alert"], .browser-sidebar .field-error, .browser-sidebar .alert')
        .allTextContents();
      evidence.screenshot = 'test-results/flow-export-failure.png';
      await failedPage.screenshot({ path: evidence.screenshot });
    }
    const browserImage = await app.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0]?.contentView.children[0] as
        | Electron.WebContentsView
        | undefined;
      if (!view || view.webContents.isDestroyed()) return null;
      return (await view.webContents.capturePage()).toPNG().toString('base64');
    });
    if (browserImage) {
      evidence.browserScreenshot = 'test-results/flow-export-browser-failure.png';
      await writeFile(evidence.browserScreenshot, Buffer.from(browserImage, 'base64'));
    }
  } catch (diagnosticError) {
    evidence.diagnosticError = String(diagnosticError);
  }
  throw error;
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/flow-export.json', JSON.stringify(evidence, null, 2));
  await app
    .evaluate(({ dialog }) => {
      const f = (globalThis as any).flowExportDialogs;
      if (!f) return;
      f.resolveReview?.({ response: 0, checkboxChecked: false });
      dialog.showMessageBox = f.originalReview;
      dialog.showSaveDialog = f.originalSave;
      dialog.showOpenDialog = f.originalOpen;
    })
    .catch(() => {});
  await app.close();
  await lab.close();
}
