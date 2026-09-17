import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// Deliberately uses Playwright directly: no FlowArk engine, sessions or driver adapter.
const [executablePath, profile, url, phase, upload, output] = process.argv.slice(2);
const stage = (name) => process.send?.({ stage: name });
stage('starting');
const context = await chromium.launchPersistentContext(profile, {
  executablePath,
  headless: false,
  acceptDownloads: true,
  timeout: 20000,
});
context.setDefaultTimeout(5000);
try {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const frame = page.frameLocator('#outer').frameLocator('#inner');
  assert.equal(await frame.locator('#value').innerText(), 'inner:first');
  stage('ready');
  if (phase === 'transfer') {
    await frame.locator('#upload').setInputFiles(upload);
    await frame.locator('#send').click();
    await frame.locator('#receipt:not(:empty)').waitFor();
    assert.equal(await frame.locator('#receipt').innerText(), 'frame-upload-confirmed');
    stage('uploaded');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      frame.locator('#download').click(),
    ]);
    await download.saveAs(output);
    assert.equal(await readFile(output, 'utf8'), 'frame-download');
    stage('downloaded');
  }
} finally {
  stage('closing');
  await context.close();
  stage('closed');
}
