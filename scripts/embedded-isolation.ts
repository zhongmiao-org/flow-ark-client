import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electronPath from 'electron';
import { embeddedHarness } from './fixtures/embedded-harness';
import type { BrowserBinding } from '../src/shared/types';

export async function verifyEmbeddedIsolation() {
  const data = await mkdtemp(join(tmpdir(), 'flowark-embedded-isolation-'));
  const server = createServer((req, res) => {
    if (req.url === '/payload') {
      res.writeHead(200, {
        'Content-Disposition': 'attachment; filename=fixture.txt',
        'Content-Type': 'text/plain',
      });
      res.end('fictional-download');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/leaf') {
      res.end('<p id="leaf">nested frame receipt</p>');
      return;
    }
    if (req.url === '/inner') {
      res.end('<iframe id="nested" src="/leaf"></iframe>');
      return;
    }
    if (req.url === '/cookie') {
      res.end(
        '<p id="cookie"></p><script>document.querySelector("#cookie").textContent=document.cookie</script>',
      );
      return;
    }
    res.end(`<p id="environment"></p><p id="timer">0</p>
      <iframe id="frame" src="/inner"></iframe>
      <a id="popup" target="_blank" href="/cookie">new page</a>
      <a id="file" target="_blank" href="file:///etc/passwd">blocked file</a>
      <a id="download" href="/payload" download>download</a>
      <script>document.querySelector('#environment').textContent=JSON.stringify({node:typeof process,require:typeof require,bridge:typeof window.flowark});
      document.cookie='fixture=retained; Max-Age=86400; SameSite=Strict';
      let tick=0;setInterval(()=>document.querySelector('#timer').textContent=String(++tick),100);</script>`);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const harness = await embeddedHarness(data);
  const start = async () => {
    await harness.start();
    return harness;
  };
  let driver: typeof harness | undefined;
  try {
    driver = await start();
    await driver.perform({ operation: 'navigate', value: url });
    assert.deepEqual(
      JSON.parse(await driver.perform({ operation: 'read', selector: '#environment' })),
      { node: 'undefined', require: 'undefined', bridge: 'undefined' },
    );
    assert.equal(
      await driver.perform({
        operation: 'read',
        selector: '#leaf',
        framePath: ['#frame', '#nested'],
      }),
      'nested frame receipt',
    );
    await driver.visibility(false);
    const before = Number(await driver.perform({ operation: 'read', selector: '#timer' }));
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(Number(await driver.perform({ operation: 'read', selector: '#timer' })) > before);
    const app = harness.app;
    const preferences = await app.evaluate(({ BrowserWindow }: any) =>
      BrowserWindow.getAllWindows()[0].contentView.children.map((v: any) =>
        v.webContents.getLastWebPreferences(),
      ),
    );
    assert.equal(preferences[0].nodeIntegration, false);
    assert.equal(preferences[0].contextIsolation, true);
    assert.equal(preferences[0].sandbox, true);
    assert.equal(
      await app.evaluate(({ BrowserWindow }: any) =>
        BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.getBackgroundThrottling(),
      ),
      false,
    );
    assert.ok(!preferences[0].preload);
    const windows = await app.evaluate(
      ({ BrowserWindow }: any) => BrowserWindow.getAllWindows().length,
    );
    await driver.perform({ operation: 'click', selector: '#file' });
    assert.equal(
      await app.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows().length),
      windows,
    );
    await assert.rejects(
      driver.perform({ operation: 'navigate', value: 'file:///etc/passwd' }),
      /HTTP/,
    );
    // The native session rejects unarmed downloads before any Save dialog or path.
    await app.evaluate(({ session }: any) => {
      (globalThis as any).fixtureBlocked = false;
      session.fromPartition('persist:flowark-web-panel').on('will-download', (event: any) => {
        (globalThis as any).fixtureBlocked = event.defaultPrevented;
      });
    });
    await driver.perform({ operation: 'click', selector: '#download' });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await app.evaluate(() => (globalThis as any).fixtureBlocked), true);
    await driver.perform({
      operation: 'download',
      selector: '#download',
      value: join(data, 'download.txt'),
    });
    assert.equal(await readFile(join(data, 'download.txt'), 'utf8'), 'fictional-download');
    await driver.perform({ operation: 'click', selector: '#popup' });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(
      await driver.perform({ operation: 'read', selector: '#cookie' }),
      'fixture=retained',
    );
    assert.equal((await driver.status()).visible, false);
    await driver.close();
    driver = undefined;
    driver = await start();
    await driver.perform({ operation: 'navigate', value: url + '/cookie' });
    assert.equal(
      await driver.perform({ operation: 'read', selector: '#cookie' }),
      'fixture=retained',
    );
    await driver.perform({ operation: 'navigate', value: url });
    await driver.perform({
      operation: 'download',
      selector: '#download',
      value: join(data, 'download-again.txt'),
    });
    assert.equal(await readFile(join(data, 'download-again.txt'), 'utf8'), 'fictional-download');
    return {
      passed: true,
      data,
      isolation: true,
      nestedFrames: true,
      backgroundTimers: true,
      popupHidden: true,
      blockedFile: true,
      unarmedDownloadBlocked: true,
      cookieRetention: true,
      downloadAfterReopen: true,
    };
  } finally {
    await harness.shutdown();
    await new Promise<void>((r) => server.close(() => r()));
  }
}
if (process.argv[1]?.endsWith('embedded-isolation.ts')) {
  const report = await verifyEmbeddedIsolation();
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/embedded-isolation.json', JSON.stringify(report, null, 2));
  console.log('Embedded browser isolation, frames, popup, profile and download recovery passed');
}
