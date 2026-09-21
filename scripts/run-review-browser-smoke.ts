import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Runtime } from '../src/host/runtime';
import type { Flow, Run } from '../src/shared/types';
import type { EmbeddedReview, RunReviewPreview } from '../src/shared/run-review';
import { embeddedHarness } from './fixtures/embedded-harness';

const data = await mkdtemp('/private/tmp/flowark-review-browser-');
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(
    req.url?.startsWith('/frame')
      ? '<html><body><p>iframe fixture</p></body></html>'
      : '<html><head><title>试运行检查夹具</title></head><body><input id="name"><iframe id="frame" src="/frame?first"></iframe><button id="route" onclick="history.pushState({},\'\',\'#changed\')">页面内导航</button></body></html>',
  );
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${(server.address() as any).port}/`;
let h: Awaited<ReturnType<typeof embeddedHarness>> | undefined;
let runtime: Runtime | undefined;
const evidence: any = { passed: false, closed: false, data, checks: [] };
const wait = async (check: () => Promise<boolean> | boolean, label: string) => {
  const end = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(label);
    await new Promise((done) => setTimeout(done, 25));
  }
};
const confirmArgs = (p: RunReviewPreview) => ({
  id: p.flow.id,
  token: p.token!,
  debug: p.debug,
  reviewed: true,
  requestId: randomUUID(),
});
try {
  h = await embeddedHarness(data);
  await h.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setTitle('FlowArk · 试运行资源隔离测试（自动退出）'),
  );
  runtime = new Runtime(data, resolve('dist'), process.execPath, randomBytes(32), h.system);
  await runtime.ready;
  await runtime.request('browser.embedded.enable');
  const files = join(data, 'files');
  await mkdir(files);
  const flow: Flow = {
    id: 'native-review',
    name: '内置网页与文件试运行',
    formatVersion: '1.0',
    description: '',
    parameters: {},
    requiredCapabilities: [],
    steps: [
      { id: 'open', type: 'browser', version: 1, operation: 'navigate', selector: '', value: url },
      {
        id: 'fill',
        type: 'browser',
        version: 1,
        operation: 'fill',
        selector: '#name',
        value: 'confirmed native output',
      },
      {
        id: 'read',
        type: 'browser',
        version: 3,
        operation: 'inputValue',
        selector: '#name',
        value: null,
        framePath: [],
      },
      {
        id: 'save',
        type: 'file',
        version: 1,
        operation: 'write',
        binding: 'work',
        name: 'output.txt',
        content: { $ref: 'steps.read' },
      },
    ],
  };
  runtime.saveFlow(flow, { files: { work: files }, credentials: [], browserId: h.binding.id });
  const review = (): Promise<RunReviewPreview> =>
    runtime!.request('flow.run.preview', { id: flow.id });
  const browserReview = (): Promise<EmbeddedReview> => h!.system('browser.embedded.review');
  const initial = await browserReview(),
    cold = await review();
  assert.equal(cold.ready, true, cold.checks[0]?.detail);
  assert.equal(initial.started, false);
  assert.deepEqual(await browserReview(), initial);
  assert.equal(runtime.store.list('run').length, 0);
  assert.equal(runtime.store.list('version').length, 0);
  evidence.checks.push('cold-preview-does-not-create-webcontents-or-run');
  await h.system('browser.embedded.navigate', { url });
  await wait(async () => !(await browserReview()).loading, 'initial native page load');
  const beforeReload = await review(),
    original = await browserReview();
  await h.app.evaluate(() => (globalThis as any).embeddedFixture.resource.contents.reload());
  await wait(async () => {
    const current = await browserReview();
    return !current.loading && current.documentRevision > original.documentRevision;
  }, 'same URL reload revision');
  assert.equal((await browserReview()).url, original.url);
  const beforeReloadResult = await runtime.request('flow.run.confirm', confirmArgs(beforeReload));
  assert.equal(beforeReloadResult.rejected, true);
  assert.match(beforeReloadResult.message, /过期/);
  evidence.checks.push('same-url-native-reload-invalidates-token');
  const beforeFrame = await review(),
    frameRevision = (await browserReview()).documentRevision;
  await h.app.evaluate(async () =>
    (globalThis as any).embeddedFixture.resource.contents.executeJavaScript(
      "document.querySelector('#frame').src = '/frame?second'",
    ),
  );
  await wait(async () => {
    const current = await browserReview();
    return !current.loading && current.documentRevision > frameRevision;
  }, 'iframe revision');
  const beforeFrameResult = await runtime.request('flow.run.confirm', confirmArgs(beforeFrame));
  assert.equal(beforeFrameResult.rejected, true);
  assert.match(beforeFrameResult.message, /过期/);
  evidence.checks.push('native-iframe-navigation-invalidates-token');
  const beforeSpa = await review(),
    spaRevision = (await browserReview()).documentRevision;
  await h.system('browser.embedded.perform', {
    command: { operation: 'click', selector: '#route', value: null },
  });
  await wait(
    async () => (await browserReview()).documentRevision > spaRevision,
    'same document navigation',
  );
  const beforeSpaResult = await runtime.request('flow.run.confirm', confirmArgs(beforeSpa));
  assert.equal(beforeSpaResult.rejected, true);
  assert.match(beforeSpaResult.message, /过期/);
  assert.equal(runtime.store.list('run').length, 0);
  evidence.checks.push('native-pushstate-invalidates-token-with-zero-run');
  const final = await review();
  assert.equal(final.ready, true, final.checks[0]?.detail);
  const input = confirmArgs(final),
    run: Run = await runtime.request('flow.run.confirm', input);
  await wait(
    () =>
      ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(
        runtime!.store.get<Run>('run', run.id)?.state ?? '',
      ) && !(runtime as any).active,
    'real reviewed Worker completion',
  );
  const result = await runtime.request('run.detail', { id: run.id });
  assert.equal(result.run.state, 'SUCCEEDED', result.run.error);
  assert.equal(result.output.read, 'confirmed native output');
  assert.equal(await readFile(join(files, 'output.txt'), 'utf8'), 'confirmed native output');
  assert.equal((await runtime.request('flow.run.confirm', input)).id, run.id);
  assert.equal(runtime.store.list('run').length, 1);
  evidence.runId = run.id;
  evidence.checks.push('real-worker-native-fill-read-file-output-and-idempotent-confirm');
  evidence.passed = true;
} finally {
  try {
    if (runtime) {
      await runtime.shutdown();
      runtime.store.close();
    }
    if (h) {
      const owned = h;
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          owned.shutdown(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('owned Electron shutdown timed out')), 20000);
          }),
        ]);
      } catch (error) {
        owned.app.process().kill('SIGKILL');
        throw error;
      } finally {
        clearTimeout(timer);
      }
      evidence.closed = true;
    }
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/run-review-browser.json', JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  }
}
