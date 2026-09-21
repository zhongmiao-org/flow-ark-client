import { desktopElectron as electron } from './desktop-session.mjs';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyBundle } from './verify-bundle.mjs';
const executablePath = process.env.FLOWARK_TEST_EXECUTABLE;
if (!executablePath) throw new Error('Set FLOWARK_TEST_EXECUTABLE');
await verifyBundle(executablePath.split('/Contents/MacOS/')[0]);
const data = await mkdtemp(join(tmpdir(), 'flowark-install-'));
let runId;
for (let phase = 0; phase < 2; phase++) {
  const app = await electron.launch({
    executablePath,
    cwd: data,
    env: { ...process.env, FLOWARK_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.flowark));
    const call = (method, args = {}) =>
      page.evaluate(({ method, args }) => window.flowark.request(method, args), { method, args });
    const boot = await call('bootstrap');
    if (phase === 0) {
      assert.equal(boot.flows.length, 0);
      assert.equal(boot.templates.length, 0);
      await call('credentials.set', { id: 'deepseek', value: 'fictional-install-key' });
      const record = await call('flow.create');
      await call('flow.save', {
        flow: {
          ...record.flow,
          steps: [{ id: 'value', type: 'value', version: 1, value: 'fixture' }],
        },
        bindings: record.bindings,
      });
      runId = (await call('flow.run', { id: record.id })).id;
      for (let i = 0; i < 200; i++) {
        const d = await call('run.detail', { id: runId });
        if (d.run.state === 'SUCCEEDED') break;
        if (['FAILED', 'INTERRUPTED'].includes(d.run.state)) throw new Error(d.run.error);
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.equal((await call('run.detail', { id: runId })).run.state, 'SUCCEEDED');
    } else {
      assert.ok(boot.credentials.includes('deepseek'));
      assert.equal(boot.flows.length, 1);
      assert.equal((await call('run.detail', { id: runId })).output.value, 'fixture');
    }
    console.log('Installed platform phase', phase, 'passed');
  } finally {
    await app.close();
  }
}
