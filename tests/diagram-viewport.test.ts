import test from 'node:test';
import assert from 'node:assert/strict';
import type { Rect, Viewport } from '@xyflow/react';
import type { Step } from '../src/shared/types';
import { buildDiagram } from '../src/renderer/flow-diagram';
import { diagramGeometry, diagramViewport, nodeBounds } from '../src/renderer/diagram-viewport';

const value = (id: string): Step => ({ id, type: 'value', version: 1, value: id });
const loop = (id: string, body: Step[]): Step => ({
  id,
  type: 'loop',
  version: 1,
  items: [1, 2],
  body,
});
const condition = (id: string, yes: Step[], no: Step[]): Step => ({
  id,
  type: 'condition',
  version: 1,
  actual: true,
  expected: true,
  operator: 'equals',
  then: yes,
  else: no,
});

function contains(viewport: Viewport, bounds: Rect, width: number, height: number) {
  const left = bounds.x * viewport.zoom + viewport.x;
  const top = bounds.y * viewport.zoom + viewport.y;
  const right = (bounds.x + bounds.width) * viewport.zoom + viewport.x;
  const bottom = (bounds.y + bounds.height) * viewport.zoom + viewport.y;
  assert.ok(left >= -0.001 && right <= width + 0.001, `horizontal clipping: ${left}..${right}`);
  assert.ok(top >= -0.001 && bottom <= height + 0.001, `vertical clipping: ${top}..${bottom}`);
}

test('full view keeps the start and end inside a narrow canvas as flow length grows', () => {
  let previousZoom = Infinity;
  for (const count of [80, 800, 8000]) {
    const { nodes, edges } = buildDiagram(Array.from({ length: count }, (_, i) => value(`v${i}`)));
    const { bounds } = diagramGeometry(nodes, edges);
    const viewport = diagramViewport(bounds, 279, 400)!;
    assert.ok(viewport.zoom > 0 && viewport.zoom < previousZoom / 2);
    assert.ok(viewport.zoom < 0.15);
    previousZoom = viewport.zoom;
    assert.equal(nodes[0].id, '@start');
    assert.equal(nodes.at(-1)!.id, '@end');
    for (const node of nodes) contains(viewport, nodeBounds(node), 279, 400);
    contains(viewport, bounds!, 279, 400);
  }
});

test('nested branches, empty paths, loop return edges and their labels fit together', () => {
  const steps = [
    loop('outer', [
      condition(
        'choose',
        [loop('left', [value('inside')])],
        [condition('right', [], [loop('empty', [])])],
      ),
    ]),
    value('after'),
  ];
  const { nodes, edges } = buildDiagram(steps);
  assert.ok(nodes.some((node) => node.data.shape === 'empty'));
  assert.ok(nodes.some((node) => node.data.shape === 'join'));
  const { bounds } = diagramGeometry(nodes, edges);
  const routes = edges.filter((edge) => edge.data?.routeX !== undefined);
  const nodeRight = Math.max(...nodes.map((node) => node.position.x + node.data.width));
  assert.ok(routes.some((edge) => edge.data!.routeX! > nodeRight));
  for (const [width, height] of [
    [279, 400],
    [900, 600],
  ]) {
    const viewport = diagramViewport(bounds, width, height)!;
    for (const node of nodes) contains(viewport, nodeBounds(node), width, height);
    for (const edge of routes) {
      const source = nodes.find((node) => node.id === edge.source)!;
      const target = nodes.find((node) => node.id === edge.target)!;
      const sourceY = edge.data!.returning
        ? source.position.y + source.data.height + 24
        : source.position.y + source.data.height / 2;
      const targetY = target.position.y + target.data.height / 2;
      const labelWidth = String(edge.label).length * 11 + 14;
      contains(
        viewport,
        {
          x: edge.data!.routeX! - labelWidth / 2,
          y: Math.min(sourceY, targetY) - 12,
          width: labelWidth,
          height: Math.abs(sourceY - targetY) + 24,
        },
        width,
        height,
      );
    }
  }
});

test('projection identity ignores selection and literal edits but follows dimensions and routes', () => {
  const steps = [loop('repeat', [value('entry')])];
  const before = buildDiagram(steps);
  const original = diagramGeometry(before.nodes, before.edges).layoutKey;
  const edited = structuredClone(steps);
  if (edited[0].type !== 'loop' || edited[0].body[0].type !== 'value')
    throw new Error('bad fixture');
  edited[0].body[0].value = 'unsaved input';
  edited[0].body[0].name = 'new name';
  const after = buildDiagram(edited, 'entry');
  assert.equal(diagramGeometry(after.nodes, after.edges).layoutKey, original);
  after.nodes[0].data.width += 1;
  assert.notEqual(diagramGeometry(after.nodes, after.edges).layoutKey, original);
  const rerouted = structuredClone(before.edges);
  rerouted.find((edge) => edge.data?.routeX !== undefined)!.data!.routeX! += 1;
  assert.notEqual(diagramGeometry(before.nodes, rerouted).layoutKey, original);
  const appended = buildDiagram([...steps, value('new')]);
  assert.notEqual(diagramGeometry(appended.nodes, appended.edges).layoutKey, original);
});

test('focusing a selected step restores a readable scale and waits for a visible canvas', () => {
  const { nodes, edges } = buildDiagram(Array.from({ length: 200 }, (_, i) => value(`v${i}`)));
  const { bounds } = diagramGeometry(nodes, edges);
  assert.equal(diagramViewport(bounds, 0, 400), null);
  assert.equal(diagramViewport(bounds, 279, 0), null);
  assert.equal(diagramViewport(null, 279, 400), null);
  const selected = nodes.find((node) => node.id === 'v199')!;
  for (const width of [279, 656]) {
    const full = diagramViewport(bounds, width, 400)!;
    const focused = diagramViewport(nodeBounds(selected), width, 400)!;
    assert.ok(focused.zoom > 0.75 && focused.zoom <= 1);
    assert.ok(focused.zoom > full.zoom * 50);
    contains(focused, nodeBounds(selected), width, 400);
  }
});
