import test from 'node:test';
import assert from 'node:assert/strict';
import type { Flow, Step } from '../src/shared/types';
import {
  referenceScope,
  referenceChoices,
  referenceOf,
  composeReference,
} from '../src/renderer/value-references';
import { referenceIssues } from '../src/shared/flow-references';
import { execute, resolveValue } from '../src/core/engine';
const value = (id: string, v: any = ''): Step => ({ id, type: 'value', version: 1, value: v });
const flow = (steps: Step[], parameters: any = {}): Flow =>
  ({
    formatVersion: '1.0',
    id: 'values',
    name: 'values',
    description: '',
    parameters,
    steps,
    requiredCapabilities: [],
  }) as Flow;

test('候选仅包含词法前序节点；不同条件分支、容器自身与后序不泄漏', () => {
  const steps: Step[] = [
    value('first'),
    {
      id: 'branch',
      type: 'condition',
      version: 1,
      actual: true,
      expected: true,
      operator: 'equals',
      then: [value('a'), value('b')],
      else: [value('c')],
    },
    value('last'),
  ];
  assert.deepEqual(
    referenceScope(steps, 'b')?.steps.map((n) => n.id),
    ['first', 'a'],
  );
  assert.deepEqual(
    referenceScope(steps, 'c')?.steps.map((n) => n.id),
    ['first'],
  );
  assert.deepEqual(
    referenceScope(steps, 'last')?.steps.map((n) => n.id),
    ['first', 'branch'],
  );
  for (const id of ['first', 'a', 'b', 'c', 'last']) {
    for (const choice of referenceChoices(flow(steps), id)) {
      const replace = (nodes: Step[]): Step[] =>
        nodes.map((n) =>
          n.id === id
            ? value(id, { $ref: choice.path })
            : n.type === 'condition'
              ? { ...n, then: replace(n.then), else: replace(n.else) }
              : n,
        );
      assert.deepEqual(referenceIssues(replace(steps), {}), []);
    }
  }
  assert.deepEqual(referenceChoices(flow(steps), 'missing'), []);
});

test('嵌套循环指向最近循环，仅循环体内有 item/index', () => {
  const steps: Step[] = [
    {
      id: 'outer',
      type: 'loop',
      version: 1,
      items: [1],
      body: [
        value('a'),
        { id: 'inner', type: 'loop', version: 1, items: [2], body: [value('b')] },
        value('c'),
      ],
    },
    value('after'),
  ];
  assert.equal(referenceScope(steps, 'b')?.loop?.id, 'inner');
  assert.equal(referenceScope(steps, 'c')?.loop?.id, 'outer');
  assert.deepEqual(
    referenceScope(steps, 'b')?.steps.map((n) => n.id),
    ['a'],
  );
  assert.ok(referenceChoices(flow(steps), 'b').some((c) => c.path === 'item'));
  for (const id of ['outer', 'after'])
    assert.ok(!referenceChoices(flow(steps), id).some((c) => ['item', 'index'].includes(c.path)));
});

test('只展开可表达的静态字段，不推断脚本、分支与循环结果', () => {
  const f = flow(
    [
      value('data', { child: { text: 'literal' }, dynamic: { $ref: 'params.obj' }, 'a.b': 1 }),
      {
        id: 'script',
        type: 'script',
        version: 1,
        code: '',
        input: {},
        language: 'js',
        dependencies: [],
      },
      value('target'),
    ],
    { obj: { items: ['a'] }, 'bad.key': 1, constructor: 4 },
  );
  const options = referenceChoices(f, 'target'),
    paths = options.map((c) => c.path);
  assert.ok(paths.includes('params.obj.items.0'));
  assert.ok(paths.includes('steps.data.child.text'));
  assert.ok(paths.includes('steps.data.dynamic'));
  assert.ok(
    !paths.some(
      (p) =>
        p.includes('$ref') ||
        p.includes('a.b') ||
        p.includes('bad.key') ||
        p.includes('constructor'),
    ),
  );
  assert.deepEqual(
    paths.filter((p) => p.startsWith('steps.script')),
    ['steps.script'],
  );
  assert.equal(
    composeReference(options, 'steps.script', 'rows.0.name'),
    'steps.script.rows.0.name',
  );
  for (const path of ['.x', 'x.', 'a..b', '__proto__', 'a.constructor.x'])
    assert.throws(() => composeReference(options, 'steps.script', path));
  assert.throws(() => composeReference(options, 'steps.future', ''));
  assert.equal(referenceOf({ $ref: 'params.obj' }), 'params.obj');
  assert.equal(referenceOf({ $ref: 'params.obj', literal: true }), undefined);
});

test('选择的参数、前序与最近循环引用按真实引擎求值，类型保持不变', async () => {
  const f = flow(
    [
      value('a', { $ref: 'params.object' }),
      {
        id: 'loop',
        type: 'loop',
        version: 1,
        items: { $ref: 'params.items' },
        body: [
          value('b', { $ref: 'item' }),
          value('i', { $ref: 'index' }),
          value('p', { $ref: 'steps.a.enabled' }),
        ],
      },
      value('last', { $ref: 'steps.loop.1.b' }),
    ],
    { object: { enabled: false }, items: [{ name: 'a' }, { name: 'b' }] },
  );
  const result = await execute(f, f.parameters, {
    signal: new AbortController().signal,
    boundary: async () => {},
    emit: async () => {},
    perform: async () => {
      throw new Error('unexpected');
    },
    human: async () => {},
  });
  assert.deepEqual(result.loop, [
    { b: { name: 'a' }, i: 0, p: false },
    { b: { name: 'b' }, i: 1, p: false },
  ]);
  assert.deepEqual(result.last, { name: 'b' });
  assert.throws(() => resolveValue({ $ref: 'steps.loop.2.b' }, { steps: result }), /不存在/);
});
