import { _electron as electron } from 'playwright-core';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { verifyBundle } from './verify-bundle.mjs';
const executablePath = process.env.FLOWARK_TEST_EXECUTABLE;
if (!executablePath)
  throw new Error('Set FLOWARK_TEST_EXECUTABLE to the installed FlowArk executable');
await verifyBundle(executablePath.split('/Contents/MacOS/')[0]);
const data = await mkdtemp(join(tmpdir(), 'flowark-installed-data-'));
const evidence = [];
for (let phase = 0; phase < 2; phase++) {
  const app = await electron.launch({
    executablePath,
    env: { ...process.env, FLOWARK_DATA_DIR: data },
    timeout: 30000,
  });
  const child = app.process();
  child.stderr?.on('data', (data) => process.stderr.write(data));
  console.log('Installed launch phase', phase);
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.flowark));
    const first = await page.evaluate(() => window.flowark.request('bootstrap'));
    if (phase === 0) {
      assert.equal(first.runs.length, 0);
      await page.evaluate(() =>
        window.flowark.request('credentials.set', {
          id: 'deepseek',
          value: 'fictional-install-test-key',
        }),
      );
      const run = await page.evaluate(
        (id) => window.flowark.request('flow.run', { id }),
        first.flows[0].id,
      );
      const deadline = Date.now() + 20000;
      while (true) {
        const result = await page.evaluate(
          (id) => window.flowark.request('run.detail', { id }),
          run.id,
        );
        if (['SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(result.run.state)) {
          assert.equal(result.run.state, 'SUCCEEDED');
          break;
        }
        if (Date.now() > deadline) throw new Error('Installed run timed out');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } else {
      assert.equal(first.runs[0].state, 'SUCCEEDED');
      assert.ok(first.credentials.includes('deepseek'));
      assert.ok(!JSON.stringify(first).includes('fictional-install-test-key'));
    }
    // Closing the window must leave a tray-resident app that can show itself again.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    assert.equal(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
      false,
    );
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    evidence.push({
      phase: phase === 0 ? 'first-launch' : 'reopen',
      previousRuns: first.runs.length,
      tray: true,
    });
  } catch (error) {
    console.error('Installed verification failed in phase', phase, error);
    throw error;
  } finally {
    const ended =
      child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve({ code: child.exitCode, signal: child.signalCode })
        : new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
    await app
      .evaluate(({ Menu }) => {
        setTimeout(
          () =>
            Menu.getApplicationMenu()
              .items[0].submenu.items.find((item) => item.label === '退出 FlowArk')
              .click(),
          100,
        );
      })
      .catch(() => {});
    const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
    const exit = await ended;
    clearTimeout(timer);
    assert.equal(exit.signal, null);
    assert.equal(exit.code, 0);
  }
}
await mkdir('test-results', { recursive: true });
await writeFile(
  'test-results/install.json',
  JSON.stringify(
    { time: new Date().toISOString(), executablePath, dataPath: data, evidence, realApi: false },
    null,
    2,
  ),
);
console.log(
  'Installed app: first launch, protected credential save, execution, tray, graceful exit and reopen passed',
);
