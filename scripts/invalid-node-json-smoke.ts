import assert from 'node:assert/strict';
import { desktopElectron as electron } from './desktop-session.mjs';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { FlowRecord, Run } from '../src/shared/types';

const data = await mkdtemp('/private/tmp/flowark-invalid-node-json-');
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
const page = await app.firstWindow();
const note = (check: string) => {
  evidence.checks.push(check);
  console.log(check);
};
const call = (method: string, args: any = {}): Promise<any> =>
  page.evaluate(({ method, args }) => window.flowark.request(method, args), { method, args });
const button = (name: string) => page.getByRole('button', { name, exact: true });
const wait = async (check: () => Promise<boolean>, message: string) => {
  const deadline = Date.now() + 20000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('高级节点 JSON 验收超时：' + message);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
try {
  await page.waitForFunction(() => !!window.flowark);
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
  const created: FlowRecord = await call('flow.create');
  const saved: FlowRecord = await call('flow.save', {
    flow: {
      ...created.flow,
      name: '虚构高级 JSON 输入保护',
      parameters: {},
      requiredCapabilities: ['value', 'assert'],
      steps: [
        { id: 'value', type: 'value', version: 1, name: '原节点', value: 'ORIGINAL' },
        {
          id: 'verify',
          type: 'assert',
          version: 1,
          actual: { $ref: 'steps.value' },
          operator: 'equals',
          expected: 'CORRECTED',
        },
      ],
    },
    bindings: {
      files: {},
      credentials: [],
      configuration: {
        adapter: 'flow-parameters-v1',
        schema: {
          type: 'object',
          properties: { caption: { type: 'string', title: '测试备注' } },
          required: ['caption'],
          additionalProperties: false,
        },
        values: { caption: '原始配置' },
      },
    },
  });
  await button('编辑 ' + saved.flow.name).click();
  const select = async (id: string) => {
    const node = page.locator(`.react-flow__node[data-id="${id}"]`);
    await node.focus();
    await node.click();
  };
  await select('value');
  // Keep both undo and redo available before the invalid text is entered.
  await page.getByLabel('步骤名称', { exact: true }).fill('当前节点');
  await page.locator('.title-input').fill('暂时改名');
  await button('撤销编辑').click();
  assert.equal(await button('撤销编辑').isEnabled(), true);
  assert.equal(await button('重做编辑').isEnabled(), true);
  const details = page.locator('.node-advanced');
  const raw = page.getByLabel('节点配置 JSON', { exact: true });
  await details.locator('summary').click();
  const originalText = await raw.inputValue();
  const originalNode = JSON.parse(originalText);
  const baseline = await call('bootstrap');
  assert.equal(baseline.runs.length, 0);
  await app.evaluate(({ dialog }) => {
    const original = dialog.showMessageBox;
    (globalThis as any).invalidNodeJsonDialogs = { original, exports: 0 };
    dialog.showMessageBox = (async (...args: any[]) => {
      const options = args.at(-1);
      if (options.message === '确认已审阅流程中的字面量与脚本') {
        (globalThis as any).invalidNodeJsonDialogs.exports++;
        return { response: 0, checkboxChecked: false };
      }
      return Reflect.apply(original, dialog, args);
    }) as typeof dialog.showMessageBox;
  });
  const untouched = async () => {
    const boot = await call('bootstrap');
    assert.deepEqual(
      boot.flows.find((record: FlowRecord) => record.id === saved.id),
      saved,
    );
    assert.deepEqual(boot.runs, baseline.runs);
    assert.deepEqual(boot.schedules, baseline.schedules);
    assert.equal(await app.evaluate(() => (globalThis as any).invalidNodeJsonDialogs.exports), 0);
  };
  const focused = async () => {
    assert.equal(await details.evaluate((element) => (element as HTMLDetailsElement).open), true);
    assert.equal(await raw.evaluate((element) => document.activeElement === element), true);
  };
  const syntaxError = originalText.slice(0, -1);
  await raw.fill(syntaxError);
  assert.equal(await raw.getAttribute('aria-invalid'), 'true');
  for (const name of ['保存', '运行', '逐步调试', '导出']) {
    await button(name).click();
    await page
      .getByText('请先修正未完成的值配置，再' + (name === '导出' ? '导出' : '保存或运行'), {
        exact: true,
      })
      .waitFor();
    await wait(async () => await button('保存').isEnabled(), '拒绝 ' + name);
    await focused();
    await untouched();
  }
  note('syntax-error-blocks-save-run-debug-and-export-before-dialog-with-no-database-change');

  await details.locator('summary').click();
  assert.equal(await details.evaluate((element) => (element as HTMLDetailsElement).open), false);
  await button('运行').click();
  await focused();
  assert.equal(await raw.inputValue(), syntaxError);
  await untouched();
  note('closed-advanced-section-reopens-and-focuses-original-invalid-input');

  await select('verify');
  assert.equal(await page.locator('.flow-shape.is-selected').getAttribute('data-step-id'), 'value');
  await focused();
  for (const name of [
    '参数与绑定',
    '撤销编辑',
    '重做编辑',
    '返回流程',
    '我的流程',
    '运行记录',
    '本地设置',
  ]) {
    await button(name).click();
    await focused();
    assert.equal(await raw.inputValue(), syntaxError, name);
    assert.equal(await page.locator('.editor-page').count(), 1, name);
    await untouched();
  }
  for (const name of ['复制节点', '删除节点']) assert.equal(await button(name).isDisabled(), true);
  const count = await page.locator('.flow-shape[data-step-id]').count();
  await page.getByLabel('搜索动作', { exact: true }).fill('数据');
  await button('添加 数据').click();
  await focused();
  assert.equal(await page.locator('.flow-shape[data-step-id]').count(), count);
  await untouched();
  note('node-tab-structure-history-and-navigation-cannot-discard-invalid-text');

  await button('恢复节点配置').click();
  assert.equal(await raw.getAttribute('aria-invalid'), 'false');
  assert.equal(await raw.inputValue(), originalText);
  assert.equal(await page.getByLabel('步骤名称', { exact: true }).isEnabled(), true);
  await untouched();
  const changedId = JSON.stringify({ ...originalNode, id: 'different_id' }, null, 2);
  await raw.fill(changedId);
  await details.getByText('ID 和类型不可在此修改', { exact: true }).waitFor();
  for (const name of ['保存', '运行', '逐步调试', '导出']) {
    await button(name).click();
    await wait(async () => await button('保存').isEnabled(), '拒绝 ID 变化');
    await focused();
    await untouched();
  }
  await select('verify');
  assert.equal(await raw.inputValue(), changedId);
  await untouched();
  note('forbidden-id-change-has-the-same-execution-and-navigation-protection');

  const corrected = { ...originalNode, value: 'CORRECTED' };
  await raw.fill(JSON.stringify(corrected, null, 2));
  assert.equal(await raw.getAttribute('aria-invalid'), 'false');
  await select('verify');
  assert.equal(
    await page.locator('.flow-shape.is-selected').getAttribute('data-step-id'),
    'verify',
  );
  await select('value');
  await button('保存').click();
  await wait(async () => {
    const record: FlowRecord = (await call('bootstrap')).flows.find(
      (record: FlowRecord) => record.id === saved.id,
    );
    return (record.flow.steps[0] as any).value === 'CORRECTED';
  }, '保存修正后的值');
  await wait(async () => await button('运行').isEnabled(), '保存后可运行');
  // Hold only the reply; saving, queueing, and Worker execution still use the real Host.
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as any)._invokeHandlers as Map<
      string,
      (...args: any[]) => Promise<any>
    >;
    const original = handlers.get('flowark:request')!;
    const state = {
      original,
      method: 'run.detail',
      armed: true,
      pending: false,
      release: undefined as undefined | (() => void),
    };
    (globalThis as any).invalidNodeJsonReply = state;
    handlers.set('flowark:request', async (...args: any[]) => {
      const result = await original(...args);
      if (args[1] === state.method && state.armed) {
        state.armed = false;
        state.pending = true;
        await new Promise<void>((resolve) => {
          state.release = resolve;
        });
      }
      return result;
    });
  });
  await button('运行').click();
  await wait(
    () => app.evaluate(() => !!(globalThis as any).invalidNodeJsonReply.pending),
    '真实运行详情回复已暂缓',
  );
  const pendingRecord: FlowRecord = (await call('bootstrap')).flows.find(
    (record: FlowRecord) => record.id === saved.id,
  );
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open)))
    await details.locator('summary').click();
  const pendingText = JSON.stringify(corrected, null, 2).slice(0, -1);
  await raw.fill(pendingText);
  assert.equal(await raw.getAttribute('aria-invalid'), 'true');
  await details.locator('summary').click();
  await app.evaluate(() => (globalThis as any).invalidNodeJsonReply.release());
  await page
    .getByText('请先修正高级节点 JSON，或点击“恢复节点配置”放弃这段未完成输入', {
      exact: true,
    })
    .waitFor();
  await wait(async () => await button('保存').isEnabled(), '运行响应结束但保留错误输入');
  assert.equal(await page.locator('.editor-page').count(), 1);
  assert.equal(await raw.inputValue(), pendingText);
  await focused();
  assert.deepEqual(
    (await call('bootstrap')).flows.find((record: FlowRecord) => record.id === saved.id),
    pendingRecord,
  );
  note('late-run-detail-reply-keeps-new-invalid-text-and-refocuses-without-saving-it');
  let run: Run | undefined;
  await wait(async () => {
    run = (await call('bootstrap')).runs.find((item: Run) => item.flowId === saved.id);
    if (run && ['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(run.state))
      throw new Error(JSON.stringify(run));
    return run?.state === 'SUCCEEDED';
  }, '修正后真实执行成功');
  const detail = await call('run.detail', { id: run!.id });
  assert.equal(detail.output.value, 'CORRECTED');
  assert.deepEqual(detail.output.verify, { verified: true });
  assert.equal((await call('bootstrap')).runOverview.total, 1);
  assert.equal(await app.evaluate(() => (globalThis as any).invalidNodeJsonDialogs.exports), 0);
  evidence.runId = run!.id;
  note('valid-correction-unlocks-editor-and-real-worker-runs-corrected-values');
  await button('恢复节点配置').click();
  assert.equal(await raw.getAttribute('aria-invalid'), 'false');
  assert.deepEqual(JSON.parse(await raw.inputValue()), corrected);
  await button('运行记录').click();
  assert.equal(await page.locator('.editor-page').count(), 0);
  note('restoring-new-invalid-text-unlocks-navigation-without-cancelling-or-replaying-the-run');

  await button('我的流程').click();
  await button('编辑 ' + saved.flow.name).click();
  await select('value');
  await app.evaluate(() => {
    Object.assign((globalThis as any).invalidNodeJsonReply, {
      method: 'flow.save',
      armed: true,
      pending: false,
      release: undefined,
    });
  });
  await button('实例配置').click();
  await page.getByLabel('测试备注', { exact: true }).fill('已保存的配置');
  await button('保存配置').click();
  await wait(
    () => app.evaluate(() => !!(globalThis as any).invalidNodeJsonReply.pending),
    '实例配置真实保存回复已暂缓',
  );
  await button('关闭实例配置').click();
  await page.getByLabel('搜索动作', { exact: true }).fill('数据');
  await button('添加 数据').click();
  const addedId = await page.locator('.flow-shape.is-selected').getAttribute('data-step-id');
  assert.ok(addedId && !['value', 'verify'].includes(addedId));
  assert.equal(await page.locator('.flow-shape[data-step-id]').count(), 3);
  await details.locator('summary').click();
  const addedText = await raw.inputValue();
  const addedInvalidText = addedText.slice(0, -1);
  await raw.fill(addedInvalidText);
  assert.equal(await raw.getAttribute('aria-invalid'), 'true');
  const configurationRecord: FlowRecord = (await call('bootstrap')).flows.find(
    (record: FlowRecord) => record.id === saved.id,
  );
  assert.deepEqual(configurationRecord.bindings.configuration?.values, {
    caption: '已保存的配置',
  });
  assert.equal(configurationRecord.flow.steps.length, 2);
  await app.evaluate(() => (globalThis as any).invalidNodeJsonReply.release());
  await page
    .getByText('请先修正高级节点 JSON，或点击“恢复节点配置”放弃这段未完成输入', {
      exact: true,
    })
    .waitFor();
  await wait(async () => await button('保存').isEnabled(), '配置保存响应结束但保留新增节点');
  assert.equal(await page.locator('.flow-shape[data-step-id]').count(), 3);
  assert.equal(await page.locator('.flow-shape.is-selected').getAttribute('data-step-id'), addedId);
  assert.equal(await raw.inputValue(), addedInvalidText);
  await focused();
  await button('运行').click();
  await page.getByText('请先修正未完成的值配置，再保存或运行', { exact: true }).waitFor();
  await wait(async () => await button('保存').isEnabled(), '迟到配置响应后的无效输入仍阻止运行');
  const afterConfiguration = await call('bootstrap');
  assert.deepEqual(
    afterConfiguration.flows.find((record: FlowRecord) => record.id === saved.id),
    configurationRecord,
  );
  assert.equal(afterConfiguration.runOverview.total, 1);
  assert.equal(await app.evaluate(() => (globalThis as any).invalidNodeJsonDialogs.exports), 0);
  await focused();
  await button('恢复节点配置').click();
  assert.equal(await raw.inputValue(), addedText);
  assert.equal(await button('删除节点').isEnabled(), true);
  note('late-configuration-save-keeps-new-node-invalid-text-and-does-not-enable-stale-execution');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/invalid-node-json.png' });
  evidence.passed = true;
} catch (error) {
  evidence.error = String(error);
  await mkdir('test-results', { recursive: true });
  evidence.uiErrors = await page
    .locator('[role="alert"], .node-advanced .field-error')
    .allTextContents()
    .catch(() => []);
  evidence.bootstrap = await call('bootstrap').catch((error) => ({ error: String(error) }));
  await page.screenshot({ path: 'test-results/invalid-node-json-failure.png' }).catch(() => {});
  throw error;
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/invalid-node-json.json', JSON.stringify(evidence, null, 2));
  const boot = await call('bootstrap').catch(() => ({ runs: [] }));
  for (const run of boot.runs) {
    if (!['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(run.state))
      await call('run.control', { id: run.id, action: 'cancel' }).catch(() => {});
  }
  await app
    .evaluate(({ dialog, ipcMain }) => {
      const fixture = (globalThis as any).invalidNodeJsonDialogs;
      if (fixture) dialog.showMessageBox = fixture.original;
      const reply = (globalThis as any).invalidNodeJsonReply;
      if (reply) {
        reply.release?.();
        (ipcMain as any)._invokeHandlers.set('flowark:request', reply.original);
      }
    })
    .catch(() => {});
  await app.close();
}
