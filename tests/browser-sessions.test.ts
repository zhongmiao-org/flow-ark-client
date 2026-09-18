import test from 'node:test';
import assert from 'node:assert/strict';
import { Sessions } from '../src/host/sessions';
import type { BrowserBinding } from '../src/shared/types';

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

test('embedded leases reject overlap, wait for close, and ignore a stale failed command', async () => {
  const binding = {
    id: 'embedded',
    product: 'embedded' as const,
    executable: '/unused',
    version: 'fixture',
  };
  let rejectOld!: (error: Error) => void;
  let finishClose!: () => void;
  const closed: string[] = [],
    started: string[] = [];
  const sessions = new Sessions('/unused', '/unused', '/unused', async (method, args) => {
    if (method.endsWith('.start')) {
      started.push(args.token);
      return true;
    }
    if (method.endsWith('.perform')) {
      if (args.command.operation === 'wait')
        return new Promise((_, reject) => {
          rejectOld = reject;
        });
      return 'fresh';
    }
    if (method.endsWith('.close') && args.token) {
      closed.push(args.token);
      if (closed.length === 1)
        await new Promise<void>((resolve) => {
          finishClose = resolve;
        });
    }
    return true;
  });
  const old = assert.rejects(sessions.use(binding, 'old', { operation: 'wait' }), /old/);
  while (!rejectOld) await new Promise((r) => setTimeout(r, 1));
  await assert.rejects(sessions.use(binding, 'other', { operation: 'read' }), /占用/);
  const closing = sessions.release('old', true);
  while (!finishClose) await new Promise((r) => setTimeout(r, 1));
  const next = sessions.use(binding, 'next', { operation: 'read' });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(started.length, 1);
  finishClose();
  await closing;
  assert.equal(await next, 'fresh');
  rejectOld(new Error('old failure'));
  await old;
  assert.equal(closed.length, 1);
  assert.equal(sessions.embeddedLost(started[0]), undefined);
  assert.equal(sessions.embeddedLost(started[1]), 'next');
  await sessions.shutdown();
});
