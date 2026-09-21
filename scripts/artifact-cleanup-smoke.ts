import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startFormLab } from './fixtures/platform-page';
import { formBrowser, formText } from './fixtures/platform-flow';
const data = await mkdtemp('/private/tmp/flowark-artifact-cleanup-ui-');
const lab = await startFormLab();
const launch = () =>
  electron.launch({
    executablePath: process.env.FLOWARK_TEST_EXECUTABLE || (electronPath as unknown as string),
    args: process.env.FLOWARK_TEST_EXECUTABLE ? [] : [resolve('.')],
    env: { ...process.env, FLOWARK_DATA_DIR: data },
    timeout: 30000,
  });
let app = await launch();
const evidence: any = { passed: false, data, checks: [] };
try {
  let page = await app.firstWindow();
  await page.waitForFunction(() => !!(window as any).flowark);
  const call = (method: string, args: any = {}): Promise<any> =>
    page.evaluate(({ method, args }) => (window as any).flowark.request(method, args), {
      method,
      args,
    });
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const wait = async (predicate: () => Promise<boolean>) => {
    const until = Date.now() + 30000;
    while (!(await predicate())) {
      if (Date.now() > until) throw new Error('清理界面验收等待超时');
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
  await button('本地设置').click();
  await button('启用内置浏览器').click();
  await button('启用内置浏览器').waitFor({ state: 'hidden' });
  await button('打开网页面板').click();
  const created = await call('flow.create');
  await call('flow.save', {
    flow: {
      ...created.flow,
      name: '虚构产物清理验收',
      steps: [
        formBrowser('open', 'navigate', '', lab.url),
        {
          id: 'write',
          type: 'file',
          version: 1,
          operation: 'write',
          binding: 'work',
          name: 'result.txt',
          content: formText,
        },
        formBrowser('upload', 'upload', '#attachment', { binding: 'work', name: 'result.txt' }),
        formBrowser('download', 'download', 'a[href="/fictional.txt"]', 'downloaded.txt'),
        formBrowser('shot', 'screenshot', ''),
        { id: 'human', type: 'human', version: 1, message: '先核对产物，再继续' },
      ],
    },
    bindings: { browserId: 'embedded', files: { work: data }, credentials: [] },
  });
  const first = await call('flow.run', { id: created.id });
  await wait(
    async () => (await call('run.detail', { id: first.id })).run.state === 'WAITING_INPUT',
  );
  await button('运行记录').click();
  await page
    .getByRole('row')
    .filter({ hasText: first.id.slice(0, 8) })
    .getByRole('button', { name: '查看' })
    .click();
  assert.equal(await button('预览产物清理').isDisabled(), true);
  await assert.rejects(call('run.artifacts.preview', { id: first.id }), /尚未结束/);
  await button('继续').click();
  await wait(async () => (await call('run.detail', { id: first.id })).run.state === 'SUCCEEDED');
  const before = await call('run.detail', { id: first.id });
  assert.equal(before.artifacts.length, 3);
  assert.ok(before.artifacts.every((a: any) => a.integrity === 'verified'));
  assert.equal(
    await readFile(before.artifacts.find((a: any) => a.name === 'downloaded.txt').path, 'utf8'),
    formText,
  );
  const second = await call('flow.run', { id: created.id });
  await wait(
    async () => (await call('run.detail', { id: second.id })).run.state === 'WAITING_INPUT',
  );
  const other = await call('run.detail', { id: second.id });
  const native = await app.evaluate(async ({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0].contentView.children[0] as any;
    return view.webContents.executeJavaScript(
      '({width:innerWidth, title:document.title, upload:document.querySelector("#attachment").files[0].name})',
    );
  });
  assert.equal(native.width, 1920);
  assert.equal(native.upload, 'result.txt');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 700));
  await button('预览产物清理').click();
  const preview = () => page.getByRole('form', { name: '产物清理预览', exact: true });
  await preview()
    .getByRole('heading', { name: /^5 个文件/ })
    .waitFor();
  assert.equal(await button('确认清理产物').isDisabled(), true);
  assert.equal((await call('run.detail', { id: first.id })).artifactCleanup, undefined);
  await button('取消清理').click();
  assert.equal(await preview().count(), 0);
  for (const a of before.artifacts) await access(a.path);
  evidence.checks.push(
    'active-run-disabled-and-rejected',
    'native-1920-form-upload-download-screenshot',
    'preview-and-cancel-preserve-files',
  );
  await button('预览产物清理').click();
  await preview().waitFor();
  await writeFile(join(data, 'artifacts', first.id, 'arrived-after-preview.txt'), 'new fixture');
  await page.getByLabel('已核对结果并保存需要保留的文件', { exact: true }).check();
  await button('确认清理产物').click();
  await page.getByRole('alert').filter({ hasText: '预览已过期' }).waitFor();
  assert.equal((await call('run.detail', { id: first.id })).artifactCleanup, undefined);
  for (const a of before.artifacts) await access(a.path);
  await button('预览产物清理').click();
  await preview()
    .getByRole('heading', { name: /^6 个文件/ })
    .waitFor();
  assert.equal(
    await page.getByLabel('已核对结果并保存需要保留的文件', { exact: true }).isChecked(),
    false,
  );
  assert.ok(await preview().evaluate((e) => e.scrollWidth <= e.clientWidth + 1));
  await mkdir('test-results', { recursive: true });
  await preview().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/artifact-cleanup-preview.png' });
  await page.getByLabel('已核对结果并保存需要保留的文件', { exact: true }).check();
  await button('确认清理产物').click();
  await page.getByRole('status').filter({ hasText: '已清理 · 6 个文件' }).waitFor();
  const after = await call('run.detail', { id: first.id });
  assert.deepEqual(after.run, before.run);
  assert.deepEqual(after.snapshot, before.snapshot);
  assert.deepEqual(after.events.slice(0, -1), before.events);
  assert.ok(after.artifacts.every((a: any) => a.integrity === 'cleared' && !a.available));
  await assert.rejects(access(join(data, 'artifacts', first.id)), { code: 'ENOENT' });
  await assert.rejects(call('artifact.reveal', { id: before.artifacts[0].artifactId }), /已清理/);
  assert.equal(await readFile(join(data, 'result.txt'), 'utf8'), formText);
  assert.equal((await call('run.detail', { id: second.id })).run.state, 'WAITING_INPUT');
  for (const a of other.artifacts) await access(a.path);
  assert.equal(lab.state.attempts, 0);
  await call('run.control', { id: second.id, action: 'resume' });
  await wait(async () => (await call('run.detail', { id: second.id })).run.state === 'SUCCEEDED');
  evidence.checks.push(
    'stale-preview-rejected-and-confirmation-reset',
    'confirmed-clear-keeps-original-history-and-other-active-run',
  );
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.waitForFunction(() => !!(window as any).flowark);
  await button('运行记录').click();
  await page
    .getByRole('row')
    .filter({ hasText: first.id.slice(0, 8) })
    .getByRole('button', { name: '查看' })
    .click();
  await page.getByRole('status').filter({ hasText: '已清理 · 6 个文件' }).waitFor();
  for (const a of before.artifacts) {
    const row = page.locator(`[data-artifact-id="${a.artifactId}"]`);
    await row.getByText('已清理', { exact: true }).waitFor();
    assert.equal(await row.getByRole('button').isDisabled(), true);
  }
  assert.ok(
    (await call('run.detail', { id: second.id })).artifacts.every(
      (a: any) => a.integrity === 'verified',
    ),
  );
  await button('预览产物清理').click();
  await preview().getByText('目录内没有剩余文件。无需清理。', { exact: true }).waitFor();
  assert.equal(await button('确认清理产物').isDisabled(), true);
  evidence.checks.push('restart-retains-cleanup-status-and-disabled-locate');
  evidence.passed = true;
  evidence.first = first.id;
  evidence.second = second.id;
} finally {
  await app.close();
  await lab.close();
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/artifact-cleanup.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
