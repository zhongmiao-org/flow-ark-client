import { embeddedHarness } from './fixtures/embedded-harness';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { Runtime } from '../src/host/runtime';
import type { Flow, FlowRecord, Run } from '../src/shared/types';

// Public automation fixture, fictional values, and a new dedicated profile only.
const root = await mkdtemp(join(tmpdir(), 'flowark-simple-site-'));
const output = join(root, 'output');
await mkdir(output);
process.env.PLAYWRIGHT_BROWSERS_PATH = join(root, 'empty-browser-cache');
process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';
const embedded = await embeddedHarness(root);
const runtime = new Runtime(
  root,
  resolve('dist'),
  process.execPath,
  randomBytes(32),
  embedded.system,
);
const report: Record<string, unknown> = {
  at: new Date().toISOString(),
  site: 'https://www.selenium.dev/selenium/web/web-form.html',
  root,
  headless: false,
  fictionalInput: true,
  realRecruiting: false,
  passed: false,
};

async function run(flowId: string) {
  const submitted = await runtime.enqueue(flowId);
  const deadline = Date.now() + 45000;
  while (true) {
    const current = runtime.store.get<Run>('run', submitted.id)!;
    if (['SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED'].includes(current.state)) return current;
    if (Date.now() > deadline) throw new Error('简单网站流程超过 45 秒');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function assertSuccess(current: Run) {
  assert.equal(current.state, 'SUCCEEDED', JSON.stringify(current));
  const started = runtime.store.events(current.id).filter((e) => e.type === 'node-start');
  assert.equal(started.filter((e) => e.nodeInstance === 'submit').length, 1);
  assert.ok(started.some((e) => e.nodeInstance === 'receipt_branch/save_excel'));
  assert.ok(!started.some((e) => e.nodeInstance === 'receipt_branch/unexpected_receipt'));
  const artifacts = runtime.store.list<any>('artifact').filter((a) => a.runId === current.id);
  assert.equal(artifacts.length, 2);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(join(output, 'simple-web-result.xlsx'));
  assert.equal(workbook.worksheets[0].getCell('B2').value, 'Received!');
  assert.equal(workbook.worksheets[0].getCell('B4').value, 'Form submitted');
  const screenshot = artifacts.find((a) => a.path.endsWith('.png'));
  assert.ok(screenshot);
  const png = await readFile(screenshot.path);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  return {
    runId: current.id,
    state: current.state,
    nodesExecuted: started.length,
    screenshot: screenshot.path,
  };
}

try {
  const browser = await runtime.request('browser.embedded.enable');
  assert.equal(browser.product, 'chrome');
  report.browser = { product: browser.product, version: browser.version };
  const content = await readFile(resolve('examples/simple-web-form.template.json'), 'utf8');
  const imported: FlowRecord = await runtime.request('flow.import', { content });
  assert.deepEqual(imported.bindings.files, {});
  assert.equal(imported.bindings.browserId, undefined);
  assert.equal(runtime.store.list('run').length, 0, '导入不能触发执行');
  const bindings = { files: { output }, browserId: browser.id, credentials: [] };
  runtime.saveFlow(imported.flow, bindings);
  report.first = await assertSuccess(await run(imported.id));
  console.log('首次真实网站流程通过');

  const missing: Flow = {
    ...imported.flow,
    id: 'missing-element-example',
    steps: [
      imported.flow.steps[0],
      {
        id: 'missing',
        type: 'browser',
        version: 1,
        operation: 'wait',
        selector: '#flowark-nonexistent-element',
        value: null,
        timeoutMs: 500,
      },
      {
        id: 'must_not_write',
        type: 'file',
        version: 1,
        operation: 'write',
        binding: 'output',
        name: 'must-not-exist.txt',
        content: 'unexpected',
      },
    ],
  };
  runtime.saveFlow(missing, bindings);
  const failed = await run(missing.id);
  report.missing = { state: failed.state, error: failed.error };
  assert.equal(failed.state, 'FAILED');
  assert.ok(!runtime.store.events(failed.id).some((e) => e.nodeInstance === 'must_not_write'));
  await assert.rejects(readFile(join(output, 'must-not-exist.txt')), { code: 'ENOENT' });
  console.log('缺失元素失败，后续文件节点未执行');

  report.afterFailure = await assertSuccess(await run(imported.id));
  console.log('失败后的新运行通过');
  report.passed = true;
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  try {
    await runtime.shutdown();
    report.shutdownCompleted = true;
  } catch (error) {
    report.passed = false;
    report.shutdownError = String(error);
    throw error;
  } finally {
    runtime.store.close();
    await embedded.shutdown();
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/simple-site.json', JSON.stringify(report, null, 2) + '\n');
  }
}
