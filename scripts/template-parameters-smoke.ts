import assert from 'node:assert/strict';
import { _electron as electron, type Page } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Flow, FlowRecord, Run } from '../src/shared/types';
import { packageFlow, validateTemplate } from '../src/recruiting/templates';
import { startFormLab } from './fixtures/form-lab';
import { formBrowser } from './fixtures/form-lab-flow';

const data = await mkdtemp('/private/tmp/flowark-template-parameters-');
const lab = await startFormLab();
const original = {
  greeting: '模板默认甲',
  channel: 'email',
  department: 'engineering',
  quantity: 3,
  enabled: false,
};
const changed = {
  greeting: '实例修改乙',
  channel: 'phone',
  department: 'design',
  quantity: 7,
  enabled: true,
};
const values = Object.fromEntries(
  Object.keys(original).map((key) => [key, { $ref: 'params.' + key }]),
);
const flow: Flow = {
  id: 'fictional-template-parameters',
  formatVersion: '1.0',
  name: '模板参数验证',
  description: '',
  parameters: original,
  requiredCapabilities: ['value', 'browser', 'browser-forms-v1', 'human', 'condition'],
  steps: [
    { id: 'before', type: 'value', version: 1, value: values },
    formBrowser('open', 'navigate', '', lab.url),
    formBrowser('fill', 'fill', '#full-name', { $ref: 'params.greeting' }),
    {
      id: 'channel',
      type: 'condition',
      version: 1,
      actual: { $ref: 'params.channel' },
      operator: 'equals',
      expected: 'email',
      then: [formBrowser('email', 'check', '#channel-email', true)],
      else: [formBrowser('phone', 'check', '#channel-phone', true)],
    },
    formBrowser('select', 'select', '#department', { $ref: 'params.department' }),
    { id: 'review', type: 'human', version: 1, message: '核对模板参数' },
    { id: 'after', type: 'value', version: 1, value: values },
  ],
};
const configuration = {
  adapter: 'flow-parameters-v1',
  schema: {
    type: 'object',
    title: '虚构表单参数',
    additionalProperties: false,
    required: Object.keys(original),
    properties: {
      greeting: { type: 'string', title: '填写姓名', minLength: 1, default: original.greeting },
      channel: {
        type: 'string',
        title: '联系渠道',
        enum: ['email', 'phone'],
        default: original.channel,
      },
      department: {
        type: 'string',
        title: '部门',
        enum: ['engineering', 'design'],
        default: original.department,
      },
      quantity: {
        type: 'integer',
        title: '数量',
        minimum: 1,
        maximum: 10,
        default: original.quantity,
      },
      enabled: { type: 'boolean', title: '启用选项', default: original.enabled },
    },
  },
};
const template = packageFlow(flow, 'fictional-local', configuration);
const templatePath = join(data, 'source.template.json');
const exportPath = join(data, 'export.template.json');
await writeFile(templatePath, JSON.stringify(template));
const launch = () =>
  electron.launch({
    executablePath: process.env.FLOWARK_TEST_EXECUTABLE || (electronPath as unknown as string),
    args: process.env.FLOWARK_TEST_EXECUTABLE ? [] : [resolve('.')],
    env: { ...process.env, FLOWARK_DATA_DIR: data, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
    timeout: 30000,
  });
let app = await launch();
let page!: Page;
const evidence: any = { passed: false, data, checks: [], runs: [] };
const note = (name: string) => {
  evidence.checks.push(name);
  console.log(name);
};
const call = (method: string, args: any = {}): Promise<any> =>
  page.evaluate(({ method, args }) => window.flowark.request(method, args), { method, args });
const button = (name: string) => page.getByRole('button', { name, exact: true });
const label = (name: string) => page.getByLabel(name, { exact: true });
const modal = () => page.getByRole('dialog', { name: '实例配置', exact: true });
const summary = () => page.getByRole('region', { name: '模板运行参数（只读）', exact: true });
const wait = async (predicate: () => Promise<boolean>, message: string, timeout = 25000) => {
  const end = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() > end) throw new Error('模板参数验收超时：' + message);
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
};
const stored = async (id: string): Promise<FlowRecord> =>
  (await call('bootstrap')).flows.find((r: FlowRecord) => r.id === id);
const terminal = async (run: Run, state: string) => {
  let result: any;
  await wait(async () => {
    result = await call('run.detail', { id: run.id });
    if (
      result.run.state !== state &&
      ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(result.run.state)
    )
      throw new Error('非预期运行结果：' + JSON.stringify(result.run));
    return result.run.state === state;
  }, state);
  return result;
};
const nativeValues = () =>
  app.evaluate(async ({ BrowserWindow }) =>
    (BrowserWindow.getAllWindows()[0].contentView.children[0] as Electron.WebContentsView)
      .webContents.executeJavaScript(`({
    greeting:document.querySelector('#full-name').value,
    channel:document.querySelector('input[name="channel"]:checked')?.value,
    department:document.querySelector('#department').value,
    width:innerWidth
  })`),
  );
const finish = async (run: Run, expected: typeof original) => {
  const active = await terminal(run, 'WAITING_INPUT');
  assert.deepEqual(active.snapshot.parameters, expected);
  assert.deepEqual(await nativeValues(), {
    greeting: expected.greeting,
    channel: expected.channel,
    department: expected.department,
    width: 1920,
  });
  await call('run.control', { id: run.id, action: 'resume' });
  const done = await terminal(run, 'SUCCEEDED');
  assert.deepEqual(done.output.before, expected);
  assert.deepEqual(done.output.after, expected);
  evidence.runs.push(run.id);
  return done;
};
const open = async (record: FlowRecord) => {
  await button('我的流程').click();
  await button('编辑 ' + record.flow.name).click();
  await button('参数与绑定').click();
};
const ready = async () => {
  page = await app.firstWindow();
  page.on('console', (message) => {
    if (/same key|duplicate.*key/i.test(message.text())) {
      (evidence.duplicateKeys ??= []).push(message.text());
      console.error(message.text());
    }
  });
  page.on('pageerror', (error) => {
    (evidence.pageErrors ??= []).push(error.stack || error.message);
    console.log('renderer-error', error.stack || error.message);
  });
  await page.waitForFunction(() => Boolean(window.flowark));
  await wait(async () => Array.isArray((await call('bootstrap')).flows), '宿主就绪');
};
const installDialogs = async () =>
  app.evaluate(
    ({ dialog }, paths) => {
      // Only dialog selections/approval are injected in this isolated app. Import,
      // digest/schema checks, saves, execution, export and file bytes remain real.
      const fixture = {
        open: dialog.showOpenDialog,
        save: dialog.showSaveDialog,
        review: dialog.showMessageBox,
        ...paths,
      };
      (globalThis as any).templateParameterDialogs = fixture;
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [fixture.input],
      })) as typeof dialog.showOpenDialog;
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: fixture.output,
      })) as typeof dialog.showSaveDialog;
      dialog.showMessageBox = (async (...args: any[]) => {
        const message = args.at(-1).message;
        if (['确认模板来源可信', '确认已审阅流程中的字面量与脚本'].includes(message))
          return { response: 1, checkboxChecked: false };
        return (fixture.review as any)(...args);
      }) as typeof dialog.showMessageBox;
    },
    { input: templatePath, output: exportPath },
  );
const restoreDialogs = () =>
  app.evaluate(({ dialog }) => {
    const f = (globalThis as any).templateParameterDialogs;
    if (f) {
      dialog.showOpenDialog = f.open;
      dialog.showSaveDialog = f.save;
      dialog.showMessageBox = f.review;
      delete (globalThis as any).templateParameterDialogs;
    }
  });
try {
  await ready();
  await installDialogs();
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
  await button('打开网页面板').click();
  await label('网页地址').fill(lab.url);
  await button('访问网页').click();
  await wait(
    async () => (await call('browser.embedded.status')).url === new URL(lab.url).href,
    '内置表单',
  );
  const first: FlowRecord = await call('flow.import');
  const second: FlowRecord = await call('flow.import');
  for (const [index, instance] of [first, second].entries()) {
    instance.flow.name = '模板参数实例' + (index + 1);
    instance.bindings.browserId = 'embedded';
    await call('flow.save', { flow: instance.flow, bindings: instance.bindings });
  }
  const secondBefore = await stored(second.id);
  const catalogBefore = (await call('bootstrap')).templates;
  const plan = await call('schedule.save', {
    flowId: first.id,
    intervalMinutes: 1,
    timezone: 'Asia/Shanghai',
  });
  const running: Run = await call('flow.run', { id: first.id });
  await terminal(running, 'WAITING_INPUT');
  const queued: Run = await call('flow.run', { id: first.id });
  const queuedSnapshot = (await call('run.detail', { id: queued.id })).snapshot;
  await open(await stored(first.id));
  await summary().waitFor();
  assert.equal(await summary().locator('input,textarea,select').count(), 0);
  assert.equal(await label('新参数名称').count(), 0);
  assert.equal(await page.getByText('参数 JSON · 高级', { exact: true }).count(), 0);
  assert.ok((await summary().innerText()).includes(original.greeting));
  const firstBefore = await stored(first.id);
  const sessionBefore = await app.evaluate(async ({ BrowserWindow }) => {
    const contents = (
      BrowserWindow.getAllWindows()[0].contentView.children[0] as Electron.WebContentsView
    ).webContents;
    return {
      id: contents.id,
      timeOrigin: await contents.executeJavaScript('performance.timeOrigin'),
    };
  });
  await button('编辑实例配置').click();
  await modal().getByLabel('填写姓名', { exact: true }).fill('取消的输入');
  await wait(async () => !(await call('browser.embedded.status')).visible, '弹窗期间隐藏原生网页');
  const cancelButton = modal().getByRole('button', { name: '取消', exact: true });
  await cancelButton.evaluate((element) => {
    (window as any).parameterCancelClicks = 0;
    element.addEventListener('click', () => (window as any).parameterCancelClicks++, {
      once: true,
    });
  });
  const cancelBounds = await cancelButton.boundingBox();
  const nativeBeforeCancel = await app.evaluate(({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0].contentView.children[0];
    return { bounds: view.getBounds(), visible: view.getVisible() };
  });
  await cancelButton.focus();
  await cancelButton.click();
  const clicks = await page.evaluate(() => (window as any).parameterCancelClicks);
  evidence.cancelPresentation = { cancelBounds, nativeBeforeCancel, clicks };
  assert.equal(nativeBeforeCancel.visible, false, 'native webpage must yield to the dialog');
  assert.equal(clicks, 1, 'cancel must reach the renderer');
  await modal().waitFor({ state: 'hidden', timeout: 5000 });
  assert.deepEqual(await stored(first.id), firstBefore);
  await wait(async () => (await call('browser.embedded.status')).visible, '取消后恢复原生网页');
  const sessionAfter = await app.evaluate(async ({ BrowserWindow }) => {
    const contents = (
      BrowserWindow.getAllWindows()[0].contentView.children[0] as Electron.WebContentsView
    ).webContents;
    return {
      id: contents.id,
      timeOrigin: await contents.executeJavaScript('performance.timeOrigin'),
    };
  });
  assert.deepEqual(sessionAfter, sessionBefore);
  assert.equal((await nativeValues()).greeting, original.greeting);
  assert.equal((await nativeValues()).width, 1920);
  note('template-parameters-have-one-editor-and-cancel-preserves-saved-record-and-native-session');

  await button('编辑实例配置').click();
  await modal().getByLabel('填写姓名', { exact: true }).fill('');
  await modal().getByRole('button', { name: '保存配置', exact: true }).click();
  await modal().getByRole('alert').waitFor();
  assert.match(await modal().getByRole('alert').innerText(), /实例配置不符合模板定义/);
  assert.equal(await modal().getByLabel('填写姓名', { exact: true }).inputValue(), '');
  assert.deepEqual(await stored(first.id), firstBefore);
  await modal().getByLabel('填写姓名', { exact: true }).fill(changed.greeting);
  await modal().getByLabel('联系渠道', { exact: true }).selectOption(changed.channel);
  await modal().getByLabel('部门', { exact: true }).selectOption(changed.department);
  await modal().getByLabel('数量', { exact: true }).fill(String(changed.quantity));
  await modal().getByLabel('启用选项', { exact: true }).check();
  await modal().getByRole('button', { name: '保存配置', exact: true }).click();
  await modal().waitFor({ state: 'hidden', timeout: 5000 });
  assert.deepEqual((await stored(first.id)).flow.parameters, changed);
  assert.deepEqual((await stored(first.id)).bindings.configuration?.values, changed);
  assert.ok((await summary().innerText()).includes(changed.greeting));
  assert.deepEqual(await stored(second.id), secondBefore);
  assert.deepEqual((await call('bootstrap')).templates, catalogBefore);
  assert.deepEqual((await call('run.detail', { id: queued.id })).snapshot, queuedSnapshot);
  const planAfter = (await call('bootstrap')).schedules.find((s: any) => s.id === plan.id);
  assert.equal(planAfter.versionId, plan.versionId);
  note('invalid-schema-keeps-input-and-success-synchronizes-values-with-instance-isolation');

  await button('撤销编辑').click();
  assert.ok((await summary().innerText()).includes(original.greeting));
  await button('实例配置').click();
  assert.equal(
    await modal().getByLabel('填写姓名', { exact: true }).inputValue(),
    original.greeting,
  );
  await modal().getByRole('button', { name: '取消', exact: true }).focus();
  await modal().getByRole('button', { name: '取消', exact: true }).click();
  await modal().waitFor({ state: 'hidden', timeout: 5000 });
  assert.deepEqual(
    (await stored(first.id)).flow.parameters,
    changed,
    'undo changes only the draft',
  );
  await button('重做编辑').click();
  assert.ok((await summary().innerText()).includes(changed.greeting));
  await button('保存').click();
  await open(await stored(second.id));
  assert.ok((await summary().innerText()).includes(original.greeting));
  await open(await stored(first.id));
  assert.ok((await summary().innerText()).includes(changed.greeting));
  note('undo-redo-and-reopen-keep-template-values-and-parameter-projection-together');

  const runningDone = await finish(running, original);
  await finish(queued, original);
  const fresh: Run = await call('flow.run', { id: first.id });
  await finish(fresh, changed);
  let scheduled: Run | undefined;
  await wait(
    async () => {
      scheduled = (await call('bootstrap')).runs.find((r: Run) => r.scheduleId === plan.id);
      return Boolean(scheduled);
    },
    '原固定计划的真实分钟到期',
    90000,
  );
  await call('schedule.toggle', { id: plan.id, enabled: false });
  await finish(scheduled!, original);
  const old = await call('run.detail', { id: running.id });
  for (const key of ['run', 'events', 'snapshot', 'output'])
    assert.deepEqual(old[key], runningDone[key]);
  note(
    'real-workers-use-old-active-queued-and-scheduled-snapshots-while-new-run-uses-edited-values',
  );

  await open(await stored(first.id));
  await button('导出').click();
  await wait(async () => {
    try {
      return Boolean(await readFile(exportPath));
    } catch {
      return false;
    }
  }, '模板导出');
  const exported = validateTemplate(JSON.parse(await readFile(exportPath, 'utf8')));
  assert.deepEqual(
    exported.flow.parameters,
    Object.fromEntries(Object.keys(original).map((k) => [k, null])),
  );
  assert.equal(JSON.stringify(exported).includes(changed.greeting), false);
  assert.equal(Object.hasOwn(exported.manifest.configuration!, 'values'), false);
  await app.evaluate(() => {
    (globalThis as any).templateParameterDialogs.input = (
      globalThis as any
    ).templateParameterDialogs.output;
  });
  const reimported: FlowRecord = await call('flow.import');
  assert.deepEqual(reimported.flow.parameters, original);
  assert.notEqual(reimported.id, first.id);
  reimported.flow.name = '回导模板独立实例';
  await call('flow.save', { flow: reimported.flow, bindings: reimported.bindings });
  assert.deepEqual(JSON.parse(await readFile(templatePath, 'utf8')), template);
  note('export-clears-instance-values-and-reimport-uses-template-defaults');

  const ordinary: FlowRecord = await call('flow.create');
  ordinary.flow.name = '普通参数仍可编辑';
  ordinary.flow.parameters = { greeting: '普通甲' };
  ordinary.flow.requiredCapabilities = ['value'];
  ordinary.flow.steps = [
    { id: 'value', type: 'value', version: 1, value: { $ref: 'params.greeting' } },
  ];
  await call('flow.save', { flow: ordinary.flow, bindings: ordinary.bindings });
  await open(await stored(ordinary.id));
  assert.equal(await summary().count(), 0);
  await label('参数 greeting').fill('普通乙');
  await button('保存').click();
  await wait(
    async () => (await stored(ordinary.id)).flow.parameters.greeting === '普通乙',
    '普通参数保存',
  );
  const normal: Run = await call('flow.run', { id: ordinary.id });
  assert.deepEqual((await terminal(normal, 'SUCCEEDED')).output, { value: '普通乙' });
  await wait(async () => !(await call('bootstrap')).execution?.active, '普通参数运行收尾');
  note('ordinary-flow-parameters-remain-editable-and-execute-the-saved-value');

  await open(await stored(first.id));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 700));
  await summary().scrollIntoViewIfNeeded();
  assert.ok(await summary().evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  assert.equal((await nativeValues()).width, 1920);
  await page.screenshot({ path: join(data, 'template-parameters.png') });
  assert.equal(lab.state.attempts, 0);
  const total = (await call('bootstrap')).runOverview.total;
  await restoreDialogs();
  await app.close();
  app = await launch();
  await ready();
  await open(await stored(first.id));
  assert.ok((await summary().innerText()).includes(changed.greeting));
  assert.deepEqual((await stored(first.id)).bindings.configuration?.values, changed);
  assert.deepEqual(await stored(second.id), secondBefore);
  assert.deepEqual((await call('run.detail', { id: running.id })).snapshot.parameters, original);
  assert.equal((await call('bootstrap')).runOverview.total, total);
  note('small-panel-retains-1920-css-width-and-normal-reopen-preserves-values-without-replay');
  assert.deepEqual(evidence.duplicateKeys ?? [], []);
  assert.deepEqual(evidence.pageErrors ?? [], []);
  evidence.passed = true;
} catch (error) {
  evidence.error = error instanceof Error ? error.stack : String(error);
  await page!.screenshot({ path: join(data, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile(join(data, 'evidence.json'), JSON.stringify(evidence, null, 2));
  await writeFile('test-results/template-parameters.json', JSON.stringify(evidence, null, 2));
  await (async () => {
    const current = await call('bootstrap');
    for (const schedule of current.schedules)
      if (schedule.enabled) await call('schedule.toggle', { id: schedule.id, enabled: false });
    for (const run of current.runs.filter((r: Run) => r.state === 'QUEUED'))
      await call('run.control', { id: run.id, action: 'cancel' });
    if (current.execution?.active)
      await call('run.control', { id: current.execution.active.runId, action: 'cancel' });
    await wait(async () => !(await call('bootstrap')).execution?.active, '测试收尾');
  })().catch((error) => console.error('cleanup', String(error)));
  await restoreDialogs().catch(() => {});
  await app.close();
  await lab.close();
  console.log(JSON.stringify(evidence));
}
