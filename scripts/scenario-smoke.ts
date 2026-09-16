import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
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
const runtime = new Runtime(
  root,
  resolve('dist'),
  process.execPath,
  randomBytes(32),
  async () => [],
);
try {
  const browser = await runtime.request('browser.bind', {
    path: process.env.FLOWARK_CHROME_PATH ?? '/Applications/Google Chrome.app',
  });
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
        dedicatedProfile: true,
      },
      null,
      2,
    ),
  );
  console.log('Real HTTP → TS child → Excel → selected Chrome upload → receipt assertion passed');
} finally {
  await runtime.shutdown();
  runtime.store.close();
  server.close();
}
