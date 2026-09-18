import { embeddedHarness } from './fixtures/embedded-harness';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Runtime } from '../src/host/runtime';
import { packageFlow } from '../src/recruiting/templates';
import type { Flow, Run, Step } from '../src/shared/types';
import { startFormLab } from './fixtures/form-lab';
import { formLabFlow, formBrowser as b, formExpected, formText } from './fixtures/form-lab-flow';

const root = await mkdtemp(join(tmpdir(), 'flowark-form-lab-'));
process.env.PLAYWRIGHT_BROWSERS_PATH = join(root, 'empty-browser-cache');
process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';
await writeFile(join(root, 'fictional.txt'), formText);
const lab = await startFormLab();
const embedded = await embeddedHarness(root);
const runtime = new Runtime(
  root,
  resolve('dist'),
  process.execPath,
  randomBytes(32),
  embedded.system,
);
const report: Record<string, any> = {
  at: new Date().toISOString(),
  root,
  url: lab.url,
  passed: false,
  cases: [],
};
async function execute(flow: Flow, expected = 'SUCCEEDED') {
  const imported = await runtime.request('flow.import', {
    content: JSON.stringify(packageFlow(flow)),
  });
  runtime.saveFlow(imported.flow, {
    files: { work: root },
    credentials: [],
    browserId: report.browser.id,
  });
  const submitted = await runtime.enqueue(imported.id),
    deadline = Date.now() + 120000;
  while (true) {
    const current = runtime.store.get<Run>('run', submitted.id)!;
    if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(current.state)) {
      report.cases.push({
        name: flow.name,
        runId: current.id,
        state: current.state,
        expected,
        error: current.error,
      });
      assert.equal(current.state, expected, JSON.stringify(current));
      return current;
    }
    if (Date.now() > deadline) throw new Error('form lab timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
const base = formLabFlow(lab.url);
const scenario = (name: string, steps: Step[]): Flow => ({
  ...base,
  id: 'case-' + name,
  name,
  steps: [base.steps[0], ...steps],
});
try {
  report.browser = await runtime.request('browser.embedded.enable');
  await execute(
    scenario('native-validation', [
      b('invalid_email', 'fill', '#email', 'invalid'),
      b('email_rejected', 'wait', '#email:invalid'),
      b('bad_quantity', 'fill', '#quantity', '0'),
      b('quantity_rejected', 'wait', '#quantity:invalid'),
      b('start', 'fill', '#start-date', '2026-09-20'),
      b('end', 'fill', '#end-date', '2026-09-17'),
      b('date_rejected', 'wait', '#end-date:invalid'),
      b('submit', 'click', '#submit'),
      b('invalid_feedback', 'wait', '#submit-status[data-state="invalid"]'),
    ]),
  );
  assert.equal(lab.state.attempts, 0);
  for (const [name, operation, selector, value] of [
    ['readonly', 'fill', '#readonly-code', 'changed'],
    ['disabled', 'fill', '#disabled-field', 'changed'],
    ['missing-option', 'select', '#department', 'nonexistent'],
    ['disabled-option', 'select', '#department', 'locked'],
    ['radio-uncheck', 'check', '#channel-email', false],
    ['single-many', 'select', '#department', ['engineering', 'design']],
  ] as const) {
    const failed = await execute(
      scenario(name, [
        b('blocked', operation, selector, value, 600),
        {
          id: 'must_not_write',
          type: 'file',
          version: 1,
          operation: 'write',
          binding: 'work',
          name: 'must-not-exist.txt',
          content: 'unexpected',
        },
      ]),
      'FAILED',
    );
    if (name === 'disabled-option') assert.match(failed.error ?? '', /禁用/);
    if (name === 'radio-uncheck') assert.match(failed.error ?? '', /radio/);
    if (name === 'single-many') assert.match(failed.error ?? '', /单选/);
    assert.ok(!runtime.store.events(failed.id).some((e) => e.nodeInstance === 'must_not_write'));
    await assert.rejects(readFile(join(root, 'must-not-exist.txt')), { code: 'ENOENT' });
  }
  assert.equal(lab.state.attempts, 0);
  console.log('浏览器校验与 6 个禁止/无效操作均按预期阻止');
  const happy = await execute(base);
  assert.equal(lab.state.accepted.length, 1);
  assert.equal(lab.state.attempts, 1);
  assert.deepEqual(lab.state.accepted[0].fields, formExpected);
  assert.equal(
    lab.state.accepted[0].fileSha256,
    createHash('sha256').update(formText).digest('hex'),
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(root, 'form-receipt.json'), 'utf8')),
    lab.state.accepted[0],
  );
  const changes = JSON.parse(await readFile(join(root, 'event-counts.json'), 'utf8'));
  for (const control of ['channel-email', 'feature-export', 'feature-audit'])
    assert.equal(changes[control], 1, control + ' should change once');
  assert.equal(
    runtime.store
      .events(happy.id)
      .filter((e) => e.type === 'node-start' && e.nodeInstance === 'submit').length,
    1,
  );
  report.accepted = lab.state.accepted[0];
  report.changes = changes;
  report.screenshots = runtime.store
    .list<any>('artifact')
    .filter((a) => a.runId === happy.id && a.path.endsWith('.png'))
    .map((a) => a.path);
  console.log('全部字段、文件字节、回执和幂等勾选核对通过');
  const prefix = base.steps.slice(
    0,
    base.steps.findIndex((n) => n.id === 'submit'),
  );
  await execute({
    ...base,
    id: 'server-rejection',
    name: 'server-rejection',
    steps: [
      ...prefix,
      b('reject_on', 'check', '#reject-server', true),
      b('submit', 'click', '#submit'),
      b('rejected', 'wait', '#submit-status[data-state="error"]'),
      b('read_rejection', 'read', '#server-result'),
      {
        id: 'verify_rejection',
        type: 'assert',
        version: 1,
        actual: { $ref: 'steps.read_rejection' },
        operator: 'contains',
        expected: 'rejected',
      },
    ],
  });
  assert.equal(lab.state.attempts, 2);
  assert.equal(lab.state.accepted.length, 1);
  assert.equal(lab.state.rejected, 1);
  report.passed = true;
  console.log('服务端拒绝显示失败且没有重复提交');
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  try {
    await runtime.shutdown();
    report.shutdownCompleted = true;
  } catch (error) {
    report.passed = false;
    report.shutdownError = String(error);
    throw error;
  } finally {
    runtime.store.close();
    await embedded.shutdown();
    await lab.close();
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/form-lab.json', JSON.stringify(report, null, 2) + '\n');
  }
}
