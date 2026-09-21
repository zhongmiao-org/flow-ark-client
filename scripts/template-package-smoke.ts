import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
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
  await page.waitForFunction(()=>document.querySelector('[role=alert]')||document.querySelector('[role=status]')?.textContent?.includes('实例配置已保存'));
  if(await page.getByRole('alert').count())throw new Error(await page.getByRole('alert').innerText());
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
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/template-package-ui.png', fullPage: true });
  console.log(
    'Template import cancellation, configuration, export isolation and local fork passed',
  );
} finally {
  await app.close();
}
