import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { platform, release, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectBrowser } from '../src/adapters/browsers';
import { killOwnedTree } from '../src/host/processes';
import { startFrameFixture } from './fixtures/frames';

// Only fictional localhost data; all launches share a new dedicated test profile.
const root = await mkdtemp(join(tmpdir(), 'flowark-browser-recovery-'));
const browser = await inspectBrowser(
  process.env.FLOWARK_CHROME_PATH ?? '/Applications/Google Chrome.app',
);
assert.equal(browser.product, 'chrome', '恢复回归仅验证本机 Chrome');
const fixture = await startFrameFixture();
const input = 'fictional-recovery-data';
const upload = join(root, 'fictional.txt');
const phases = [];
try {
  await writeFile(upload, input);
  for (const [index, phase] of ['transfer', 'read', 'transfer'].entries()) {
    const output = join(root, `download-${index}.txt`);
    const stages: { stage: string; elapsedMs: number }[] = [];
    const started = Date.now();
    let timedOut = false;
    let stderr = '';
    const child = fork(
      fileURLToPath(new URL('./fixtures/browser-recovery-child.mjs', import.meta.url)),
      [browser.executable, join(root, 'profile'), fixture.url, phase, upload, output],
      {
        execArgv: [],
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: {
          ...process.env,
          PLAYWRIGHT_BROWSERS_PATH: join(root, 'empty-browser-cache'),
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
        },
      },
    );
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-8000);
    });
    child.on('message', (message) => {
      if (message && typeof message === 'object' && 'stage' in message)
        stages.push({ stage: String(message.stage), elapsedMs: Date.now() - started });
    });
    const timer = setTimeout(() => {
      timedOut = true;
      void killOwnedTree(child);
    }, 30000);
    const status = await new Promise<{ code: number | null; signal: string | null }>(
      (resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve({ code, signal }));
      },
    ).finally(() => clearTimeout(timer));
    const downloaded = await readFile(output, 'utf8').catch(() => null);
    const result = {
      index,
      phase,
      ...status,
      timedOut,
      elapsedMs: Date.now() - started,
      stages,
      downloaded,
      stderr,
      passed:
        status.code === 0 &&
        !timedOut &&
        stages.at(-1)?.stage === 'closed' &&
        (phase === 'read' || downloaded === 'frame-download'),
    };
    phases.push(result);
    console.log(JSON.stringify(result));
  }
} finally {
  await fixture.close();
}
const uploads = fixture.state.uploads.map((buffer) => buffer.toString());
const passed =
  phases.every((phase) => phase.passed) && uploads.join('|') === [input, input].join('|');
await mkdir(resolve('test-results'), { recursive: true });
await writeFile(
  resolve('test-results/browser-recovery.json'),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      os: { platform: platform(), release: release() },
      browser,
      playwrightVersion: JSON.parse(
        await readFile(resolve('node_modules/playwright-core/package.json'), 'utf8'),
      ).version,
      root,
      headless: false,
      phases,
      uploads,
      passed,
    },
    null,
    2,
  ),
);
assert.ok(passed, 'Chrome 上传/下载/关闭/重开回归失败，见 test-results/browser-recovery.json');
