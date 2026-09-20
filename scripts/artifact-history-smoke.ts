import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Store } from '../src/host/store';

const data = await mkdtemp('/private/tmp/flowark-artifact-history-');
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
  const wait = async (predicate: () => Promise<boolean>) => {
    const end = Date.now() + 20000;
    while (!(await predicate())) {
      if (Date.now() > end) throw new Error('产物历史验收等待超时');
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
  const created = await call('flow.create');
  await call('flow.save', {
    flow: {
      ...created.flow,
      name: '虚构产物历史验收',
      steps: ['first', 'later'].map((content, i) => ({
        id: 'write' + i,
        type: 'file',
        version: 1,
        operation: 'write',
        binding: 'work',
        name: 'result.txt',
        content,
      })),
    },
    bindings: { files: { work: data }, credentials: [] },
  });
  const run = await call('flow.run', { id: created.id });
  let detail: any;
  await wait(async () => {
    detail = await call('run.detail', { id: run.id });
    return ['SUCCEEDED', 'FAILED'].includes(detail.run.state);
  });
  assert.equal(detail.run.state, 'SUCCEEDED', detail.run.error);
  const [first, later] = detail.artifacts;
  assert.equal(await readFile(first.path, 'utf8'), 'first');
  assert.equal(await readFile(later.path, 'utf8'), 'later');
  await rm(join(data, 'result.txt'));
  // Only this test's fresh encrypted store is opened while its app is stopped.
  const key = Buffer.from(
    await app.evaluate(
      async ({ safeStorage }, encrypted) =>
        (await safeStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'))).result,
      (await readFile(join(data, 'credentials', 'data-key.enc'))).toString('base64'),
    ),
    'base64',
  );
  await app.close();
  await writeFile(join(data, 'legacy.txt'), 'then');
  const store = new Store(join(data, 'flowark.sqlite'), key);
  try {
    store.put('artifact', 'legacy-fixture', {
      artifactId: 'legacy-fixture',
      runId: run.id,
      name: 'legacy.txt',
      path: join(data, 'legacy.txt'),
      size: 4,
      time: new Date().toISOString(),
    });
  } finally {
    store.close();
  }
  app = await launch();
  page = await app.firstWindow();
  await page.waitForFunction(() => !!(window as any).flowark);
  await page.getByRole('button', { name: '运行记录', exact: true }).click();
  await page
    .getByRole('row')
    .filter({ hasText: run.id.slice(0, 8) })
    .getByRole('button', { name: '查看' })
    .click();
  const row = (id: string) => page.locator(`[data-artifact-id="${id}"]`);
  await row(first.artifactId).getByText('已保存副本', { exact: false }).waitFor();
  await row(later.artifactId).getByText('已保存副本', { exact: false }).waitFor();
  await row('legacy-fixture').getByText('旧记录，未保存副本', { exact: false }).waitFor();
  await app.evaluate(({ shell }) => {
    (globalThis as any).revealedArtifacts = [];
    shell.showItemInFolder = (path: string) => {
      (globalThis as any).revealedArtifacts.push(path);
    };
  });
  await row(first.artifactId).getByRole('button', { name: '定位副本', exact: true }).click();
  await row('legacy-fixture').getByRole('button', { name: '定位当前文件', exact: true }).click();
  await wait(
    async () => (await app.evaluate(() => (globalThis as any).revealedArtifacts)).length === 2,
  );
  assert.deepEqual(await app.evaluate(() => (globalThis as any).revealedArtifacts), [
    first.path,
    join(data, 'legacy.txt'),
  ]);
  evidence.checks.push(
    'same-name-independent-bytes-source-deletion-restart-and-legacy-labels',
    'real-reveal-ipc-resolves-copy-or-current-legacy-file',
  );
  await writeFile(first.path, 'other');
  await rm(later.path);
  await row(first.artifactId).getByText('副本内容已改动', { exact: false }).waitFor();
  await row(later.artifactId).getByText('文件已移动、删除或不可访问', { exact: false }).waitFor();
  assert.equal(await row(first.artifactId).getByRole('button').isDisabled(), true);
  assert.equal(await row(later.artifactId).getByRole('button').isDisabled(), true);
  await assert.rejects(call('artifact.reveal', { id: first.artifactId }), /副本内容已改动/);
  await assert.rejects(call('artifact.reveal', { id: later.artifactId }), /移动、删除/);
  assert.equal((await call('run.detail', { id: run.id })).run.state, 'SUCCEEDED');
  assert.equal((await app.evaluate(() => (globalThis as any).revealedArtifacts)).length, 2);
  await mkdir('test-results', { recursive: true });
  await row(first.artifactId).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/artifact-history.png' });
  evidence.checks.push(
    'same-length-tamper-and-missing-status-disabled-buttons-and-resolve-refusal',
  );
  evidence.passed = true;
  evidence.runId = run.id;
} finally {
  await app.close();
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/artifact-history.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
