import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { inspectBrowser } from '../src/adapters/browsers';
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
  const cancelled = assert.rejects(
    driver.perform({ operation: 'wait', selector: '#never', timeoutMs: 20000 }),
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
}
