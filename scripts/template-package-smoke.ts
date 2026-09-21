import { desktopElectron as electron } from './desktop-session.mjs';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { exportDefinition } from '../src/templates/export';
import { writeArchive, readArchive } from '../src/templates/archive';
const data = await mkdtemp(join(tmpdir(), 'template-ui-'));
const definition = await exportDefinition(
  {
    id: 'fixture',
    name: 'Generic fixture',
    formatVersion: '1.0',
    description: '',
    parameters: {},
    requiredCapabilities: ['value'],
    steps: [{ id: 'value', type: 'value', version: 1, value: 'fixture' }],
  } as any,
  {
    schema: {
      type: 'object',
      properties: { title: { type: 'string', title: 'Fixture title', default: 'Original' } },
      required: ['title'],
      additionalProperties: false,
    },
  },
);
const source = join(data, 'fixture.zip');
await writeArchive(definition, source);
const exported = join(data, 'exported.zip');
const local = join(data, 'local.zip');
const app = await electron.launch({
  executablePath: process.env.FLOWARK_TEST_EXECUTABLE || String(electronPath),
  args: process.env.FLOWARK_TEST_EXECUTABLE ? [] : [resolve('.')],
  env: { ...process.env, FLOWARK_DATA_DIR: join(data, 'user') },
});
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean((window as any).flowark));
  const call = (method: string, args: any = {}) =>
    page.evaluate(({ method, args }) => (window as any).flowark.request(method, args), {
      method,
      args,
    });
  await app.evaluate(({ dialog }: any, path: string) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, source);
  const preview = await call('template.inspect');
  await call('template.cancelImport', { token: preview.token });
  await assert.rejects(call('template.install', { token: preview.token }), /失效/);
  const install = await call('template.install', { token: (await call('template.inspect')).token });
  const instance = await call('template.create', { key: install.key });
  await page.getByRole('button', { name: '模板库', exact: true }).click();
  await page
    .getByRole('button', { name: new RegExp('Generic fixture · ' + instance.id.slice(0, 8)) })
    .click();
  await page.getByLabel('Fixture title', { exact: true }).fill('Changed');
  await page.getByRole('button', { name: '保存实例配置', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[role=alert]') ||
      document.querySelector('[role=status]')?.textContent?.includes('实例配置已保存'),
  );
  if (await page.getByRole('alert').count())
    throw new Error(await page.getByRole('alert').innerText());
  assert.equal(
    (await call('template.detail', { id: instance.id })).instance.configuration.title,
    'Changed',
  );
  await app.evaluate(({ dialog }: any, path: string) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, exported);
  await call('template.export', { key: install.key });
  assert.equal(
    (await readArchive(exported)).manifest.contentDigest,
    definition.manifest.contentDigest,
  );
  const flow = (await call('bootstrap')).flows[0].flow;
  flow.name = 'Local fork';
  await app.evaluate(({ dialog }: any, path: string) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    dialog.showMessageBox = async () => ({ response: 1 });
  }, local);
  await call('flow.export', { flow, reviewed: true });
  const fork = await readArchive(local);
  assert.notEqual(fork.manifest.id, definition.manifest.id);
  assert.ok(![...fork.files.values()].some((b) => b.includes('Changed')));
  // A workflow created locally must travel through the same ZIP importer.
  const custom = await call('flow.create');
  custom.flow.name = 'Custom ZIP workflow';
  custom.flow.parameters = { text: 'private-instance-value' };
  custom.flow.steps = [
    {
      id: 'script',
      type: 'script',
      version: 1,
      language: 'ts',
      code: 'export default async ({input}:{input:{text:string}}) => input.text.toUpperCase();',
      input: { text: { $ref: 'params.text' } },
      dependencies: [],
    },
    {
      id: 'file',
      type: 'file',
      version: 1,
      operation: 'write',
      binding: 'output',
      name: 'result.txt',
      content: { $ref: 'steps.script' },
    },
  ];
  await call('flow.save', { flow: custom.flow, bindings: custom.bindings });
  await page.reload();
  await page.getByRole('button', { name: '编辑 Custom ZIP workflow', exact: true }).click();
  const customPath = join(data, 'custom-export');
  await app.evaluate(({ dialog }: any, path: string) => {
    dialog.showSaveDialog = async (_win: unknown, options: any) => {
      (globalThis as any).lastExportFilename = options.defaultPath;
      return { canceled: false, filePath: path };
    };
  }, customPath);
  await page.getByRole('button', { name: '导出 ZIP', exact: true }).click();
  for (let i = 0; i < 100; i++) {
    try {
      await readFile(customPath + '.zip');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const customPackage = await readArchive(customPath + '.zip');
  assert.equal(
    await app.evaluate(() => (globalThis as any).lastExportFilename),
    `${customPackage.manifest.id}-1.0.0.flowark-template.zip`,
  );
  assert.ok(![...customPackage.files.values()].some((b) => b.includes('private-instance-value')));
  await app.evaluate(({ dialog }: any, path: string) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, customPath + '.zip');
  const customInstall = await call('template.install', {
    token: (await call('template.inspect')).token,
  });
  const customInstance = await call('template.create', { key: customInstall.key });
  await page.getByRole('button', { name: '模板库', exact: true }).click();
  await page
    .getByRole('button', {
      name: new RegExp('Custom ZIP workflow · ' + customInstance.id.slice(0, 8)),
    })
    .click();
  await page.getByRole('textbox', { name: 'text', exact: true }).fill('roundtrip works');
  await page.getByRole('button', { name: '保存入口参数', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '入口参数已保存' }).waitFor();
  await assert.rejects(call('flow.run', { id: customInstance.entryFlows.run }), /授权/);
  const output = join(data, 'output');
  await mkdir(output);
  await call('template.configure', {
    id: customInstance.id,
    configuration: {},
    resources: { output: { path: output } },
    grants: { 'workflow-write': 'auto' },
  });
  const customRun = await call('flow.run', { id: customInstance.entryFlows.run });
  for (let i = 0; i < 200; i++) {
    const result = await call('run.detail', { id: customRun.id });
    if (['SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(result.run.state)) {
      assert.equal(result.run.state, 'SUCCEEDED', result.run.error);
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(await readFile(join(output, 'result.txt'), 'utf8'), 'ROUNDTRIP WORKS');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/template-package-ui.png', fullPage: true });
  console.log(
    'Template ZIP export, custom workflow UI export/import, default-denied resource binding and real script/file execution passed',
  );
} finally {
  await app.close();
}
