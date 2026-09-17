import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const data = await mkdtemp(join(tmpdir(), 'flowark-desktop-'));
const executable = process.env.FLOWARK_TEST_EXECUTABLE || electronPath;
const args = process.env.FLOWARK_TEST_EXECUTABLE ? [] : [resolve('.')];
const app = await electron.launch({
  executablePath: executable,
  args,
  env: { ...process.env, FLOWARK_DATA_DIR: data },
  timeout: 30000,
});
const errors = [];
app.process().stderr.on('data', (b) => process.stderr.write(b));
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => {
    if (/\[React Flow\].*(handle|node type|edge type)/i.test(message.text()))
      errors.push(message.text());
  });
  const assertOutputOnOutline = async (shape) => {
    const aligned = await page.locator(`.canvas [data-shape="${shape}"]`).evaluate((element) => {
      const svg = element.querySelector('.flow-shape-outline');
      const handle = element.querySelector('[data-handleid="out"]').getBoundingClientRect();
      const point = new DOMPoint(
        handle.x + handle.width / 2,
        handle.y + handle.height / 2,
      ).matrixTransform(svg.getScreenCTM().inverse());
      return svg.lastElementChild.isPointInStroke(point);
    });
    assert.ok(aligned, `${shape} output must touch its SVG outline`);
  };
  await page.waitForFunction(() => Boolean(window.flowark), {}, { timeout: 15000 });
  const bootstrap = await page.evaluate(() => window.flowark.request('bootstrap'));
  console.log('Desktop initialized');
  assert.equal(bootstrap.flows.length, 1);
  assert.equal(bootstrap.runs.length, 0);
  const appVersion = await app.evaluate(({ app }) => app.getVersion());
  assert.equal(await page.locator('.sidebar-bottom span').textContent(), appVersion);
  const security = await app.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      sandbox: p.sandbox,
      contextIsolation: p.contextIsolation,
      nodeIntegration: p.nodeIntegration,
    };
  });
  assert.deepEqual(security, {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  });
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  const missingConfirmation = await page.evaluate(async () => {
    try {
      await window.flowark.request('action.confirm', {
        id: 'missing-confirmation',
        policyHash: '0'.repeat(64),
      });
    } catch (error) {
      return error.message;
    }
    return '';
  });
  assert.match(missingConfirmation, /不存在/);
  assert.doesNotMatch(missingConfirmation, /方法未授权/);
  await page.getByRole('button', { name: '运行', exact: true }).first().click();
  console.log('Run submitted');
  const deadline = Date.now() + 20000;
  while (true) {
    const current = await page.evaluate(() => window.flowark.request('bootstrap'));
    if (current.runs[0] && ['SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(current.runs[0].state))
      break;
    if (Date.now() > deadline) throw new Error('Desktop run timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log('Run finished');
  const result = await page.evaluate(() => window.flowark.request('bootstrap'));
  assert.equal(result.runs[0].state, 'SUCCEEDED', JSON.stringify(result.runs[0]));
  await page.getByRole('button', { name: '我的流程', exact: true }).click();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({
    path: 'test-results/desktop-home.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '编辑 第一个流程' }).click();
  assert.equal(await page.locator('.inspector').getByText(/招聘/).count(), 0);
  assert.equal(await page.getByRole('button', { name: '实例配置', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'JS / TS 脚本', exact: true }).click();
  await page.getByRole('button', { name: '添加到主流程', exact: true }).click();
  await page.waitForSelector('.monaco-editor', { timeout: 20000 });
  const localPackage = join(data, 'fixture-package');
  await mkdir(localPackage);
  await writeFile(
    join(localPackage, 'package.json'),
    JSON.stringify({ name: '@desktop/fixture', version: '1.2.3', main: 'index.cjs' }),
  );
  await writeFile(
    join(localPackage, 'index.cjs'),
    "module.exports = require('node:path').basename('/fixture/local-package-ready');",
  );
  await app.evaluate(({ dialog }, path) => {
    const original = dialog.showOpenDialog;
    globalThis.restorePackageDialog = () => {
      dialog.showOpenDialog = original;
    };
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, localPackage);
  try {
    await page.getByRole('button', { name: '绑定本地包', exact: true }).click();
    await page.locator('.script-package').getByText('@desktop/fixture', { exact: true }).waitFor();
  } finally {
    await app.evaluate(() => {
      globalThis.restorePackageDialog();
      delete globalThis.restorePackageDialog;
    });
  }
  const packageNode = JSON.parse(await page.locator('.inspector .code-input').inputValue());
  assert.deepEqual(packageNode.dependencies, [{ name: '@desktop/fixture', version: '1.2.3' }]);
  packageNode.code = "import value from '@desktop/fixture'; export default async()=>value;";
  await page.locator('.inspector .code-input').fill(JSON.stringify(packageNode, null, 2));
  await page.getByRole('region', { name: '脚本本地依赖' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/script-packages-editor.png', fullPage: true });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '运行', exact: true }).click();
  const scriptDeadline = Date.now() + 20000;
  while (true) {
    const state = await page.evaluate(() => window.flowark.request('bootstrap'));
    if (
      state.runs.length >= 2 &&
      ['SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(state.runs[0].state)
    ) {
      assert.equal(state.runs[0].state, 'SUCCEEDED', JSON.stringify(state.runs[0]));
      const packageDetail = await page.evaluate(
        (id) => window.flowark.request('run.detail', { id }),
        state.runs[0].id,
      );
      assert.equal(packageDetail.output[packageNode.id], 'local-package-ready');
      assert.deepEqual(packageDetail.scriptBundles[0].dependencies, [
        { name: '@desktop/fixture', version: '1.2.3' },
      ]);
      assert.match(packageDetail.scriptBundles[0].sha256, /^[a-f0-9]{64}$/);
      break;
    }
    if (Date.now() > scriptDeadline) throw new Error('Packaged script execution timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await page.getByRole('button', { name: '我的流程', exact: true }).click();
  await page.getByRole('button', { name: '编辑 第一个流程' }).click();
  await page.screenshot({
    path: 'test-results/desktop-editor.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Excel 表格', exact: true }).click();
  await page.getByRole('button', { name: '添加到主流程', exact: true }).click();
  await page.getByLabel('操作', { exact: true }).selectOption('fill');
  const fillNode = JSON.parse(await page.locator('.inspector .code-input').inputValue());
  assert.equal(fillNode.version, 2);
  assert.equal(fillNode.operation, 'fill');
  assert.equal(fillNode.templateName, 'template.xlsx');
  await page.getByRole('button', { name: '文件处理', exact: true }).click();
  await page.getByRole('button', { name: '添加到主流程', exact: true }).click();
  await page.getByLabel('操作', { exact: true }).selectOption('archive');
  const archiveNode = JSON.parse(await page.locator('.inspector .code-input').inputValue());
  assert.equal(archiveNode.version, 2);
  assert.deepEqual(archiveNode.files, ['result.txt']);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal(await page.locator('.inspector').getByText(/招聘/).count(), 0);
  await page.screenshot({ path: 'test-results/file-operations-editor.png', fullPage: true });
  const beforeTemplates = await page.evaluate(() => window.flowark.request('bootstrap'));
  for (const [templateId, name] of [
    ['boss-resume-apply', 'BOSS 直聘投递简历'],
    ['zhaopin-resume-apply', '智联招聘投递简历'],
  ]) {
    await page.evaluate(
      (templateId) => window.flowark.request('flow.create', { templateId }),
      templateId,
    );
    await page.getByRole('button', { name: '我的流程', exact: true }).click();
    await page.getByRole('button', { name: '编辑 ' + name, exact: true }).click();
    assert.equal(
      await page
        .locator('.inspector')
        .getByText(/招聘配置|求职者账号|逐项动作权限|岗位筛选|允许城市/)
        .count(),
      0,
    );
    await page.getByRole('button', { name: '实例配置', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('求职者账号标识', { exact: true }).fill('fictional-desktop-account');
    await dialog.getByRole('button', { name: '添加允许城市', exact: true }).click();
    await dialog.getByLabel('允许城市 1', { exact: true }).fill('深圳');
    await dialog.getByRole('button', { name: '添加包含公司', exact: true }).click();
    await dialog.getByLabel('包含公司 1', { exact: true }).fill('虚构科技');
    await dialog.getByRole('button', { name: '添加排除职位词', exact: true }).click();
    await dialog.getByLabel('排除职位词 1', { exact: true }).fill('外包');
    await dialog.getByRole('button', { name: '添加允许工作方式', exact: true }).click();
    await dialog.getByLabel('允许工作方式 1', { exact: true }).selectOption('hybrid');
    await dialog.getByLabel('启用月薪筛选', { exact: true }).check();
    await dialog.getByLabel('岗位月薪下限至少（元，0 不限）', { exact: true }).fill('20000');
    await dialog.getByLabel('岗位月薪上限至多（元，0 不限）', { exact: true }).fill('30000');
    await page.screenshot({ path: 'test-results/' + templateId + '-filters.png', fullPage: true });
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const configured = await page.evaluate(() => window.flowark.request('bootstrap'));
    assert.equal(configured.runs.length, beforeTemplates.runs.length);
    const saved = configured.flows.find((r) => r.flow.sourceTemplate?.id === templateId);
    assert.equal(saved.flow.sourceTemplate.version, '1.2.0');
    assert.equal(saved.bindings.configuration.values.account, 'fictional-desktop-account');
    assert.deepEqual(saved.bindings.configuration.values.jobFilter, {
      cities: ['深圳'],
      includedCompanies: ['虚构科技'],
      excludedKeywords: ['外包'],
      workModes: ['hybrid'],
      salary: { enabled: true, minimumMonthly: 20000, maximumMonthly: 30000, currency: 'CNY' },
    });
    await page.getByRole('button', { name: '实例配置', exact: true }).click();
    assert.equal(await dialog.getByLabel('允许城市 1', { exact: true }).inputValue(), '深圳');
    assert.equal(await dialog.getByLabel('启用月薪筛选', { exact: true }).isChecked(), true);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
  }
  const browserFlow = {
    formatVersion: '1.0',
    id: 'browser-frame-ui',
    name: '框架定位示例',
    description: 'local UI only',
    parameters: {},
    requiredCapabilities: [],
    steps: [
      {
        id: 'browser',
        type: 'browser',
        version: 1,
        operation: 'navigate',
        selector: '',
        value: 'https://example.com',
      },
    ],
  };
  await page.evaluate(
    (flow) =>
      window.flowark.request('flow.save', { flow, bindings: { files: {}, credentials: [] } }),
    browserFlow,
  );
  await page.getByRole('button', { name: '我的流程', exact: true }).click();
  await page.getByRole('button', { name: '编辑 框架定位示例', exact: true }).click();
  await page.locator('[data-step-id="browser"]').click();
  assert.equal(JSON.parse(await page.locator('.inspector .code-input').inputValue()).version, 1);
  assert.equal(await page.getByLabel('iframe 路径', { exact: true }).isDisabled(), true);
  await page.getByLabel('操作', { exact: true }).selectOption('read');
  await page.getByLabel('目标元素选择器', { exact: true }).fill('#receipt');
  const frameInput = page.getByLabel('iframe 路径', { exact: true });
  await frameInput.fill('iframe#outer');
  await frameInput.press('End');
  await frameInput.press('Enter');
  await frameInput.pressSequentially('iframe#inner');
  assert.equal(await frameInput.inputValue(), 'iframe#outer\niframe#inner');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '我的流程', exact: true }).click();
  await page.getByRole('button', { name: '编辑 框架定位示例', exact: true }).click();
  await page.locator('[data-step-id="browser"]').click();
  assert.equal(await frameInput.inputValue(), 'iframe#outer\niframe#inner');
  const framedNode = JSON.parse(await page.locator('.inspector .code-input').inputValue());
  assert.equal(framedNode.version, 2);
  assert.deepEqual(framedNode.framePath, ['iframe#outer', 'iframe#inner']);
  assert.equal(framedNode.selector, '#receipt');
  await page.screenshot({ path: 'test-results/browser-frame-editor.png', fullPage: true });
  await page.getByLabel('操作', { exact: true }).selectOption('screenshot');
  assert.equal(await frameInput.isDisabled(), true);
  assert.deepEqual(
    JSON.parse(await page.locator('.inspector .code-input').inputValue()).framePath,
    [],
  );
  await page.getByLabel('操作', { exact: true }).selectOption('read');
  await frameInput.fill('iframe#outer\niframe#inner');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByLabel('操作', { exact: true }).selectOption('select');
  await page.getByLabel('选择方式', { exact: true }).selectOption('multiple');
  await page.getByLabel('选项值', { exact: true }).fill('ts\nqa');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '我的流程', exact: true }).click();
  await page.getByRole('button', { name: '编辑 框架定位示例', exact: true }).click();
  await page.locator('[data-step-id="browser"]').click();
  const formNode = JSON.parse(await page.locator('.inspector .code-input').inputValue());
  assert.equal(formNode.version, 3);
  assert.deepEqual(formNode.value, ['ts', 'qa']);
  assert.deepEqual(formNode.framePath, ['iframe#outer', 'iframe#inner']);
  await page.screenshot({ path: 'test-results/browser-form-editor.png', fullPage: true });
  await page.getByLabel('操作', { exact: true }).selectOption('check');
  await page.getByLabel('目标状态', { exact: true }).selectOption('false');
  assert.equal(JSON.parse(await page.locator('.inspector .code-input').inputValue()).value, false);
  await page.getByLabel('操作', { exact: true }).selectOption('press');
  await page.getByLabel('按键', { exact: true }).selectOption('ArrowRight');
  assert.equal(
    JSON.parse(await page.locator('.inspector .code-input').inputValue()).value,
    'ArrowRight',
  );
  await page.getByLabel('操作', { exact: true }).selectOption('inputValue');
  assert.equal(JSON.parse(await page.locator('.inspector .code-input').inputValue()).value, null);
  assert.equal(await page.locator('.inspector').getByText(/招聘/).count(), 0);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  // Use saved structured steps to exercise the same graph projection as normal editing.
  const graphFlow = {
    formatVersion: '1.0',
    id: 'shape-smoke',
    name: '条件分支示例',
    description: '虚构图形回归',
    parameters: {},
    requiredCapabilities: [],
    steps: [
      {
        id: 'decision',
        type: 'condition',
        version: 1,
        name: '检查结果是否有效',
        actual: true,
        operator: 'equals',
        expected: true,
        then: [
          { id: 'manual', type: 'human', version: 1, name: '确认处理结果', message: '虚构测试' },
        ],
        else: [
          {
            id: 'script',
            type: 'script',
            version: 1,
            name: '整理异常信息',
            language: 'js',
            code: 'export default async () => null;',
            input: {},
            dependencies: [],
          },
        ],
      },
      {
        id: 'document',
        type: 'file',
        version: 1,
        operation: 'write',
        binding: 'workspace',
        name: '处理报告.txt',
        content: '虚构数据',
      },
    ],
  };
  await page.evaluate(
    (flow) =>
      window.flowark.request('flow.save', { flow, bindings: { files: {}, credentials: [] } }),
    graphFlow,
  );
  await page.getByRole('button', { name: '我的流程', exact: true }).click();
  await page.getByRole('button', { name: '编辑 条件分支示例', exact: true }).click();
  await page.locator('[data-step-id="decision"]').click();
  assert.equal(
    JSON.parse(await page.locator('.inspector .code-input').inputValue()).id,
    'decision',
  );
  for (const shape of ['decision', 'manual', 'subprocess', 'document'])
    assert.equal(await page.locator(`.canvas [data-shape="${shape}"]`).count(), 1);
  assert.equal(await page.locator('.canvas [data-shape="terminal"]').count(), 2);
  assert.equal(await page.locator('.canvas [data-shape="join"]').count(), 1);
  await page.getByText('成立', { exact: true }).waitFor();
  await page.getByText('否则', { exact: true }).waitFor();
  await assertOutputOnOutline('document');
  await page.screenshot({ path: 'test-results/flowchart-branches.png', fullPage: true });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const persisted = await page.evaluate(() => window.flowark.request('bootstrap'));
  assert.deepEqual(
    persisted.flows.find((r) => r.flow.id === 'shape-smoke').flow.steps,
    graphFlow.steps,
  );
  const loopFlow = {
    ...graphFlow,
    id: 'loop-shape-smoke',
    name: '循环与数据示例',
    steps: [
      { id: 'input', type: 'value', version: 1, name: '待处理数据', value: [1, 2] },
      {
        id: 'loop',
        type: 'loop',
        version: 1,
        name: '逐条处理数据',
        items: { $ref: 'steps.input' },
        body: [
          {
            id: 'workbook',
            type: 'excel',
            version: 1,
            operation: 'write',
            binding: 'workspace',
            name: '结果.xlsx',
            rows: [],
          },
        ],
      },
    ],
  };
  await page.evaluate(
    (flow) =>
      window.flowark.request('flow.save', { flow, bindings: { files: {}, credentials: [] } }),
    loopFlow,
  );
  await page.getByRole('button', { name: '我的流程', exact: true }).click();
  await page.getByRole('button', { name: '编辑 循环与数据示例', exact: true }).click();
  await page.locator('[data-step-id="loop"]').click();
  for (const shape of ['data', 'loop', 'workbook'])
    assert.equal(await page.locator(`.canvas [data-shape="${shape}"]`).count(), 1);
  await page.getByText('下一项', { exact: true }).waitFor();
  await page.getByText('完成', { exact: true }).waitFor();
  await assertOutputOnOutline('workbook');
  await page.screenshot({ path: 'test-results/flowchart-loop.png', fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(
    'test-results/desktop.json',
    JSON.stringify(
      {
        time: new Date().toISOString(),
        security,
        state: result.runs[0].state,
        dataPath: data,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'Desktop smoke passed: encrypted storage, secure IPC, real Worker execution, React Flow and Monaco',
  );
} catch (error) {
  console.error('Desktop verification failed:', error);
  process.exitCode = 1;
} finally {
  // Playwright's app.close invokes quit under the inspector. Invoke the app's menu
  // path so its asynchronous resource shutdown can complete before inspector exit.
  const ended = new Promise((resolve) =>
    app.process().once('exit', (code, signal) => resolve({ code, signal })),
  );
  await app
    .evaluate(({ Menu }) => {
      setTimeout(
        () =>
          Menu.getApplicationMenu()
            .items[0].submenu.items.find((item) => item.label === '退出 FlowArk')
            .click(),
        100,
      );
    })
    .catch(() => {});
  const timer = setTimeout(() => app.process().kill('SIGKILL'), 10000);
  const exit = await ended;
  clearTimeout(timer);
  assert.equal(exit.signal, null, 'Application required a forced termination');
  assert.equal(exit.code, 0, 'Application exited abnormally');
}
