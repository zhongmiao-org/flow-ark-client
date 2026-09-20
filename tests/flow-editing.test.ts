import test from 'node:test';
import assert from 'node:assert/strict';
import type { FlowRecord, Step } from '../src/shared/types';
import example from '../contracts/example.flow.json';
import { validateFlow } from '../src/core/validate';
import { execute } from '../src/core/engine';
import {
  flatten,
  changeSteps,
  insertStep,
  duplicateStep,
  moveStep,
  moveSibling,
  checkStructure,
} from '../src/renderer/flow-editing';
import { draftHistory, emptyHistory } from '../src/renderer/draft-history';
const value = (id: string, value: any = id): Step => ({ id, type: 'value', version: 1, value });
const condition = (id: string, then: Step[], otherwise: Step[] = []): Step => ({
  id,
  type: 'condition',
  version: 1,
  actual: true,
  operator: 'equals',
  expected: true,
  then,
  else: otherwise,
});
const record = (id = 'draft'): FlowRecord => ({
  id,
  flow: validateFlow({ ...example, id }),
  bindings: { files: {}, credentials: [] },
  updatedAt: 'fixed',
});

test('insertion and explicit movement preserve the selected branch and immutable source', () => {
  const before = [condition('choice', [value('a'), value('b')], [value('c')]), value('end')];
  const original = JSON.stringify(before);
  let after = insertStep(before, value('insert'), { anchor: 'b', side: 'before' });
  after = moveStep(after, 'insert', { owner: 'choice', branch: 'else' });
  assert.deepEqual(
    (after[0] as any).then.map((n: Step) => n.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    (after[0] as any).else.map((n: Step) => n.id),
    ['c', 'insert'],
  );
  after = moveSibling(after, 'insert', -1);
  assert.deepEqual(
    (after[0] as any).else.map((n: Step) => n.id),
    ['insert', 'c'],
  );
  assert.equal(moveSibling(after, 'insert', -1), after);
  assert.equal(JSON.stringify(before), original);
  assert.throws(() => moveStep(after, 'choice', { anchor: 'b', side: 'after' }), /自身或子步骤/);
  assert.throws(
    () => insertStep(after, value('new'), { anchor: 'missing', side: 'after' }),
    /位置已删除/,
  );
  assert.throws(
    () => insertStep(after, value('new'), { owner: 'end', branch: 'body' }),
    /位置已删除/,
  );
});

test('copy remaps nested branch and loop outputs but preserves external refs and literal keys', async () => {
  const before: Step[] = [
    value('outside', 7),
    condition('group', [
      condition('nested', [value('leaf', { leaf: 3 })]),
      value('from_nested', { $ref: 'steps.nested.leaf.leaf' }),
      {
        id: 'repeat',
        type: 'loop',
        version: 1,
        items: [4],
        body: [value('item_value', { $ref: 'item' })],
      },
      value('from_loop', { $ref: 'steps.repeat.0.item_value' }),
      value('external', { $ref: 'steps.outside' }),
      value('literals', {
        id: 'leaf',
        text: 'steps.nested.leaf.leaf',
        code: 'return steps.leaf',
        path: '#leaf',
        leaf: true,
      }),
    ]),
  ];
  const original = JSON.stringify(before);
  let count = 0;
  const copied = duplicateStep(before, 'group', () => 'copy_' + ++count);
  assert.equal(new Set(flatten(copied.steps).map((n) => n.id)).size, flatten(copied.steps).length);
  checkStructure(before, copied.steps, {});
  const flow = validateFlow({ ...example, steps: copied.steps });
  const output = await execute(
    flow,
    {},
    {
      signal: new AbortController().signal,
      boundary: async () => {},
      emit: async () => {},
      perform: async () => null,
      human: async () => true,
    },
  );
  const children = (copied.steps[2] as any).then as Step[];
  assert.equal(output[copied.id][children[1].id], 3);
  assert.equal(output[copied.id][children[3].id], 4);
  assert.equal(output[copied.id][children[4].id], 7);
  assert.deepEqual(output[copied.id][children[5].id], (before[1] as any).then[5].value);
  assert.equal(JSON.stringify(before), original);
  assert.equal((children[4] as any).value.$ref, 'steps.outside');
});

test('structural edits reject new forward, deleted and out-of-loop references without requiring finished fields', () => {
  const before: Step[] = [
    value('a', 1),
    value('b', { $ref: 'steps.a' }),
    {
      id: 'blank',
      type: 'browser',
      version: 3,
      operation: 'fill',
      selector: '',
      framePath: [],
      value: '',
    },
  ];
  assert.throws(() => checkStructure(before, moveSibling(before, 'b', -1), {}), /b.*steps.a/);
  assert.throws(
    () =>
      checkStructure(
        before,
        changeSteps(before, 'a', () => null),
        {},
      ),
    /b.*steps.a/,
  );
  assert.doesNotThrow(() => checkStructure(before, insertStep(before, value('new'), {}), {}));
  const loop: Step[] = [
    {
      id: 'loop',
      type: 'loop',
      version: 1,
      items: [1],
      body: [value('item_node', { $ref: 'item' })],
    },
  ];
  assert.throws(() => checkStructure(loop, moveStep(loop, 'item_node', {}), {}), /item_node.*item/);
  assert.throws(
    () =>
      checkStructure(
        [],
        Array.from({ length: 1001 }, (_, i) => value('n' + i)),
        {},
      ),
    /1000/,
  );
});

test('history groups a focused edit, restores selection and bindings, and invalidates redo on change', () => {
  const original = record();
  let history = draftHistory(emptyHistory, { type: 'open', record: original });
  history = draftHistory(history, { type: 'select', selected: 'greeting' });
  for (const name of ['a', 'ab', 'abc'])
    history = draftHistory(history, {
      type: 'change',
      group: 'title-focus',
      record: { ...original, flow: { ...original.flow, name } },
    });
  assert.equal(history.past.length, 1);
  history = draftHistory(history, {
    type: 'change',
    record: {
      ...history.present!.record,
      bindings: { ...original.bindings, browserId: 'embedded' },
    },
  });
  history = draftHistory(history, { type: 'select', selected: 'verify' });
  history = draftHistory(history, { type: 'undo' });
  assert.equal(history.present!.record.bindings.browserId, undefined);
  assert.equal(history.present!.selected, 'greeting');
  history = draftHistory(history, { type: 'redo' });
  assert.equal(history.present!.selected, 'verify');
  assert.equal(history.present!.record.bindings.browserId, 'embedded');
  history = draftHistory(history, { type: 'undo' });
  history = draftHistory(history, { type: 'undo' });
  assert.deepEqual(history.present!.record, original);
  history = draftHistory(history, {
    type: 'change',
    record: { ...original, flow: { ...original.flow, name: 'new direction' } },
  });
  assert.equal(history.future.length, 0);
  assert.equal(draftHistory(history, { type: 'redo' }), history);
});

test('history limits edits, isolates flows and clones caller-owned records', () => {
  const original = record();
  let history = draftHistory(emptyHistory, { type: 'open', record: original });
  original.flow.name = 'mutated externally';
  assert.notEqual(history.present!.record.flow.name, original.flow.name);
  for (let i = 0; i < 110; i++)
    history = draftHistory(history, {
      type: 'change',
      record: {
        ...history.present!.record,
        flow: { ...history.present!.record.flow, name: String(i) },
      },
    });
  assert.equal(history.past.length, 100);
  assert.throws(() => draftHistory(history, { type: 'change', record: record('other') }), /不属于/);
  history = draftHistory(history, { type: 'open', record: record('other') });
  assert.equal(history.past.length, 0);
  assert.equal(history.future.length, 0);
  assert.equal(history.present!.selected, '');
});

test('moving or deleting a child cannot silently break downstream structural output paths', () => {
  const before: Step[] = [
    condition('choice', [value('child', 1)]),
    value('use', { $ref: 'steps.choice.child' }),
  ];
  assert.throws(
    () =>
      checkStructure(before, moveStep(before, 'child', { anchor: 'choice', side: 'before' }), {}),
    /use.*steps.choice.child/,
  );
  assert.throws(
    () =>
      checkStructure(
        before,
        changeSteps(before, 'child', () => null),
        {},
      ),
    /use.*steps.choice.child/,
  );
  const loop: Step[] = [
    { id: 'loop', type: 'loop', version: 1, items: [1], body: [value('child', 1)] },
    value('use', { $ref: 'steps.loop.0.child' }),
    value('length', { $ref: 'steps.loop.length' }),
  ];
  assert.throws(
    () => checkStructure(loop, moveStep(loop, 'child', { anchor: 'loop', side: 'before' }), {}),
    /steps.loop.0.child/,
  );
  assert.doesNotThrow(() => checkStructure(loop, insertStep(loop, value('new'), {}), {}));
});
