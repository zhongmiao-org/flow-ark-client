import test from 'node:test';
import assert from 'node:assert/strict';
import { Sessions } from '../src/host/sessions';
import type { BrowserBinding } from '../src/shared/types';
import {
  EMBEDDED_CLOSE_RPC_TIMEOUT_MS,
  type EmbeddedCloseReceipt,
  type EmbeddedStartReceipt,
} from '../src/shared/embedded-lifecycle';

const binding: BrowserBinding = {
  id: 'fixture',
  product: 'chrome',
  executable: '/fixture/chrome',
  version: 'fixture',
};
test('a cancelled session late rejection cannot close the next run session', async () => {
  const sessions = new Sessions('/unused', '/unused', '/unused');
  let failOld!: (e: Error) => void;
  const pending = new Promise((_resolve, reject) => {
    failOld = reject;
  });
  let performing!: () => void;
  const started = new Promise<void>((resolve) => {
    performing = resolve;
  });
  const old = {
    child: {},
    owner: 'old-run',
    ready: Promise.resolve(),
    rpc: {
      call: async (method: string) => (method === 'close' ? true : (performing(), pending)),
      close() {},
    },
  };
  let newClosed = false;
  const next = {
    child: {},
    owner: 'next-run',
    ready: Promise.resolve(),
    rpc: {
      call: async (method: string) => {
        if (method === 'close') newClosed = true;
        return 'new-result';
      },
      close() {},
    },
  };
  const entries: Map<string, any> = (sessions as any).sessions;
  entries.set(binding.id, old);
  const first = assert.rejects(
    sessions.use(binding, 'old-run', { operation: 'wait' }),
    /cancelled/,
  );
  await started;
  await sessions.close(binding.id);
  entries.set(binding.id, next);
  assert.equal(await sessions.use(binding, 'next-run', { operation: 'read' }), 'new-result');
  failOld(new Error('cancelled'));
  await first;
  assert.equal(newClosed, false, 'old failure must only clean its own session');
  assert.equal(entries.get(binding.id), next);
});

test('closing a profile blocks reuse, release joins cleanup, and cancelled waiting runs cannot launch', async () => {
  const sessions = new Sessions('/unused', '/unused', '/unused');
  let finishClose!: () => void;
  const closing = new Promise<void>((resolve) => {
    finishClose = resolve;
  });
  const entries: Map<string, any> = (sessions as any).sessions;
  entries.set(binding.id, {
    child: {},
    owner: 'old-run',
    ready: Promise.resolve(),
    rpc: { call: async () => closing, close() {} },
  });
  const close = sessions.close(binding.id);
  let released = false;
  const release = sessions.release('old-run', true).then(() => {
    released = true;
  });
  const signal = new AbortController();
  const next = assert.rejects(
    sessions.use(binding, 'next-run', { operation: 'read' }, signal.signal),
    /cancelled/,
  );
  await Promise.resolve();
  assert.equal(released, false);
  assert.equal(entries.size, 0);
  signal.abort(new Error('cancelled'));
  finishClose();
  await Promise.all([close, release, next]);
  assert.equal(released, true);
  assert.equal(entries.size, 0);
  await sessions.shutdown();
  await assert.rejects(sessions.use(binding, 'future-run', { operation: 'read' }), /退出/);
});

const embedded: BrowserBinding = {
  id: 'embedded',
  product: 'embedded',
  executable: '/unused',
  version: 'fixture',
};

function gate<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function embeddedFixture(
  hooks: {
    start?: (receipt: EmbeddedStartReceipt) => any;
    close?: (receipt: EmbeddedCloseReceipt) => any;
    perform?: (command: any) => any;
  } = {},
) {
  const calls: { method: string; args: any }[] = [];
  const resources = new Map<string, string>();
  const sessions = new Sessions('/unused', '/unused', '/unused', async (method, args) => {
    calls.push({ method, args });
    if (method === 'browser.embedded.start') {
      const resourceId = 'resource-' + (resources.size + 1);
      resources.set(args.token, resourceId);
      const receipt: EmbeddedStartReceipt = { token: args.token, resourceId, state: 'ready' };
      return hooks.start ? hooks.start(receipt) : receipt;
    }
    if (method === 'browser.embedded.close') {
      const receipt: EmbeddedCloseReceipt = {
        token: args.token,
        resourceId: resources.get(args.token),
        state: 'closed',
      };
      return hooks.close ? hooks.close(receipt) : receipt;
    }
    if (method === 'browser.embedded.perform')
      return hooks.perform ? hooks.perform(args.command) : 'fresh';
    return true;
  });
  const count = (operation: string) =>
    calls.filter(({ method }) => method === 'browser.embedded.' + operation).length;
  return { sessions, calls, resources, count };
}

test('embedded cleanup joins duplicate releases and blocks new leases until matching confirmation', async () => {
  const performing = gate(),
    closed = gate(),
    finishClose = gate(),
    oldCommand = gate();
  const f = embeddedFixture({
    perform: (command) => {
      if (command.operation === 'wait') {
        performing.resolve();
        return oldCommand.promise;
      }
      return 'fresh';
    },
    close: async (receipt) => {
      closed.resolve();
      await finishClose.promise;
      return receipt;
    },
  });
  const old = assert.rejects(f.sessions.use(embedded, 'old', { operation: 'wait' }), /关闭/);
  await performing.promise;
  await assert.rejects(f.sessions.use(embedded, 'other', { operation: 'read' }), /占用/);
  const closing = f.sessions.release('old', true);
  await closed.promise;
  let duplicateSettled = false;
  const duplicate = f.sessions.release('old', true).then((result) => {
    duplicateSettled = true;
    return result;
  });
  const next = f.sessions.use(embedded, 'next', { operation: 'read' });
  await Promise.resolve();
  assert.equal(duplicateSettled, false);
  assert.equal(f.count('start'), 1);
  assert.equal(f.count('close'), 1);
  finishClose.resolve();
  assert.deepEqual(await closing, { confirmed: true });
  assert.deepEqual(await duplicate, { confirmed: true });
  await old;
  assert.equal(await next, 'fresh');
  oldCommand.reject(new Error('late old command failure'));
  await Promise.resolve();
  assert.equal(f.count('close'), 1, 'old command must not close the replacement');
  assert.equal(await f.sessions.use(embedded, 'next', { operation: 'read' }), 'fresh');
  assert.deepEqual(await f.sessions.shutdown(), { confirmed: true });
});

test('close rejection retains the run identity, preserves the original command error, and blocks reuse', async () => {
  const f = embeddedFixture({
    perform: () => {
      throw new Error('original command failure');
    },
    close: () => {
      throw new Error('native close rejected');
    },
  });
  await assert.rejects(
    f.sessions.use(embedded, 'failed', { operation: 'read' }),
    /original command failure/,
  );
  assert.match(f.sessions.recoveryError!, /native close rejected/);
  const first = await f.sessions.release('failed', true);
  assert.equal(first.confirmed, false);
  assert.match(first.error!, /native close rejected/);
  f.sessions.finishRun('failed');
  assert.deepEqual(
    await f.sessions.release('failed', true),
    first,
    'unknown cleanup cannot be forgotten',
  );
  assert.deepEqual(await f.sessions.release('failed', false), first);
  await assert.rejects(f.sessions.use(embedded, 'next', { operation: 'read' }), /回收未确认/);
  await assert.rejects(f.sessions.embeddedVisibility(true), /回收未确认/);
  await f.sessions.embeddedVisibility(false);
  assert.equal(f.count('start'), 1);
  assert.equal(f.count('perform'), 1);
  assert.equal(f.count('close'), 1);
  assert.deepEqual(await f.sessions.shutdown(), first);
});

test('close requires an exact token and resource receipt, never a legacy or unrelated acknowledgement', async (t) => {
  const invalid: [string, (receipt: EmbeddedCloseReceipt) => unknown][] = [
    ['undefined', () => undefined],
    ['boolean', () => true],
    ['missing identity', () => ({ state: 'closed' })],
    ['different token', (receipt) => ({ ...receipt, token: 'unrelated' })],
    ['different resource', (receipt) => ({ ...receipt, resourceId: 'unrelated' })],
    [
      'unknown',
      (receipt) => ({ ...receipt, state: 'unknown', error: 'native resource remains alive' }),
    ],
  ];
  for (const [name, close] of invalid)
    await t.test(name, async () => {
      const f = embeddedFixture({ close });
      await f.sessions.use(embedded, 'old', { operation: 'read' });
      assert.equal((await f.sessions.release('old', true)).confirmed, false);
      assert.ok(f.sessions.recoveryError);
      await assert.rejects(f.sessions.use(embedded, 'next', { operation: 'read' }), /回收未确认/);
      assert.equal(f.count('start'), 1);
      assert.equal(f.count('perform'), 1);
    });
});

test('a close timeout is sticky even if the matching destroyed receipt arrives later', async (t) => {
  const entered = gate(),
    finish = gate();
  const f = embeddedFixture({
    close: async (receipt) => {
      entered.resolve();
      await finish.promise;
      return receipt;
    },
  });
  await f.sessions.use(embedded, 'old', { operation: 'read' });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const closing = f.sessions.release('old', true);
  await entered.promise;
  t.mock.timers.tick(EMBEDDED_CLOSE_RPC_TIMEOUT_MS);
  const result = await closing;
  assert.equal(result.confirmed, false);
  assert.match(result.error!, /超时/);
  finish.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(await f.sessions.release('old', true), result);
  assert.equal(f.sessions.recoveryError, result.error);
  await assert.rejects(f.sessions.use(embedded, 'next', { operation: 'read' }), /超时/);
  assert.equal(f.count('start'), 1);
});

test('cancelling during start closes its token without waiting for ready and prevents late resurrection', async () => {
  const entered = gate(),
    finish = gate();
  let first = true;
  const f = embeddedFixture({
    start: async (receipt) => {
      if (first) {
        first = false;
        entered.resolve();
        await finish.promise;
      }
      return receipt;
    },
  });
  const starting = assert.rejects(f.sessions.use(embedded, 'old', { operation: 'read' }), /关闭/);
  await entered.promise;
  assert.deepEqual(await f.sessions.release('old', true), { confirmed: true });
  await starting;
  assert.equal(f.count('perform'), 0);
  assert.equal(await f.sessions.use(embedded, 'next', { operation: 'read' }), 'fresh');
  finish.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(await f.sessions.use(embedded, 'next', { operation: 'read' }), 'fresh');
  assert.equal(f.count('start'), 2);
  assert.equal(f.count('close'), 1);
  assert.equal(f.sessions.recoveryError, undefined);
  await f.sessions.shutdown();
});

test('a cancelled waiter cannot start after the preceding close is confirmed', async () => {
  const entered = gate(),
    finish = gate();
  const f = embeddedFixture({
    close: async (receipt) => {
      entered.resolve();
      await finish.promise;
      return receipt;
    },
  });
  await f.sessions.use(embedded, 'old', { operation: 'read' });
  const closing = f.sessions.release('old', true);
  await entered.promise;
  const abort = new AbortController();
  const waiting = assert.rejects(
    f.sessions.use(embedded, 'waiting', { operation: 'read' }, abort.signal),
    /waiter cancelled/,
  );
  abort.abort(new Error('waiter cancelled'));
  finish.resolve();
  await closing;
  await waiting;
  assert.equal(f.count('start'), 1);
  assert.equal(f.count('perform'), 1);
});

test('healthy handoff preserves the page but allows cancellation before finishRun commits completion', async () => {
  const f = embeddedFixture();
  await f.sessions.use(embedded, 'first', { operation: 'read' });
  assert.deepEqual(await f.sessions.release('first', false), { confirmed: true });
  assert.equal(f.count('close'), 0);
  assert.deepEqual(await f.sessions.release('first', true), { confirmed: true });
  assert.equal(f.count('close'), 1, 'cancel during finalization still owns the released lease');
  f.sessions.finishRun('first');
  await f.sessions.use(embedded, 'second', { operation: 'read' });
  await f.sessions.release('second', false);
  f.sessions.finishRun('second');
  assert.deepEqual(await f.sessions.release('second', true), { confirmed: true });
  await f.sessions.use(embedded, 'third', { operation: 'read' });
  assert.equal(f.count('start'), 2, 'the healthy second page is reused');
  assert.equal(f.count('close'), 1);
  await f.sessions.shutdown();
});

test('handoff to a new owner revokes old cleanup and late failed-command authority', async () => {
  const oldCommand = gate(),
    entered = gate();
  const f = embeddedFixture({
    perform: (command) => {
      if (command.operation === 'wait') {
        entered.resolve();
        return oldCommand.promise;
      }
      return 'fresh';
    },
  });
  const old = assert.rejects(
    f.sessions.use(embedded, 'old', { operation: 'wait' }),
    /late failure/,
  );
  await entered.promise;
  await f.sessions.release('old', false);
  await f.sessions.use(embedded, 'next', { operation: 'read' });
  await f.sessions.release('old', true);
  oldCommand.reject(new Error('late failure'));
  await old;
  f.sessions.finishRun('old');
  assert.equal(f.count('close'), 0);
  assert.equal(f.count('start'), 1);
  assert.equal(await f.sessions.use(embedded, 'next', { operation: 'read' }), 'fresh');
  await f.sessions.shutdown();
});

test('lost notices retain exact lease identity and still require close confirmation after destroyed', async () => {
  const f = embeddedFixture();
  await f.sessions.use(embedded, 'old', { operation: 'read' });
  const [token, id] = [...f.resources][0];
  const notice = { token, resourceId: id, reason: 'renderer lost', destroyed: true };
  assert.equal(f.sessions.embeddedLost({ ...notice, token: 'other' }), undefined);
  assert.equal(f.sessions.embeddedLost({ ...notice, resourceId: 'other' }), undefined);
  assert.equal(f.sessions.embeddedLost(notice), 'old');
  assert.equal(f.count('close'), 0);
  assert.deepEqual(await f.sessions.release('old', true), { confirmed: true });
  assert.equal(f.count('close'), 1);
  await f.sessions.use(embedded, 'next', { operation: 'read' });
  assert.equal(f.sessions.embeddedLost(notice), undefined);
  assert.equal(await f.sessions.use(embedded, 'next', { operation: 'read' }), 'fresh');
  await f.sessions.shutdown();
});

test('idle lost pages close once and the next Run waits for matching destruction before acquiring a new lease', async () => {
  const entered = gate(),
    finish = gate();
  const f = embeddedFixture({
    close: async (receipt) => {
      entered.resolve();
      await finish.promise;
      return receipt;
    },
  });
  await f.sessions.use(embedded, 'finished', { operation: 'read' });
  await f.sessions.release('finished', false);
  f.sessions.finishRun('finished');
  const [token, resourceId] = [...f.resources][0];
  const notice = { token, resourceId, reason: 'idle renderer lost', destroyed: true };
  assert.equal(f.sessions.embeddedLost(notice), undefined);
  assert.equal(f.sessions.embeddedLost(notice), undefined);
  // Start immediately, before the notification's close RPC has run.
  const next = f.sessions.use(embedded, 'next', { operation: 'read' });
  await entered.promise;
  assert.equal(f.count('close'), 1);
  assert.equal(f.count('start'), 1);
  assert.equal(f.count('perform'), 1);
  assert.deepEqual(f.calls.find(({ method }) => method.endsWith('.close'))?.args, {
    token,
    resourceId,
  });
  finish.resolve();
  assert.equal(await next, 'fresh');
  assert.equal(f.count('start'), 2);
  assert.equal(f.count('perform'), 2);
  assert.notEqual([...f.resources][1][0], token);
  assert.equal(f.sessions.recoveryError, undefined);
  assert.equal(f.sessions.embeddedLost(notice), undefined);
  await f.sessions.release('finished', true);
  assert.equal(f.count('close'), 1, 'the completed Run cannot close the replacement page');
  await f.sessions.shutdown();
});

test('idle lost close failure blocks waiting and future Runs without creating another lease', async () => {
  const entered = gate(),
    finish = gate();
  const f = embeddedFixture({
    close: async (receipt) => {
      entered.resolve();
      await finish.promise;
      return { ...receipt, state: 'unknown', error: 'idle destruction unavailable' };
    },
  });
  await f.sessions.use(embedded, 'finished', { operation: 'read' });
  await f.sessions.release('finished', false);
  f.sessions.finishRun('finished');
  const [token, resourceId] = [...f.resources][0];
  const notice = { token, resourceId, reason: 'idle renderer lost', destroyed: false };
  assert.equal(f.sessions.embeddedLost(notice), undefined);
  const waiting = assert.rejects(
    f.sessions.use(embedded, 'waiting', { operation: 'read' }),
    /idle destruction unavailable/,
  );
  await entered.promise;
  assert.equal(f.count('start'), 1);
  finish.resolve();
  await waiting;
  assert.match(f.sessions.recoveryError!, /idle destruction unavailable/);
  f.sessions.embeddedLost({ ...notice, destroyed: true });
  await assert.rejects(
    f.sessions.use(embedded, 'future', { operation: 'read' }),
    /idle destruction unavailable/,
  );
  assert.equal(f.count('start'), 1);
  assert.equal(f.count('perform'), 1);
  assert.equal(f.count('close'), 1);
  assert.equal((await f.sessions.shutdown()).confirmed, false);
});

test('invalid ready receipts never reach perform, and confirmed cleanup preserves flush warnings', async () => {
  const f = embeddedFixture({
    start: () => true,
    close: (receipt) => ({ ...receipt, warnings: ['fictional storage flush failure'] }),
  });
  await assert.rejects(f.sessions.use(embedded, 'old', { operation: 'read' }), /启动回执身份无效/);
  assert.equal(f.count('perform'), 0);
  assert.deepEqual(await f.sessions.release('old', true), {
    confirmed: true,
    warnings: ['fictional storage flush failure'],
  });
  assert.equal(f.sessions.recoveryError, undefined);
});
