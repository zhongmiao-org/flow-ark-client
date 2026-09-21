import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { desktopElectron as electron } from './desktop-session.mjs';
import { type ElectronApplication, type Page } from 'playwright-core';
import electronPath from 'electron';
import ExcelJS from 'exceljs';
import example from '../contracts/example.excel-mapping.json';
const data = await mkdtemp('/private/tmp/flowark-excel-ui-');
const output = join(data, 'output');
await mkdir(output);
const evidence: any = { passed: false, closed: false, data, checks: [], layouts: [] };
let app: ElectronApplication | undefined,
  page: Page | undefined,
  child: ChildProcess | undefined,
  failure: unknown;
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const editor = () => page!.getByRole('region', { name: 'Excel 字段映射', exact: true });
const label = (name: string) => editor().getByLabel(name, { exact: true });
const call = (method: string, args: any = {}): Promise<any> =>
  page!.evaluate(({ method, args }) => window.flowark.request(method, args), { method, args });
const wait = async (check: () => Promise<boolean>, message: string) => {
  const end = Date.now() + 20000;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(message);
    await new Promise((r) => setTimeout(r, 60));
  }
};
const size = async (width: number, height: number) => {
  await app!.evaluate(
    ({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setSize(s.width, s.height),
    { width, height },
  );
  await page!.waitForFunction((s) => innerWidth === s.width && innerHeight === s.height, {
    width,
    height,
  });
};
const mappingOptions = async (index: number) => {
  const details = editor().locator(`[data-mapping="${index - 1}"] details`);
  if (!(await details.getAttribute('open').then((v) => v !== null)))
    await details.locator('summary').click();
};
try {
  await mkdir('test-results/figma', { recursive: true });
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: ['.'],
    env: { ...process.env, FLOWARK_DATA_DIR: data },
  });
  child = app.process();
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: '你想完成什么？', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setTitle('FlowArk · Excel 映射隔离测试（自动退出）'),
  );
  await page.evaluate(() => {
    document.querySelector('.window-titlebar')!.textContent =
      'FlowArk · Excel 映射隔离测试（自动退出）';
  });
  await page.evaluate(() => document.fonts.ready);
  await size(1440, 1080);
  const record = await call('flow.create');
  const records = [
    ...example.parameters.records,
    { title: '项目 C', amount: 0, enabled: false },
    { title: '项目 D', amount: 5, enabled: true },
  ];
  const mapped = {
    ...example.steps[0],
    mappings: [
      ...example.steps[0].mappings,
      { source: 'title', column: 'F', header: '原始标题', type: 'text' },
    ],
  };
  await call('flow.save', {
    flow: {
      ...record.flow,
      name: 'Excel 映射验证',
      parameters: { records },
      requiredCapabilities: example.requiredCapabilities,
      steps: [
        { id: 'data', type: 'value', version: 1, value: { $ref: 'params.records' } },
        { id: 'wait', type: 'human', version: 1, message: '只用于测试固定快照' },
        mapped,
      ],
    },
    bindings: { ...record.bindings, files: { output } },
  });
  await button('我的流程').click();
  await button('编辑 Excel 映射验证').click();
  await page!.locator('.flow-shape[data-step-id="mapped"]').click();
  await button('打开 Excel 映射编辑器').click();
  await button('预览 3 行').click();
  await editor()
    .getByText(/已核对全部 4 条记录/)
    .waitFor();
  assert.equal(await editor().locator('tbody tr').count(), 3);
  assert.ok((await editor().locator('tbody').innerText()).includes('false'));
  assert.equal((await call('bootstrap')).runs.length, 0);
  for (const [width, height] of [
    [1440, 1080],
    [1920, 1080],
    [1040, 700],
  ]) {
    await size(width, height);
    await page.locator('main').evaluate((e) => e.scrollTo(0, 0));
    await page.mouse.move(0, 0);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const layout = await editor().evaluate((element) => ({
      width: innerWidth,
      height: innerHeight,
      overflow: element.scrollWidth > element.clientWidth,
      rootOverflow: document.documentElement.scrollWidth > innerWidth,
      columns: [...element.querySelectorAll('.excel-mapping-columns > *')].map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    }));
    assert.equal(layout.overflow, false);
    assert.equal(layout.rootOverflow, false);
    if (width === 1440)
      assert.deepEqual(
        layout.columns.map((c) => Math.round(c.width)),
        [600, 528],
      );
    evidence.layouts.push(layout);
    await page.screenshot({ path: `test-results/figma/excel-${width}.png`, scale: 'css' });
  }
  await size(1440, 1080);
  evidence.checks.push('real-static-records-preview-three-of-four-no-run-three-widths');
  await label('映射 2 目标列').fill('A');
  assert.equal(await editor().locator('tbody tr').count(), 0);
  await button('保存映射并返回').click();
  await editor().getByRole('alert').filter({ hasText: '重复' }).waitFor();
  assert.equal(await label('映射 2 目标列').evaluate((e) => e === document.activeElement), true);
  await label('映射 2 目标列').fill('C');
  await mappingOptions(2);
  await label('映射 2 类型').selectOption('text');
  await button('预览 3 行').click();
  await editor().getByRole('alert').filter({ hasText: '类型不符' }).waitFor();
  assert.equal(await label('映射 2 类型').evaluate((e) => e === document.activeElement), true);
  await label('映射 2 类型').selectOption('number');
  await button('添加映射').click();
  await button('保存映射并返回').click();
  await editor().getByRole('alert').filter({ hasText: '来源字段' }).waitFor();
  await mappingOptions(5);
  await button('删除映射 5').click();
  await label('输出工作簿').fill('../bad.xlsx');
  await button('保存映射并返回').click();
  await editor().getByRole('alert').filter({ hasText: '相对' }).waitFor();
  await label('输出工作簿').fill('summary.xlsx');
  assert.equal((await call('bootstrap')).runs.length, 0);
  evidence.checks.push(
    'duplicate-column-type-missing-source-path-rejected-and-focused-stale-preview-cleared',
  );
  await mappingOptions(1);
  await label('映射 1 表头').fill('放弃的标题');
  await button('我的流程').click();
  await page.locator('dialog[open]').waitFor();
  await button('继续编辑').click();
  assert.equal(await label('映射 1 表头').inputValue(), '放弃的标题');
  await button('取消').click();
  await button('放弃修改').click();
  await button('打开 Excel 映射编辑器').click();
  await mappingOptions(1);
  assert.equal(await label('映射 1 表头').inputValue(), '标题');
  await label('映射 1 表头').fill('已保存标题');
  await button('我的流程').click();
  await button('保存并离开').click();
  await button('编辑 Excel 映射验证').click();
  await page!.locator('.flow-shape[data-step-id="mapped"]').click();
  await button('打开 Excel 映射编辑器').click();
  await mappingOptions(1);
  assert.equal(await label('映射 1 表头').inputValue(), '已保存标题');
  await editor().locator('.excel-source-settings summary').click();
  await button('选择变量 · 来源记录').click();
  await label('来源记录变量来源').selectOption('steps.data');
  await button('使用变量 · 来源记录').click();
  await button('预览 3 行').click();
  await editor()
    .getByText(/来源依赖运行时步骤/)
    .waitFor();
  assert.equal((await call('bootstrap')).runs.length, 0);
  await button('保存映射并返回').click();
  evidence.checks.push(
    'leave-stay-discard-save-to-navigation-source-runtime-preview-remains-nonexecuting',
  );
  const run = await call('flow.run', { id: record.id });
  await wait(
    async () => (await call('run.detail', { id: run.id })).run.state === 'WAITING_INPUT',
    'run did not wait',
  );
  const before = (await call('run.detail', { id: run.id })).snapshot;
  await button('打开 Excel 映射编辑器').click();
  await mappingOptions(1);
  await label('映射 1 表头').fill('下一次运行标题');
  await button('保存映射并返回').click();
  assert.deepEqual((await call('run.detail', { id: run.id })).snapshot, before);
  await call('run.control', { id: run.id, action: 'resume' });
  await wait(
    async () =>
      ['SUCCEEDED', 'FAILED'].includes((await call('run.detail', { id: run.id })).run.state),
    'run did not finish',
  );
  const detail = await call('run.detail', { id: run.id });
  assert.equal(detail.run.state, 'SUCCEEDED', detail.run.error);
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(join(output, 'summary.xlsx'));
  const sheet = book.getWorksheet('汇总')!;
  assert.equal(sheet.getCell('A1').value, '已保存标题');
  assert.equal(sheet.getCell('A5').value, '项目 D');
  assert.equal(sheet.getCell('C4').value, 0);
  assert.equal(sheet.getCell('D4').value, false);
  assert.equal(sheet.getCell('B2').value, null);
  assert.equal(sheet.getCell('F2').value, '项目 A');
  assert.equal(detail.artifacts.length, 1);
  evidence.checks.push(
    'real-worker-runtime-reference-output-file-and-artifact-fixed-snapshot-after-draft-edit',
  );
  const bytes = await readFile(join(output, 'summary.xlsx'));
  const retry = await call('flow.run', { id: record.id });
  await wait(
    async () => (await call('run.detail', { id: retry.id })).run.state === 'WAITING_INPUT',
    'second explicit run did not wait',
  );
  await call('run.control', { id: retry.id, action: 'resume' });
  await wait(
    async () => (await call('run.detail', { id: retry.id })).run.state === 'FAILED',
    'existing output not rejected',
  );
  assert.deepEqual(await readFile(join(output, 'summary.xlsx')), bytes);
  assert.equal((await call('bootstrap')).runs.length, 2);
  assert.equal((await call('run.detail', { id: retry.id })).artifacts.length, 0);
  assert.deepEqual(errors, []);
  evidence.checks.push(
    'second-explicit-run-preserves-existing-workbook-bytes-no-artifact-no-auto-retry',
  );
  const fresh = await call('flow.create');
  await call('flow.save', {
    flow: {
      ...fresh.flow,
      name: '切换映射操作验证',
      steps: [
        {
          id: 'convert',
          type: 'excel',
          version: 1,
          operation: 'write',
          binding: 'unbound',
          name: 'matrix.xlsx',
          rows: [],
        },
      ],
    },
    bindings: fresh.bindings,
  });
  await button('我的流程').click();
  await button('编辑 切换映射操作验证').click();
  await page.locator('.flow-shape[data-step-id="convert"]').click();
  await page.getByLabel('操作', { exact: true }).selectOption('map');
  await button('打开 Excel 映射编辑器').click();
  await button('保存映射并返回').click();
  const converted = (await call('bootstrap')).flows.find((flow: any) => flow.id === fresh.id);
  assert.equal(converted.flow.steps[0].version, 3);
  assert.ok(converted.flow.requiredCapabilities.includes('excel-mapping-v1'));
  await assert.rejects(call('flow.run', { id: fresh.id }));
  assert.equal((await call('bootstrap')).runs.length, 2);
  evidence.checks.push(
    'operation-switch-persists-mapping-capability-unbound-directory-blocks-before-run',
  );
  evidence.passed = true;
} catch (error) {
  failure = error;
  await page
    ?.screenshot({ path: 'test-results/figma/excel-failure.png', scale: 'css' })
    .catch(() => {});
} finally {
  const watchdog = setTimeout(() => {
    failure ??= new Error('owned cleanup timeout');
    child?.kill('SIGKILL');
  }, 30000);
  try {
    if (app && page && !page.isClosed()) {
      for (const run of (await call('bootstrap')).runs)
        if (['QUEUED', 'RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING'].includes(run.state))
          await call('run.control', { id: run.id, action: 'cancel' });
      await wait(async () => {
        const b = await call('bootstrap');
        return !b.execution?.active && !b.runOverview.active && !b.runOverview.queued;
      }, 'owned cleanup');
      await app.close();
    }
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
    evidence.closed = !child || child.exitCode !== null || child.signalCode !== null;
    if (!evidence.closed) failure ??= new Error('owned process alive');
  }
  if (failure) {
    evidence.passed = false;
    evidence.error = String(failure);
  }
  await writeFile('test-results/figma/excel-summary.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
if (failure) throw failure;
