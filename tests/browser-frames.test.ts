import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { validateFlow } from '../src/core/validate';
import { framePathOf } from '../src/core/browser-command';
import { assertBrowserOperations } from '../src/adapters/browser-scope';
import { SeleniumDriver } from '../src/adapters/selenium';
import example from '../contracts/example.frames.flow.json';

test('browser v2 preserves frame scope in flows; v1 never accepts a frame path', () => {
  const f = validateFlow(example);
  assert.deepEqual(f.steps, example.steps);
  for (const path of [null, '', [''], ['  '], Array(9).fill('#frame'), ['x'.repeat(2001)]]) {
    const bad = structuredClone(example) as any;
    bad.steps[1].framePath = path;
    assert.throws(() => validateFlow(bad));
    assert.throws(() => framePathOf({ operation: 'click', framePath: path }));
  }
  for (const operation of ['navigate', 'screenshot', 'url'])
    assert.throws(() => framePathOf({ operation, framePath: ['#frame'] }), /顶层/);
  const old = structuredClone(example) as any;
  old.steps[1].version = 1;
  assert.throws(() => validateFlow(old));
  delete old.steps[1].framePath;
  validateFlow(old);
  assert.deepEqual(framePathOf({ operation: 'read' }), []);
});

test('unsupported browser operations are rejected before admission without changing bindings', () => {
  assertBrowserOperations({ product: 'chrome' }, [
    { operation: 'download', framePath: ['#frame'] },
  ]);
  assertBrowserOperations({ product: 'firefox' }, [{ operation: 'upload', framePath: ['#frame'] }]);
  for (const product of ['firefox', 'safari'] as const)
    assert.throws(() => assertBrowserOperations({ product }, [{ operation: 'download' }]), /下载/);
  assert.throws(
    () => assertBrowserOperations({ product: 'safari' }, [{ operation: 'upload' }]),
    /上传/,
  );
});

// Model WebDriver browsing contexts, not a second implementation of frame resolution.
function fixture() {
  let context = 'top',
    resets = 0;
  const clicks: string[] = [],
    entered: string[] = [];
  const frames = new Map<string, any[]>();
  const frame = (target: string, tag = 'iframe') => ({ target, getTagName: async () => tag });
  frames.set('top:#outer', [frame('outer')]);
  frames.set('outer:#inner', [frame('inner')]);
  frames.set('top:.duplicate', [frame('one'), frame('two')]);
  frames.set('top:#div', [frame('bad', 'div')]);
  const state = { failReset: false, delayLookup: 0 };
  const native: any = {
    switchTo: () => ({
      defaultContent: async () => {
        if (state.failReset) throw new Error('session lost');
        context = 'top';
        resets++;
      },
      frame: async (element: any) => {
        context = element.target;
        entered.push(context);
      },
    }),
    findElements: async (by: any) => {
      if (state.delayLookup) await delay(state.delayLookup);
      if (by.value === '#go') {
        const foundIn = context;
        return [{ click: async () => clicks.push(foundIn), getText: async () => foundIn }];
      }
      return frames.get(`${context}:${by.value}`) ?? [];
    },
    wait: async (condition: any, _timeout: number, message?: string) => {
      const result = await (typeof condition === 'function'
        ? condition(native)
        : condition.fn(native));
      if (!result) throw new Error(message ?? 'missing element');
      return result;
    },
    quit: async () => {},
  };
  const driver: SeleniumDriver = new (SeleniumDriver as any)(native, 'firefox');
  return {
    driver,
    native,
    frames,
    frame,
    clicks,
    entered,
    state,
    context: () => context,
    resets: () => resets,
  };
}

test('Selenium resolves nested frames per command and restores top after success and failure', async () => {
  const f = fixture();
  await f.driver.perform({ operation: 'click', selector: '#go', framePath: ['#outer', '#inner'] });
  await f.driver.perform({ operation: 'click', selector: '#go' });
  assert.deepEqual(f.clicks, ['inner', 'top']);
  assert.equal(f.context(), 'top');
  for (const [path, error] of [
    [['#outer', '#missing'], /未找到/],
    [['.duplicate'], /不唯一/],
    [['#div'], /不是框架/],
  ] as const) {
    await assert.rejects(
      f.driver.perform({ operation: 'click', selector: '#go', framePath: [...path] }),
      error,
    );
    assert.equal(f.context(), 'top');
  }
  assert.deepEqual(f.clicks, ['inner', 'top']);
  f.frames.set('outer:#inner', [f.frame('replacement')]);
  assert.equal(
    await f.driver.perform({ operation: 'read', selector: '#go', framePath: ['#outer', '#inner'] }),
    'replacement',
  );
  assert.ok(f.resets() >= 12);
});

test('Selenium shares frame lookup timeout, rejects concurrent commands and invalidates failed reset', async () => {
  const f = fixture();
  f.state.delayLookup = 30;
  const pending = f.driver.perform({
    operation: 'click',
    selector: '#go',
    framePath: ['#outer', '#inner'],
    timeoutMs: 10,
  });
  await assert.rejects(f.driver.perform({ operation: 'click', selector: '#go' }), /占用/);
  await assert.rejects(pending, /超时/);
  assert.deepEqual(f.clicks, []);
  assert.equal(f.context(), 'top');
  f.state.delayLookup = 0;
  f.native.findElements = async () => {
    f.state.failReset = true;
    throw new Error('lost frame');
  };
  await assert.rejects(f.driver.perform({ operation: 'click', selector: '#go' }), /复位失败/);
  f.state.failReset = false;
  await assert.rejects(f.driver.perform({ operation: 'click', selector: '#go' }), /不可用/);
});
