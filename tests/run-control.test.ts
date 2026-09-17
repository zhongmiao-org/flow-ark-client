import test from 'node:test';
import assert from 'node:assert/strict';
import { RunControl } from '../src/core/run-control';
import { assertBrowserOperations } from '../src/adapters/browser-scope';

test('debug gate accepts an immediate response while publishing PAUSED without losing it', async () => {
  const states: string[] = [];
  const gate = new RunControl(true, new AbortController().signal, async (state) => {
    states.push(state);
    if (state === 'PAUSED') gate.control('step');
  });
  await gate.boundary({ nodeInstance: 'one', nodeName: 'one' });
  await gate.boundary({ nodeInstance: 'two', nodeName: 'two' });
  assert.deepEqual(states, ['PAUSED', 'RUNNING', 'PAUSED', 'RUNNING']);
});

test('continuous execution, explicit human confirmation and cancellation retain distinct gates', async () => {
  const states: string[] = [];
  const abort = new AbortController();
  const gate = new RunControl(false, abort.signal, async (state) => {
    states.push(state);
    if (state === 'WAITING_INPUT') gate.control('resume');
    if (state === 'PAUSED') abort.abort(new Error('cancelled'));
  });
  await gate.boundary({ nodeInstance: 'one', nodeName: 'one' });
  assert.deepEqual(states, []);
  assert.deepEqual(await gate.human('confirm'), { confirmed: true });
  gate.control('pause');
  await assert.rejects(gate.boundary({ nodeInstance: 'two', nodeName: 'two' }), /cancelled/);
  assert.deepEqual(states, ['WAITING_INPUT', 'RUNNING', 'PAUSED']);
});

test('known native Chrome download crash is blocked without disabling upload and form controls', () => {
  const binding = { product: 'chrome' as const, version: '153.0.8010.48' };
  assertBrowserOperations(
    binding,
    ['upload', 'fill', 'select', 'check', 'read', 'press'].map((operation) => ({ operation })),
  );
  if (process.platform === 'darwin')
    assert.throws(
      () => assertBrowserOperations(binding, [{ operation: 'download' }]),
      /不会点击或重试/,
    );
});
