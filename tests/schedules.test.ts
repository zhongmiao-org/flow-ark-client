import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIPC } from '../src/shared/ipc';
import { Store } from '../src/host/store';
import { inspectSchedule } from '../src/host/schedule-inspection';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

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

test('schedule inspection is strictly scoped, stable across newer records and read-only with no private version data', () => {
  const path = mkdtempSync(join(tmpdir(), 'schedule-inspect-'));
  const store = new Store(join(path, 'store.db'), randomBytes(32));
  try {
    const plan = {
      id: 'plan',
      flowId: 'flow',
      versionId: 'fixed',
      intervalMinutes: 60,
      timezone: 'UTC',
      enabled: true,
      nextAt: 500,
      revision: 'r1',
    };
    store.put('schedule', plan.id, plan);
    store.put('version', 'fixed', {
      flow: { name: '原固定内容' },
      updatedAt: '2026-09-20T00:00:00Z',
      bindings: { secret: 'private' },
      scripts: { text: 'private' },
    });
    store.put('flow', 'flow', {
      flow: { name: '新的已保存内容' },
      updatedAt: '2026-09-21T00:00:00Z',
    });
    store.put('run', 'other-run', { id: 'other-run', scheduleId: 'other', state: 'RUNNING' });
    store.put('run', 'done-run', { id: 'done-run', scheduleId: 'plan', state: 'SUCCEEDED' });
    store.put('run', 'active-run', {
      id: 'active-run',
      scheduleId: 'plan',
      name: '真实来源',
      state: 'WAITING_INPUT',
      private: 'not returned',
    });
    for (let i = 0; i < 45; i++) {
      store.put('schedule-log', 'other-' + i, { scheduleId: 'other', reason: 'occupied', time: i });
      store.put('schedule-log', 'own-' + i, {
        scheduleId: 'plan',
        reason: i % 3 === 0 ? 'occupied' : i % 3 === 1 ? 'application-restart' : 'secret failed',
        ...(i % 3 === 1 ? { from: i, to: i + 1 } : { time: i }),
      });
    }
    const read = (cursor?: any) =>
      inspectSchedule(store, { id: 'plan', ...(cursor ? { cursor } : {}) }, (text) =>
        text.replace('secret', '[redacted]'),
      );
    const first = read();
    assert.equal(first.records.length, 20);
    assert.deepEqual(first.activeRun, {
      id: 'active-run',
      name: '真实来源',
      state: 'WAITING_INPUT',
    });
    assert.deepEqual(first.version, {
      id: 'fixed',
      name: '原固定内容',
      savedAt: '2026-09-20T00:00:00Z',
    });
    assert.ok(!JSON.stringify(first).includes('private'));
    assert.ok(!JSON.stringify(first).includes('secret'));
    const size = store.lastPosition('schedule-log');
    store.put('schedule-log', 'new', {
      scheduleId: 'plan',
      reason: 'system-resume',
      from: 100,
      to: 110,
    });
    const second = read(first.nextCursor),
      third = read(second.nextCursor);
    const all = [...first.records, ...second.records, ...third.records];
    assert.equal(all.length, 45);
    assert.equal(new Set(all.map((r) => r.position)).size, 45);
    assert.equal(third.nextCursor, null);
    assert.ok(all.every((record) => record.position <= size));
    assert.equal(read().records[0].from, 100);
    assert.deepEqual(store.get('schedule', 'plan'), plan);
    assert.equal(store.list('run').length, 3);
    assert.equal(store.list('version').length, 1);
    assert.throws(() => inspectSchedule(store, { id: 'missing' }, (text) => text), /不存在/);
    store.remove('version', 'fixed');
    assert.equal(read().version, null);
    for (const args of [
      { id: 'plan', extra: true },
      { id: 'plan', cursor: { scheduleId: 'other', ceiling: 10, before: 11 } },
      { id: 'plan', cursor: { scheduleId: 'plan', ceiling: -1, before: 11 } },
      { id: 'plan', cursor: { scheduleId: 'plan', ceiling: 10, before: 0 } },
    ])
      assert.throws(() => validateIPC('schedule.inspect', args));
    assert.throws(() =>
      validateIPC('schedule.save', {
        flowId: 'flow',
        intervalMinutes: 60,
        timezone: 'UTC',
        flowUpdatedAt: 'stale',
      }),
    );
  } finally {
    store.close();
    rmSync(path, { recursive: true, force: true });
  }
});
