import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFrameFixture } from './fixtures/frames';
import { embeddedHarness } from './fixtures/embedded-harness';
const root = await mkdtemp(join(tmpdir(), 'flowark-native-frames-'));
const frames = await startFrameFixture();
const browser = await embeddedHarness(root);
const framePath = ['#outer', '#inner'];
const checks: string[] = [];
try {
  await browser.start();
  await browser.perform({ operation: 'navigate', value: frames.url });
  for (const [path, expected] of [
    [[], 'top'],
    [['#outer'], 'outer'],
    [framePath, 'inner:first'],
  ] as [string[], string][]) {
    assert.equal(
      await browser.perform({ operation: 'read', selector: '#value', framePath: path }),
      expected,
    );
  }
  checks.push('nested-cross-origin-frame-read');
  await browser.perform({ operation: 'fill', selector: '#name', value: 'framed input', framePath });
  assert.equal(
    await browser.perform({ operation: 'read', selector: '#echo', framePath }),
    'framed input',
  );
  await browser.perform({ operation: 'fill', selector: '#name', value: '', framePath });
  assert.equal(
    await browser.perform({ operation: 'inputValue', selector: '#name', value: null, framePath }),
    '',
  );
  await browser.perform({ operation: 'click', selector: '#action', framePath });
  await browser.perform({ operation: 'wait', selector: '#echo:not(:empty)', framePath });
  assert.equal(
    await browser.perform({ operation: 'read', selector: '#echo', framePath }),
    'clicked:first',
  );
  assert.equal(await browser.perform({ operation: 'read', selector: '#echo' }), 'top unchanged');
  checks.push('frame-fill-clear-click-no-top-level-fallback');
  await writeFile(join(root, 'fictional.txt'), 'fictional-frame-content');
  await browser.perform({
    operation: 'upload',
    selector: '#upload',
    value: join(root, 'fictional.txt'),
    framePath,
  });
  await browser.perform({ operation: 'click', selector: '#send', framePath });
  await browser.perform({ operation: 'wait', selector: '#receipt:not(:empty)', framePath });
  assert.equal(frames.state.uploads[0].toString(), 'fictional-frame-content');
  await browser.perform({
    operation: 'download',
    selector: '#download',
    value: join(root, 'download.txt'),
    framePath,
  });
  assert.equal(await readFile(join(root, 'download.txt'), 'utf8'), 'frame-download');
  checks.push('frame-upload-and-download-bytes');
  for (const path of [['.duplicate'], ['#value'], ['[invalid'], ['#absent']]) {
    await assert.rejects(
      browser.perform({ operation: 'click', selector: '#action', framePath: path, timeoutMs: 250 }),
    );
    await browser.close();
    await browser.start();
    await browser.perform({ operation: 'navigate', value: frames.url });
  }
  assert.deepEqual(frames.state.clicks, ['first']);
  checks.push('invalid-frame-path-rejected');
  await browser.perform({ operation: 'click', selector: '#add-delayed' });
  assert.equal(
    await browser.perform({
      operation: 'read',
      selector: '#value',
      framePath: ['#delayed', '#inner'],
      timeoutMs: 3000,
    }),
    'inner:first',
  );
  await browser.perform({ operation: 'click', selector: '#replace' });
  assert.equal(
    await browser.perform({ operation: 'read', selector: '#value', framePath }),
    'inner:second',
  );
  checks.push('delayed-and-replaced-frames');
  const waiting = assert.rejects(
    browser.perform({ operation: 'wait', selector: '#never', timeoutMs: 20000 }),
  );
  await new Promise((r) => setTimeout(r, 100));
  const started = Date.now();
  await browser.close();
  await waiting;
  assert.ok(Date.now() - started < 3000);
  checks.push('close-aborts-wait');
  await mkdir('test-results', { recursive: true });
  await writeFile(
    'test-results/browser.json',
    JSON.stringify(
      { passed: true, browser: browser.binding, driver: 'Electron webContents.debugger', checks },
      null,
      2,
    ),
  );
  console.log('Native embedded frame, transfer, strict selector and cancellation checks passed');
} finally {
  await browser.shutdown();
  await frames.close();
}
