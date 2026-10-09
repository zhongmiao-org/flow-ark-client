import test from 'node:test';
import assert from 'node:assert/strict';
import { filterFlows, relativeEditTime } from '../src/renderer/flow-library';
import type { FlowRecord } from '../src/shared/types';

test('flow search intersects source and local recent filters without mutating source order', () => {
  const now = new Date(2026, 8, 21, 12);
  const make = (id: string, date: Date, template = false): FlowRecord => ({
    id,
    updatedAt: date.toISOString(),
    bindings: { files: {}, credentials: [] },
    flow: {
      id,
      formatVersion: '1.0',
      name: id,
      description: '',
      parameters: {},
      requiredCapabilities: [],
      steps: [],
      ...(template
        ? { sourceTemplate: { id: 'fixture', version: '1.0.0', digest: '0'.repeat(64) } }
        : {}),
    },
  });
  const old = make('Older Alpha', new Date(2026, 8, 14, 23, 59)),
    recent = make('ALPHA', new Date(2026, 8, 15), true),
    latest = make('Other', now);
  const records = [old, recent, latest];
  assert.deepEqual(
    filterFlows(records, 'recent', ' alpha ', now).map((x) => x.id),
    ['ALPHA'],
  );
  assert.deepEqual(
    filterFlows(records, 'template', 'ALP', now).map((x) => x.id),
    ['ALPHA'],
  );
  assert.deepEqual(
    filterFlows(records, 'all', '', now).map((x) => x.id),
    ['Other', 'ALPHA', 'Older Alpha'],
  );
  assert.deepEqual(records, [old, recent, latest]);
  assert.equal(relativeEditTime('invalid', now), '时间待核对');
  assert.equal(relativeEditTime(new Date(now.getTime() + 1000).toISOString(), now), '时间待核对');
});
