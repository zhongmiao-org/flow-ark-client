import test from 'node:test';
import assert from 'node:assert/strict';
import { flowOutline, outlineMatches, revealOutline } from '../src/renderer/flow-outline';
import { flatten } from '../src/renderer/flow-editing';
import type { Step } from '../src/shared/types';
const value = (id: string, name = id): Step => ({ id, name, type: 'value', version: 1, value: id });
test('forty steps keep stable identity and definition order across presentation groups', () => {
  const steps = Array.from({ length: 40 }, (_, i) => value('step_' + (i + 1), '步骤 ' + (i + 1)));
  const before = structuredClone(steps),
    model = flowOutline(steps);
  assert.deepEqual(
    model.groups.map(({ start, end }) => [start, end]),
    [
      [1, 8],
      [9, 16],
      [17, 24],
      [25, 32],
      [33, 40],
    ],
  );
  assert.deepEqual(
    model.entries.map(({ step }) => step.id),
    steps.map((step) => step.id),
  );
  assert.deepEqual(
    outlineMatches(model.entries, '步骤 32').map((entry) => entry.step.id),
    ['step_32'],
  );
  assert.deepEqual(outlineMatches(model.entries, 'STEP_32')[0].ordinal, 32);
  assert.deepEqual(steps, before);
});
test('nested branches reveal only ancestors of the real target and never copy input objects as nodes', () => {
  const steps: Step[] = [
    value('first'),
    {
      id: 'condition',
      name: '条件',
      type: 'condition',
      version: 1,
      actual: true,
      operator: 'equals',
      expected: true,
      then: [
        {
          id: 'loop',
          name: '每项处理',
          type: 'loop',
          version: 1,
          items: [1, 2],
          body: [value('target', '核对写入')],
        },
      ],
      else: [value('else_value')],
    },
    {
      id: 'http',
      type: 'http',
      version: 1,
      method: 'POST',
      url: 'https://example.invalid',
      headers: {},
      body: { id: 'fake_node', type: 'loop', body: [] },
    },
  ];
  const model = flowOutline(steps),
    entry = model.byId.get('target')!;
  assert.deepEqual(
    model.entries.map(({ step }) => step.id),
    flatten(steps).map((step) => step.id),
  );
  assert.equal(entry.group, 'condition');
  assert.equal(entry.ordinal, 4);
  assert.deepEqual(entry.ancestors, ['condition:then', 'loop:body']);
  const closed = new Set(['condition:then', 'condition:else', 'loop:body']);
  const opened = revealOutline(entry, closed);
  assert.deepEqual([...opened.collapsed], ['condition:else']);
  assert.equal(closed.size, 3);
  assert.equal(model.byId.has('fake_node'), false);
  assert.equal(outlineMatches(model.entries, '核对 写入')[0].step.id, 'target');
  assert.deepEqual(outlineMatches(model.entries, '不存在'), []);
});
test('collapsed and renamed/reordered drafts never mutate their independent snapshot model', () => {
  const snapshot = flowOutline([value('one'), value('two')]);
  const draft = flowOutline([value('two', '新名称'), value('three')]);
  assert.equal(snapshot.byId.get('two')?.ordinal, 2);
  assert.equal(draft.byId.get('two')?.ordinal, 1);
  assert.equal(snapshot.byId.get('two')?.step.name, 'two');
  assert.equal(draft.byId.has('one'), false);
  assert.deepEqual(flowOutline([]).groups, []);
  assert.throws(() => flowOutline([], 0));
});
