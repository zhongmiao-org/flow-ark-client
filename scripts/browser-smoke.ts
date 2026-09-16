import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { inspectBrowser } from '../src/adapters/browsers';
import { startFrameFixture } from './fixtures/frames';
import { PlaywrightDriver } from '../src/adapters/playwright';
const root = await mkdtemp(join(tmpdir(), 'flowark-browser-'));
const chrome = process.env.FLOWARK_CHROME_PATH ?? '/Applications/Google Chrome.app';
process.env.PLAYWRIGHT_BROWSERS_PATH = join(root, 'empty-browser-cache');
process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';
let uploaded = '';
const server = createServer((req, res) => {
  if (req.url === '/receipt' && req.method === 'POST') {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      uploaded = Buffer.concat(chunks).toString();
      res.end('已核对本地上传');
    });
    return;
  }
  if (req.url === '/download') {
    res.setHeader('Content-Disposition', 'attachment; filename="fictional.txt"');
    res.end('local-only');
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(
    '<!doctype html><title>FlowArk local fixture</title><label>称呼<input id="name"></label><input type="file" id="upload"><button id="submit">本地提交</button><p id="receipt"></p><a id="download" href="/download">下载</a><script>document.querySelector("#submit").onclick=async()=>{const file=document.querySelector("#upload").files[0];document.querySelector("#receipt").textContent=await fetch("/receipt",{method:"POST",body:await file.text()}).then(r=>r.text())}</script>',
  );
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as any).port;
const binding = await inspectBrowser(chrome);
const frames = await startFrameFixture();
const driver = await PlaywrightDriver.start(binding, join(root, 'dedicated-profile'), true);
try {
  const result = await driver.perform({ operation: 'navigate', value: `http://127.0.0.1:${port}` });
  assert.equal(result.title, 'FlowArk local fixture');
  await driver.perform({ operation: 'fill', selector: '#name', value: '虚构测试' });
  const file = join(root, 'fictional.txt');
  await writeFile(file, 'fictional-resume-data');
  await driver.perform({ operation: 'upload', selector: '#upload', value: file });
  await driver.perform({ operation: 'click', selector: '#submit' });
  await driver.perform({ operation: 'wait', selector: '#receipt:not(:empty)' });
  assert.equal(await driver.perform({ operation: 'read', selector: '#receipt' }), '已核对本地上传');
  assert.equal(uploaded, 'fictional-resume-data');
  const download = join(root, 'download.txt');
  await driver.perform({ operation: 'download', selector: '#download', value: download });
  assert.equal(await readFile(download, 'utf8'), 'local-only');
  await driver.perform({ operation: 'navigate', value: frames.url });
  const framePath = ['#outer', '#inner'];
  assert.equal(await driver.perform({ operation: 'read', selector: '#value' }), 'top');
  assert.equal(
    await driver.perform({ operation: 'read', selector: '#value', framePath: ['#outer'] }),
    'outer',
  );
  assert.equal(
    await driver.perform({ operation: 'read', selector: '#value', framePath }),
    'inner:first',
  );
  await driver.perform({ operation: 'fill', selector: '#name', value: 'framed input', framePath });
  assert.equal(
    await driver.perform({ operation: 'read', selector: '#echo', framePath }),
    'framed input',
  );
  assert.equal(
    await driver.perform({ operation: 'attribute', selector: '#name', value: 'value' }),
    'top',
  );
  assert.equal(await driver.perform({ operation: 'count', selector: '#unknown', framePath }), 0);
  await driver.perform({ operation: 'click', selector: '#action', framePath });
  await driver.perform({
    operation: 'wait',
    selector: '#echo:text-is("clicked:first")',
    framePath,
  });
  assert.deepEqual(frames.state.clicks, ['first']);
  assert.equal(await driver.perform({ operation: 'read', selector: '#echo' }), 'top unchanged');
  await driver.perform({ operation: 'upload', selector: '#upload', value: file, framePath });
  await driver.perform({ operation: 'click', selector: '#send', framePath });
  await driver.perform({ operation: 'wait', selector: '#receipt:not(:empty)', framePath });
  assert.equal(
    await driver.perform({ operation: 'read', selector: '#receipt', framePath }),
    'frame-upload-confirmed',
  );
  assert.equal(frames.state.uploads[0].toString(), 'fictional-resume-data');
  const frameDownload = join(root, 'frame-download.txt');
  await driver.perform({
    operation: 'download',
    selector: '#download',
    value: frameDownload,
    framePath,
  });
  assert.equal(await readFile(frameDownload, 'utf8'), 'frame-download');
  for (const framePath of [
    ['#absent'],
    ['.duplicate'],
    ['#value'],
    ['#outer', '#absent'],
    ['[invalid'],
  ]) {
    await assert.rejects(
      driver.perform({ operation: 'click', selector: '#action', framePath, timeoutMs: 300 }),
    );
    assert.equal(await driver.perform({ operation: 'read', selector: '#echo' }), 'top unchanged');
  }
  await assert.rejects(
    driver.perform({
      operation: 'count',
      selector: '#action',
      framePath: ['#absent'],
      timeoutMs: 200,
    }),
  );
  assert.deepEqual(frames.state.clicks, ['first']);
  await driver.perform({ operation: 'click', selector: '#add-delayed' });
  assert.equal(
    await driver.perform({
      operation: 'read',
      selector: '#value',
      framePath: ['#delayed', '#inner'],
      timeoutMs: 3000,
    }),
    'inner:first',
  );
  await driver.perform({ operation: 'click', selector: '#replace' });
  assert.equal(
    await driver.perform({ operation: 'read', selector: '#value', framePath }),
    'inner:second',
  );
  await driver.perform({ operation: 'click', selector: '#arm-swap' });
  await assert.rejects(
    driver.perform({ operation: 'click', selector: '#late', framePath, timeoutMs: 3000 }),
    /detached|closed/i,
  );
  assert.equal(
    await driver.perform({ operation: 'read', selector: '#value', framePath }),
    'inner:late',
  );
  assert.deepEqual(frames.state.clicks, ['first']);
  await assert.rejects(
    driver.perform({ operation: 'navigate', value: frames.url, framePath }),
    /顶层/,
  );
  const cancelled = assert.rejects(
    driver.perform({ operation: 'wait', selector: '#never', framePath, timeoutMs: 20000 }),
  );
  await driver.close();
  await cancelled;
  await mkdir('test-results', { recursive: true });
  await writeFile(
    'test-results/browser.json',
    JSON.stringify(
      {
        time: new Date().toISOString(),
        platform: process.platform,
        arch: process.arch,
        browser: binding.product,
        version: binding.version,
        driver: 'playwright-core 1.63.0',
        headless: true,
        profile: 'dedicated temporary profile',
        fixture: '127.0.0.1 only',
        checks: [
          'launch-selected-browser',
          'navigate',
          'DOM',
          'input',
          'upload',
          'receipt',
          'download',
          'close-cancels-wait',
          'empty-cache',
          'nested-cross-origin-frames',
          'frame-input-click-upload-download',
          'no-top-level-fallback',
          'strict-frame-path',
          'delayed-and-replaced-frames',
          'detachment-does-not-replay',
        ],
        realRecruitingSites: false,
      },
      null,
      2,
    ),
  );
  console.log('Local Chrome smoke passed', binding.version, '(no recruiting websites accessed)');
} finally {
  await driver.close().catch(() => {});
  server.close();
  await frames.close();
}
