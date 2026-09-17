import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFlow } from '../src/core/validate';
import { framePathOf, validateFormCommand } from '../src/core/browser-command';
import { SeleniumDriver } from '../src/adapters/selenium';
import { PlaywrightDriver } from '../src/adapters/playwright';
import { formLabFlow } from '../scripts/fixtures/form-lab-flow';

test('form nodes preserve legacy versions and reject malformed literal or resolved values', async () => {
  validateFlow(formLabFlow());
  for (const [operation, value] of [
    ['check', 'false'],
    ['select', null],
    ['select', ['x', 'x']],
    ['select', [1]],
    ['select', Array(101).fill('x')],
    ['inputValue', 'value'],
    ['press', 'Meta+Q'],
  ] as const) {
    assert.throws(() => validateFormCommand({ operation, value }));
    const flow: any = formLabFlow();
    flow.steps = [
      {
        id: 'bad',
        type: 'browser',
        version: 3,
        operation,
        selector: '#input',
        value,
        framePath: [],
      },
    ];
    assert.throws(() => validateFlow(flow));
    await assert.rejects(new (PlaywrightDriver as any)(null, null).perform({ operation, value }));
    await assert.rejects(
      new (SeleniumDriver as any)(null, 'firefox').perform({ operation, value }),
    );
  }
  for (const operation of ['check', 'select', 'inputValue', 'press']) {
    assert.deepEqual(framePathOf({ operation, framePath: ['#frame'] }), ['#frame']);
    const flow: any = formLabFlow();
    flow.steps = [
      {
        id: 'old',
        type: 'browser',
        version: 2,
        operation,
        selector: '#input',
        value: null,
        framePath: [],
      },
    ];
    assert.throws(() => validateFlow(flow));
  }
  validateFormCommand({ operation: 'check', value: { $ref: 'params.checked' } }, true);
  assert.throws(() =>
    validateFormCommand({ operation: 'check', value: { $ref: 'params.checked' } }),
  );
});

test('Selenium form model uses exact options and idempotent checkbox/radio state without DOM writes', async () => {
  let clicks = 0,
    checked = false;
  const selected = new Set(['a']);
  const options = ['a', 'b', 'locked'].map((value) => ({
    getAttribute: async () => value,
    isEnabled: async () => value !== 'locked',
    isSelected: async () => selected.has(value),
    click: async () => {
      clicks++;
      selected.has(value) ? selected.delete(value) : selected.add(value);
    },
  }));
  let current: any;
  const native: any = {
    switchTo: () => ({ defaultContent: async () => {} }),
    findElements: async () => [current],
    wait: async (condition: any) => {
      const result = await (typeof condition === 'function'
        ? condition(native)
        : condition.fn(native));
      if (!result) throw new Error('not ready');
      return result;
    },
  };
  const driver = new (SeleniumDriver as any)(native, 'firefox') as SeleniumDriver;
  current = {
    getTagName: async () => 'input',
    getAttribute: async (name: string) => (name === 'type' ? 'checkbox' : 'edited value'),
    isSelected: async () => checked,
    isDisplayed: async () => true,
    isEnabled: async () => true,
    click: async () => {
      checked = !checked;
      clicks++;
    },
    sendKeys: async () => {},
  };
  assert.equal(await driver.perform({ operation: 'inputValue', value: null }), 'edited value');
  await driver.perform({ operation: 'check', value: true });
  await driver.perform({ operation: 'check', value: true });
  assert.equal(clicks, 1);
  await driver.perform({ operation: 'check', value: false });
  assert.equal(clicks, 2);
  current.getAttribute = async () => 'radio';
  await assert.rejects(driver.perform({ operation: 'check', value: false }), /radio/);
  assert.equal(clicks, 2);
  current = {
    getTagName: async () => 'select',
    getAttribute: async () => 'true',
    findElements: async () => options,
    isDisplayed: async () => true,
    isEnabled: async () => true,
  };
  assert.deepEqual(await driver.perform({ operation: 'select', value: ['b'] }), ['b']);
  assert.deepEqual([...selected], ['b']);
  assert.deepEqual(await driver.perform({ operation: 'select', value: [] }), []);
  const before = clicks;
  await assert.rejects(driver.perform({ operation: 'select', value: ['locked'] }), /禁用/);
  await assert.rejects(driver.perform({ operation: 'select', value: ['missing'] }));
  assert.equal(clicks, before);
  assert.deepEqual([...selected], []);
  current.getAttribute = async () => null;
  await assert.rejects(driver.perform({ operation: 'select', value: [] }), /单选/);
});
