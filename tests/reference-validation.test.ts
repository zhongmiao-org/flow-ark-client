import test from 'node:test';
import assert from 'node:assert/strict';
import type { Json, Step } from '../src/shared/types';
import example from '../contracts/example.flow.json';
import { validateFlow } from '../src/core/validate';
import { execute } from '../src/core/engine';
import { referenceIssues } from '../src/shared/flow-references';
import {
  checkStructure,
  changeSteps,
  moveStep,
  moveSibling,
  duplicateStep,
} from '../src/renderer/flow-editing';
const value = (id: string, value: Json): Step => ({ id, type: 'value', version: 1, value });
const http = (body: Json): Step => ({
  id: 'send',
  type: 'http',
  version: 1,
  method: 'POST',
  url: 'http://127.0.0.1:1/',
  headers: {},
  body,
});
const ref = ($ref: string) => ({ $ref });

test('HTTP body participates in save validation and source, parameter and container-output edit guards', () => {
  for (const body of [ref('steps.missing'), { nested: [ref('steps.missing')] }]) {
    assert.throws(() => validateFlow({ ...example, steps: [http(body)] }), /steps.missing.*send/);
  }
  const steps = [value('source', 7), http({ nested: [ref('steps.source')] })];
  validateFlow({ ...example, steps });
  assert.throws(
    () =>
      checkStructure(
        steps,
        changeSteps(steps, 'source', () => null),
        {},
      ),
    /send.*steps.source/,
  );
  assert.throws(
    () => checkStructure(steps, moveSibling(steps, 'send', -1), {}),
    /send.*steps.source/,
  );
  assert.deepEqual(referenceIssues([http(ref('params.payload'))], { payload: 42 }), []);
  assert.match(referenceIssues([http(ref('params.payload'))], {})[0].reference, /params.payload/);
  const group: Step = {
    id: 'group',
    type: 'condition',
    version: 1,
    actual: true,
    expected: true,
    operator: 'equals',
    then: [value('child', 3)],
    else: [],
  };
  const nested = [group, http(ref('steps.group.child'))];
  assert.throws(
    () =>
      checkStructure(nested, moveStep(nested, 'child', { anchor: 'group', side: 'before' }), {}),
    /send.*steps.group.child/,
  );
});

test('reference paths require own parameter names, nonempty segments and scalar loop index', () => {
  for (const path of [
    'params.toString',
    'params.valueOf',
    'params.hasOwnProperty',
    'params',
    'params.',
    'params.known.',
    'params.known..x',
    'steps.',
    'steps',
    'params.known.__proto__',
  ]) {
    assert.throws(
      () =>
        validateFlow({
          ...example,
          parameters: { known: {}, undefined: 1 },
          steps: [value('bad', ref(path))],
        }),
      /引用/,
    );
  }
  validateFlow({
    ...example,
    parameters: { toString: 'own value' },
    steps: [value('own', ref('params.toString'))],
  });
  const loop: Step = { id: 'loop', type: 'loop', version: 1, items: [1], body: [] };
  for (const path of ['index.x', 'index.', 'item.', 'item..x']) {
    assert.throws(
      () => validateFlow({ ...example, steps: [{ ...loop, body: [http(ref(path))] }] }),
      /引用/,
    );
  }
  for (const path of ['item', 'index', 'item.valid']) {
    validateFlow({ ...example, steps: [{ ...loop, body: [http(ref(path))] }] });
    assert.throws(() => validateFlow({ ...example, steps: [http(ref(path))] }), /作用域/);
  }
});

test('legal nested HTTP body values execute in lexical scope, including copied internal references', async () => {
  const group: Step = {
    id: 'group',
    type: 'condition',
    version: 1,
    actual: true,
    expected: true,
    operator: 'equals',
    then: [
      value('source', { count: 4 }),
      {
        id: 'loop',
        type: 'loop',
        version: 1,
        items: ['first', 'second'],
        body: [
          http({
            payload: [ref('steps.source.count'), ref('params.label'), ref('item'), ref('index')],
          }),
        ],
      },
    ],
    else: [],
  };
  let id = 0;
  const copied = duplicateStep([group], 'group', () => 'copy_' + ++id);
  const flow = validateFlow({ ...example, parameters: { label: 'fixture' }, steps: copied.steps });
  const bodies: unknown[] = [];
  await execute(flow, flow.parameters, {
    signal: new AbortController().signal,
    boundary: async () => {},
    emit: async () => {},
    human: async () => null,
    perform: async (_, resolved) => {
      bodies.push(resolved.body);
      return { ok: true };
    },
  });
  assert.deepEqual(bodies, [
    { payload: [4, 'fixture', 'first', 0] },
    { payload: [4, 'fixture', 'second', 1] },
    { payload: [4, 'fixture', 'first', 0] },
    { payload: [4, 'fixture', 'second', 1] },
  ]);
  const outside = [group, { ...http(ref('steps.source')), id: 'outside' }];
  assert.throws(
    () => validateFlow({ ...example, parameters: { label: 'fixture' }, steps: outside }),
    /作用域/,
  );
});
