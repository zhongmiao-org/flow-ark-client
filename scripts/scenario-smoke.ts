import { embeddedHarness } from './fixtures/embedded-harness';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { startFrameFixture } from './fixtures/frames';
import { Runtime } from '../src/host/runtime';
import type { Flow, Run } from '../src/shared/types';
const root = await mkdtemp(join(tmpdir(), 'flowark-scenario-'));
process.env.PLAYWRIGHT_BROWSERS_PATH = join(root, 'empty-browser-cache');
let received: Buffer | undefined;
const server = createServer((req, res) => {
  if (req.url === '/data') {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify([
        { name: '虚构甲', score: 8 },
        { name: '虚构乙', score: 9 },
      ]),
    );
    return;
  }
  if (req.url === '/upload' && req.method === 'POST') {
    const parts: Buffer[] = [];
    req.on('data', (part) => parts.push(part));
    req.on('end', () => {
      received = Buffer.concat(parts);
      res.end('local-upload-confirmed');
    });
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(
    '<!doctype html><title>FlowArk 通用引擎本地回归</title><h1>虚构 Excel 上传验证</h1><input type="file" id="file"><button id="send">本地上传</button><p id="receipt"></p><script>document.querySelector("#send").onclick=async()=>{document.querySelector("#receipt").textContent=await fetch("/upload",{method:"POST",body:await document.querySelector("#file").files[0].arrayBuffer()}).then(r=>r.text())}</script>',
  );
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${(server.address() as any).port}`;
const frames = await startFrameFixture();
const embedded = await embeddedHarness(root);
const runtime = new Runtime(
  root,
  resolve('dist'),
  process.execPath,
  randomBytes(32),
  embedded.system,
);
try {
  const browser = await runtime.request('browser.embedded.enable');
  const flow: Flow = {
    id: 'regression',
    name: 'HTTP 到 Excel 上传核对',
    description: '仅虚构数据与 localhost',
    formatVersion: '1.0',
    parameters: {},
    requiredCapabilities: [],
    steps: [
      {
        id: 'fetch',
        type: 'http',
        version: 1,
        method: 'GET',
        url: url + '/data',
        headers: {},
        body: null,
      },
      {
        id: 'transform',
        type: 'script',
        version: 1,
        language: 'ts',
        dependencies: [],
        input: { $ref: 'steps.fetch' },
        code: 'export default ({input,progress}) => { progress(input.length,input.length); return [["姓名","分数"], ...input.map((x: {name:string;score:number})=>[x.name,x.score*10])]; }',
      },
      {
        id: 'excel',
        type: 'excel',
        version: 1,
        operation: 'write',
        binding: 'work',
        name: 'fixture.xlsx',
        rows: { $ref: 'steps.transform' },
      },
      { id: 'open', type: 'browser', version: 1, operation: 'navigate', selector: '', value: url },
      {
        id: 'upload',
        type: 'browser',
        version: 1,
        operation: 'upload',
        selector: '#file',
        value: { binding: 'work', name: 'fixture.xlsx' },
      },
      {
        id: 'submit',
        type: 'browser',
        version: 1,
        operation: 'click',
        selector: '#send',
        value: null,
      },
      {
        id: 'wait',
        type: 'browser',
        version: 1,
        operation: 'wait',
        selector: '#receipt:not(:empty)',
        value: null,
      },
      {
        id: 'receipt',
        type: 'browser',
        version: 1,
        operation: 'read',
        selector: '#receipt',
        value: null,
      },
      {
        id: 'verify',
        type: 'assert',
        version: 1,
        actual: { $ref: 'steps.receipt' },
        operator: 'equals',
        expected: 'local-upload-confirmed',
      },
    ],
  };
  runtime.saveFlow(flow, { files: { work: root }, browserId: browser.id, credentials: [] });
  const run = await runtime.enqueue(flow.id);
  const deadline = Date.now() + 60000;
  let current: Run;
  do {
    await new Promise((resolve) => setTimeout(resolve, 100));
    current = runtime.store.get<Run>('run', run.id)!;
    if (Date.now() > deadline) throw new Error('scenario timed out');
  } while (!['SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED'].includes(current.state));
  assert.equal(current.state, 'SUCCEEDED', JSON.stringify(current));
  assert.ok(received);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(received as any);
  assert.equal(book.worksheets[0].getCell('B3').value, 90);
  assert.equal(runtime.store.list('artifact').length, 1);
  async function waitRun(id: string) {
    const deadline = Date.now() + 30000;
    while (true) {
      const r = runtime.store.get<Run>('run', id)!;
      if (['SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED'].includes(r.state)) return r;
      if (Date.now() > deadline) throw new Error('frame scenario timed out');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  const framePath: ['#outer', '#inner'] = ['#outer', '#inner'];
  const framedFlow: Flow = {
    ...flow,
    id: 'frame-scenario',
    name: '跨源框架上传核对',
    requiredCapabilities: ['browser-frames-v1'],
    steps: [
      {
        id: 'open',
        type: 'browser',
        version: 1,
        operation: 'navigate',
        selector: '',
        value: frames.url,
      },
      {
        id: 'upload',
        type: 'browser',
        version: 2,
        operation: 'upload',
        selector: '#upload',
        value: { binding: 'work', name: 'fixture.xlsx' },
        framePath,
      },
      {
        id: 'send',
        type: 'browser',
        version: 2,
        operation: 'click',
        selector: '#send',
        value: null,
        framePath,
      },
      {
        id: 'wait',
        type: 'browser',
        version: 2,
        operation: 'wait',
        selector: '#receipt:not(:empty)',
        value: null,
        framePath,
      },
      {
        id: 'read',
        type: 'browser',
        version: 2,
        operation: 'read',
        selector: '#receipt',
        value: null,
        framePath,
      },
      {
        id: 'verify',
        type: 'assert',
        version: 1,
        actual: { $ref: 'steps.read' },
        operator: 'equals',
        expected: 'frame-upload-confirmed',
      },
      {
        id: 'top',
        type: 'browser',
        version: 1,
        operation: 'read',
        selector: '#value',
        value: null,
      },
      {
        id: 'verify_top',
        type: 'assert',
        version: 1,
        actual: { $ref: 'steps.top' },
        operator: 'equals',
        expected: 'top',
      },
      {
        id: 'download',
        type: 'browser',
        version: 2,
        operation: 'download',
        selector: '#download',
        value: 'framed.txt',
        framePath,
      },
    ],
  };
  const bindings = { files: { work: root }, browserId: browser.id, credentials: [] };
  runtime.saveFlow(framedFlow, bindings);
  const frameRun = await waitRun((await runtime.enqueue(framedFlow.id)).id);
  assert.equal(frameRun.state, 'SUCCEEDED', JSON.stringify(frameRun));
  const uploadedBook = new ExcelJS.Workbook();
  assert.equal(frames.state.uploads.length, 1);
  await uploadedBook.xlsx.load(frames.state.uploads[0] as any);
  assert.equal(uploadedBook.worksheets[0].getCell('B3').value, 90);
  const downloaded: any = runtime.store.list<any>('artifact').find((a) => a.runId === frameRun.id);
  assert.ok(downloaded);
  assert.equal(await readFile(downloaded.path, 'utf8'), 'frame-download');
  const wrong: Flow = {
    ...framedFlow,
    id: 'frame-missing',
    steps: [
      framedFlow.steps[0],
      {
        id: 'wrong',
        type: 'browser',
        version: 2,
        operation: 'click',
        selector: '#action',
        value: null,
        framePath: ['#missing'],
        timeoutMs: 300,
      },
    ],
  };
  runtime.saveFlow(wrong, bindings);
  assert.equal((await waitRun((await runtime.enqueue(wrong.id)).id)).state, 'FAILED');
  assert.deepEqual(frames.state.clicks, []);
  const waiting: Flow = {
    ...wrong,
    id: 'frame-cancel',
    steps: [
      framedFlow.steps[0],
      {
        id: 'waiting',
        type: 'browser',
        version: 2,
        operation: 'wait',
        selector: '#never',
        value: null,
        framePath,
        timeoutMs: 20000,
      },
      {
        id: 'must_not_click',
        type: 'browser',
        version: 2,
        operation: 'click',
        selector: '#action',
        value: null,
        framePath,
      },
    ],
  };
  runtime.saveFlow(waiting, bindings);
  const cancelRun = await runtime.enqueue(waiting.id);
  const cancelDeadline = Date.now() + 15000;
  while (
    !runtime.store
      .events(cancelRun.id)
      .some((e) => e.type === 'node-start' && e.nodeInstance === 'waiting')
  ) {
    if (Date.now() > cancelDeadline) throw new Error('did not reach frame wait');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await runtime.control(cancelRun.id, 'cancel');
  assert.equal((await waitRun(cancelRun.id)).state, 'CANCELLED');
  assert.deepEqual(frames.state.clicks, []);
  const afterCancel = await waitRun((await runtime.enqueue(framedFlow.id)).id);
  await mkdir('test-results', { recursive: true });
  await writeFile(
    'test-results/scenario-frames.json',
    JSON.stringify(
      {
        time: new Date().toISOString(),
        browser: browser.product,
        version: browser.version,
        fixture: 'localhost only, two origins, fictional data',
        frameRun: {
          state: frameRun.state,
          uploadedWorkbookB3: uploadedBook.worksheets[0].getCell('B3').value,
          downloadedContent: await readFile(downloaded.path, 'utf8'),
        },
        missingFrame: 'FAILED without click',
        cancelledFrame: 'CANCELLED without following click',
        afterCancel: { state: afterCancel.state, error: afterCancel.error ?? null },
        realRecruiting: false,
      },
      null,
      2,
    ),
  );
  assert.equal(afterCancel.state, 'SUCCEEDED', JSON.stringify(afterCancel));
  await mkdir('test-results', { recursive: true });
  await writeFile(
    'test-results/scenario.json',
    JSON.stringify(
      {
        time: new Date().toISOString(),
        state: current.state,
        browser: browser.product,
        version: browser.version,
        steps: flow.steps.length,
        receivedRows: book.worksheets[0].rowCount,
        fixture: 'localhost, fictional data',
        realRecruiting: false,
        frameChecks: [
          'nested-cross-origin-upload',
          'receipt',
          'top-level-isolation',
          'download-artifact',
          'missing-frame-no-side-effects',
          'cancel-frame-wait',
          'new-run-after-cancel',
        ],
        dedicatedProfile: true,
      },
      null,
      2,
    ),
  );
  console.log('Real framed upload, download, missing scope and cancellation passed');
  console.log('Real HTTP → TS child → Excel → embedded browser upload → receipt assertion passed');
} finally {
  await runtime.shutdown();
  runtime.store.close();
  await embedded.shutdown();
  server.close();
  await frames.close();
}
