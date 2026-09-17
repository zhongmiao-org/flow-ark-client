import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagram } from '../src/renderer/flow-diagram';
import { execute } from '../src/core/engine';
import type { Flow, Step } from '../src/shared/types';

const value = (id: string): Step => ({ id, type: 'value', version: 1, value: id });
const condition = (id: string, yes: Step[], no: Step[], actual = true): Step => ({
  id,
  type: 'condition',
  version: 1,
  actual,
  operator: 'equals',
  expected: true,
  then: yes,
  else: no,
});
const loop = (id: string, body: Step[], items: number[] = [1, 2]): Step => ({
  id,
  type: 'loop',
  version: 1,
  items,
  body,
});

test('branch projection has two labeled exits and a merge; helpers never mutate the saved flow', () => {
  const steps = [condition('choose', [value('yes')], []), value('after')];
  const before = JSON.stringify(steps);
  const diagram = buildDiagram(steps, 'choose');
  const outgoing = diagram.edges.filter((e) => e.source === 'choose');
  assert.deepEqual(
    outgoing.map((e) => e.label),
    ['成立', '否则'],
  );
  assert.ok(!outgoing.some((e) => e.target === 'after'));
  assert.equal(diagram.edges.find((e) => e.target === 'after')?.source, '@join:choose');
  assert.equal(diagram.nodes.find((n) => n.id === 'choose')?.data.shape, 'decision');
  assert.equal(diagram.nodes.find((n) => n.id === 'yes')?.data.shape, 'data');
  assert.equal(diagram.nodes.filter((n) => n.selected).length, 1);
  assert.equal(diagram.stepCount, 3);
  assert.ok(diagram.nodes.filter((n) => !n.data.step).every((n) => n.selectable === false));
  assert.equal(JSON.stringify(steps), before);
});

test('nested conditions and loops reserve disjoint space, with connected empty branches and bodies', () => {
  const steps = [
    condition(
      'outer',
      [loop('repeat', [condition('inner', [value('a')], [condition('nested', [], [value('b')])])])],
      [condition('other', [], [loop('empty', [])])],
    ),
    value('after'),
  ];
  const { nodes, edges } = buildDiagram(steps);
  for (const [i, n] of nodes.entries()) {
    for (const other of nodes.slice(i + 1)) {
      const overlap =
        n.position.x < other.position.x + other.data.width &&
        n.position.x + n.data.width > other.position.x &&
        n.position.y < other.position.y + other.data.height &&
        n.position.y + n.data.height > other.position.y;
      assert.equal(overlap, false, `${n.id} overlaps ${other.id}`);
    }
    if (n.id !== '@start')
      assert.ok(
        edges.some((e) => e.target === n.id),
        `unreachable ${n.id}`,
      );
    if (n.id !== '@end')
      assert.ok(
        edges.some((e) => e.source === n.id),
        `dead end ${n.id}`,
      );
  }
  const ids = new Set(nodes.map((n) => n.id));
  assert.equal(ids.size, nodes.length);
  assert.ok(edges.every((e) => ids.has(e.source) && ids.has(e.target)));
  assert.equal(edges.filter((e) => e.target === 'repeat' && e.data?.returning).length, 1);
  assert.equal(
    edges.find((e) => e.source === 'repeat' && e.sourceHandle === 'done')?.target,
    '@join:repeat',
  );
});

test('drawn branch and loop paths match actual sequential execution, including zero iterations', async () => {
  for (const actual of [true, false])
    for (const items of [[], [1, 2]]) {
      const steps = [
        value('input'),
        condition(
          'choose',
          [loop('each', [condition('inside', [value('yes')], [value('no')], actual)], items)],
          [value('otherwise')],
          actual,
        ),
        value('after'),
      ];
      const { nodes, edges } = buildDiagram(steps);
      const drawn: string[] = [];
      const counts = new Map<string, number>();
      let at = '@start';
      for (let guard = 0; guard < 100; guard++) {
        if (at === '@end') break;
        const step = nodes.find((n) => n.id === at)!.data.step;
        let handle = 'out';
        if (step?.type === 'condition') handle = step.actual ? 'yes' : 'no';
        else if (step?.type === 'loop') {
          const count = counts.get(at) ?? 0;
          handle = count < (step.items as number[]).length ? 'out' : 'done';
          counts.set(at, count + 1);
        } else if (step) drawn.push(step.id);
        const edge = edges.find((e) => e.source === at && e.sourceHandle === handle);
        assert.ok(edge, `missing ${at}.${handle}`);
        at = edge.target;
      }
      assert.equal(at, '@end');
      const executed: string[] = [];
      const flow: Flow = {
        id: 'test',
        name: '虚构图形回归',
        formatVersion: '1.0',
        description: '',
        parameters: {},
        requiredCapabilities: [],
        steps,
      };
      await execute(
        flow,
        {},
        {
          signal: new AbortController().signal,
          boundary: async () => {},
          human: async () => true,
          perform: async () => null,
          emit: async (type, instance, data) => {
            if (type === 'node-start' && !['condition', 'loop'].includes(data.type))
              executed.push(instance.split('/').at(-1)!);
          },
        },
      );
      assert.deepEqual(drawn, executed);
    }
});
