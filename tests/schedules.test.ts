import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIPC } from '../src/shared/ipc';

test('schedule IPC requires explicit version adoption, concurrency revision and valid timing', () => {
  const args = {
    id: 'plan',
    revision: 'revision',
    intervalMinutes: 1,
    timezone: 'Asia/Shanghai',
    adoptLatest: false,
  };
  assert.deepEqual(validateIPC('schedule.update', args), args);
  assert.deepEqual(validateIPC('schedule.update', { ...args, revision: null }), {
    ...args,
    revision: null,
  });
  assert.doesNotThrow(() =>
    validateIPC('schedule.update', {
      ...args,
      adoptLatest: true,
      flowUpdatedAt: '2026-09-20T00:00:00.000Z',
    }),
  );
  for (const change of [
    { revision: undefined },
    { adoptLatest: undefined },
    { adoptLatest: true },
    { adoptLatest: true, flowUpdatedAt: 'yesterday' },
    { flowUpdatedAt: '2026-09-20T00:00:00.000Z' },
    { intervalMinutes: 0 },
    { intervalMinutes: 1.5 },
    { intervalMinutes: 525601 },
    { timezone: '' },
    { timezone: 'Unknown/Zone' },
    { enabled: true },
    { flowId: 'other' },
  ])
    assert.throws(() => validateIPC('schedule.update', { ...args, ...change }));
  const create = { flowId: 'flow', intervalMinutes: 30, timezone: 'UTC' };
  assert.deepEqual(validateIPC('schedule.save', create), create);
  assert.throws(() => validateIPC('schedule.save', { ...create, id: 'overwrite-plan' }));
});
