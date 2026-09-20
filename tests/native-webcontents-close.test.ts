import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { confirmWebContentsClosed } from '../src/main/native-webcontents-close';

class Contents extends EventEmitter {
  destroyed = false;
  calls = 0;
  request: () => void = () => {};
  isDestroyed() {
    return this.destroyed;
  }
  close(options: { waitForBeforeUnload: false }) {
    assert.equal(options.waitForBeforeUnload, false);
    this.calls++;
    this.request();
  }
  destroy() {
    this.destroyed = true;
    this.emit('destroyed');
  }
}

test('a returned native close waits for destruction evidence and removes its listener', async () => {
  const contents = new Contents();
  let settled = false;
  const pending = confirmWebContentsClosed(contents, 1000).then((result) => {
    settled = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(contents.calls, 1);
  assert.equal(settled, false);
  assert.equal(contents.listenerCount('destroyed'), 1);
  contents.destroy();
  assert.deepEqual(await pending, { confirmed: true, warnings: [] });
  assert.equal(contents.listenerCount('destroyed'), 0);
});

test('detach failure cannot skip native close and synchronous destruction is observed', async () => {
  const contents = new Contents();
  contents.request = () => contents.destroy();
  const result = await confirmWebContentsClosed(contents, 1000, () => {
    throw new Error('detach injected');
  });
  assert.equal(contents.calls, 1);
  assert.equal(result.confirmed, true);
  assert.match(result.warnings.join(), /detach injected/);
  assert.equal(contents.listenerCount('destroyed'), 0);
});

test('a thrown close still accepts actual destruction and runs capture cleanup', async () => {
  const contents = new Contents();
  let captures = 0;
  contents.request = () => {
    contents.destroy();
    throw new Error('late close error');
  };
  const result = await confirmWebContentsClosed(contents, 1000, undefined, () => {
    captures++;
  });
  assert.equal(result.confirmed, true);
  assert.equal(captures, 1);
  assert.match(result.warnings.join(), /late close error/);
  assert.equal(contents.listenerCount('destroyed'), 0);
});

test('unconfirmed native close times out; late destruction cannot rewrite its result', async () => {
  const contents = new Contents();
  contents.request = () => {
    throw new Error('close injected');
  };
  const result = await confirmWebContentsClosed(contents, 10);
  assert.equal(result.confirmed, false);
  assert.match(result.error!, /close injected/);
  assert.equal(contents.listenerCount('destroyed'), 0);
  contents.destroy();
  assert.equal(result.confirmed, false);
});

test('capture host destruction can supply native evidence after close throws', async () => {
  const contents = new Contents();
  contents.request = () => {
    throw new Error('close injected');
  };
  const result = await confirmWebContentsClosed(contents, 1000, undefined, () =>
    contents.destroy(),
  );
  assert.equal(result.confirmed, true);
  assert.equal(contents.listenerCount('destroyed'), 0);
});

test('an already destroyed page still detaches and cleans its capture host without closing again', async () => {
  const contents = new Contents();
  contents.destroy();
  const cleanups: string[] = [];
  const result = await confirmWebContentsClosed(
    contents,
    1000,
    () => {
      cleanups.push('detach');
    },
    () => {
      cleanups.push('capture');
    },
  );
  assert.equal(result.confirmed, true);
  assert.equal(contents.calls, 0);
  assert.deepEqual(cleanups, ['detach', 'capture']);
  assert.equal(contents.listenerCount('destroyed'), 0);
});
