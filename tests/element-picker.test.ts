import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { EmbeddedPicker } from '../src/adapters/embedded-picker';
import { validateIPC } from '../src/shared/ipc';

test('picker IPC rejects raw commands, scripts and unbounded frame paths', () => {
  for (const method of ['start', 'status', 'cancel']) {
    assert.deepEqual(validateIPC('browser.embedded.pick.' + method, { requestId: 'editor-node' }), {
      requestId: 'editor-node',
    });
    assert.throws(() =>
      validateIPC('browser.embedded.pick.' + method, {
        requestId: 'editor',
        expression: 'alert(1)',
      }),
    );
  }
  assert.throws(() =>
    validateIPC('browser.embedded.pick.validate', {
      selector: '#name',
      framePath: Array(9).fill('iframe'),
    }),
  );
  assert.throws(() =>
    validateIPC('browser.embedded.pick.validate', { selector: 'x'.repeat(4001), framePath: [] }),
  );
  assert.throws(() =>
    validateIPC('browser.embedded.pick.validate', {
      selector: '#name',
      framePath: [],
      sessionId: 'website',
    }),
  );
});

test('late cancellation and overlapping setup cannot turn off a newer element picker', async () => {
  const contents = new EventEmitter() as any;
  contents.debugger = new EventEmitter();
  let release!: () => void;
  let delayed = true;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const modes: string[] = [];
  const picker = new EmbeddedPicker(
    contents,
    async (method, args) => {
      if (method === 'DOM.enable' && delayed) {
        delayed = false;
        await gate;
      }
      if (method === 'Overlay.setInspectMode') modes.push(args.mode);
      if (method === 'Overlay.disable') modes.push('disabled');
      return {};
    },
    new Map(),
    async () => {
      throw new Error('not selected');
    },
    (mouse) => mouse,
  );
  const first = picker.start('first');
  await new Promise((r) => setImmediate(r));
  const cancel = picker.cancel('first');
  const second = picker.start('second');
  release();
  await Promise.all([first, cancel, second]);
  assert.equal(picker.status('first').phase, 'cancelled');
  assert.equal(picker.status('second').phase, 'picking');
  assert.equal(modes.at(-1), 'searchForNode');
  await picker.cancel('first');
  assert.equal(modes.at(-1), 'searchForNode');
  await picker.cancel('second');
  assert.equal(picker.status('second').phase, 'cancelled');
  assert.equal(modes.at(-1), 'disabled');
});

test('cancelling a stationary click preserves a newer picker and releases the next normal gesture', async () => {
  const contents = new EventEmitter() as any;
  contents.debugger = new EventEmitter();
  contents.getZoomFactor = () => 1;
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const hitStarted = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const modes: string[] = [];
  const picker = new EmbeddedPicker(
    contents,
    async (method, args) => {
      if (method === 'DOM.getDocument') {
        entered();
        await gate;
      }
      if (method === 'Overlay.setInspectMode') modes.push(args.mode);
      return {};
    },
    new Map(),
    async () => {
      throw new Error('cancelled target must not be inspected');
    },
    (mouse) => mouse,
  );
  const mouse = (type: string) => {
    let prevented = false;
    contents.emit(
      'before-mouse-event',
      {
        preventDefault: () => {
          prevented = true;
        },
      },
      { type, button: 'left', x: 20, y: 30 },
    );
    return prevented;
  };
  await picker.start('stationary');
  assert.equal(mouse('mouseDown'), true);
  await hitStarted;
  const cancelled = picker.cancel('stationary');
  const newer = picker.start('newer');
  release();
  await Promise.all([cancelled, newer]);
  assert.equal(picker.status('stationary').phase, 'cancelled');
  assert.equal(picker.status('newer').phase, 'picking');
  assert.equal(modes.at(-1), 'searchForNode');
  assert.equal(mouse('mouseUp'), true);
  await picker.cancel('newer');
  // A lost release outside the hidden view must not swallow a later real click.
  await picker.start('lost-release');
  assert.equal(mouse('mouseDown'), true);
  await picker.cancel('lost-release');
  assert.equal(mouse('mouseDown'), false);
  assert.equal(mouse('mouseUp'), false);
});
