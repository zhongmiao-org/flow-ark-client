import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { Step } from '../shared/types';

export type FlowShape =
  | 'process'
  | 'data'
  | 'subprocess'
  | 'document'
  | 'workbook'
  | 'decision'
  | 'manual'
  | 'loop'
  | 'terminal'
  | 'join'
  | 'empty';
export type DiagramData = {
  shape: FlowShape;
  width: number;
  height: number;
  step?: Step;
  label?: string;
};
export type DiagramNode = Node<DiagramData, 'semantic'>;
export type DiagramEdge = Edge<{ routeX?: number; returning?: boolean }>;
type Pin = { id: string; handle: string };
const GAP = 64;
const LANE_GAP = 96;

export function shapeOf(step: Step): FlowShape {
  switch (step.type) {
    case 'condition':
      return 'decision';
    case 'loop':
      return 'loop';
    case 'value':
      return 'data';
    case 'human':
      return 'manual';
    case 'script':
    case 'recruiting':
      return 'subprocess';
    case 'file':
      return 'document';
    case 'excel':
      return 'workbook';
    default:
      return 'process';
  }
}
export function dimensions(shape: FlowShape) {
  if (shape === 'decision') return { width: 280, height: 168 };
  if (shape === 'terminal' || shape === 'empty') return { width: 120, height: 40 };
  if (shape === 'join') return { width: 12, height: 12 };
  return { width: 280, height: shape === 'workbook' ? 112 : shape === 'document' ? 104 : 96 };
}

/** Projection only. Synthetic IDs cannot be valid persisted node IDs. */
export function buildDiagram(steps: Step[], selected = '') {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const widths = new Map<Step[], number>();
  function blockWidth(block: Step[]): number {
    if (widths.has(block)) return widths.get(block)!;
    const value = Math.max(
      280,
      ...block.map((n) =>
        n.type === 'condition'
          ? blockWidth(n.then) + LANE_GAP + blockWidth(n.else)
          : n.type === 'loop'
            ? blockWidth(n.body) + 200
            : 280,
      ),
    );
    widths.set(block, value);
    return value;
  }
  function add(id: string, shape: FlowShape, x: number, y: number, step?: Step, label?: string) {
    const size = dimensions(shape);
    nodes.push({
      id,
      type: 'semantic',
      position: { x: x - size.width / 2, y },
      data: { shape, ...size, step, label },
      ...size,
      selected: id === selected,
      selectable: Boolean(step),
      focusable: Boolean(step),
      draggable: false,
      deletable: false,
      ariaLabel: step
        ? `${step.type} ${typeof step.name === 'string' ? step.name : step.id}`
        : label,
    });
    return { id, handle: 'out' };
  }
  function connect(
    from: Pin,
    to: Pin,
    label?: string,
    route?: { routeX: number; returning?: boolean },
  ) {
    edges.push({
      id: `@edge:${edges.length}`,
      source: from.id,
      sourceHandle: from.handle,
      target: to.id,
      targetHandle: to.handle,
      label,
      type: route ? 'routed' : 'smoothstep',
      data: route,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      style: { stroke: route?.returning ? '#a37b40' : '#8fa69e', strokeWidth: 1.5 },
      labelStyle: { fill: '#50655b', fontSize: 11, fontWeight: 500 },
      labelBgStyle: { fill: '#f5f8f6' },
      labelBgPadding: [7, 4],
      labelBgBorderRadius: 4,
      selectable: false,
      focusable: false,
      deletable: false,
    });
  }
  function block(list: Step[], x: number, top: number, previous: Pin, label?: string) {
    let y = top;
    let exit = previous;
    for (const n of list) {
      const shape = shapeOf(n);
      const start = add(n.id, shape, x, y, n);
      connect(exit, { id: n.id, handle: 'in' }, label);
      label = undefined;
      y += dimensions(shape).height + GAP;
      exit = start;
      if (n.type === 'condition') {
        const leftWidth = blockWidth(n.then),
          rightWidth = blockWidth(n.else);
        const span = leftWidth + rightWidth + LANE_GAP;
        const branch = (children: Step[], cx: number, side: 'yes' | 'no', text: string) => {
          const from = { id: n.id, handle: side };
          if (children.length) return block(children, cx, y, from, text);
          const empty = add(`@empty:${n.id}:${side}`, 'empty', cx, y, undefined, '直接汇合');
          connect(from, { id: empty.id, handle: 'in' }, text);
          return { exit: empty, bottom: y + 40 };
        };
        const left = branch(n.then, x - span / 2 + leftWidth / 2, 'yes', '成立');
        const right = branch(n.else, x + span / 2 - rightWidth / 2, 'no', '否则');
        const joinY = Math.max(left.bottom, right.bottom) + GAP;
        exit = add(`@join:${n.id}`, 'join', x, joinY, undefined, '条件汇合');
        connect(left.exit, { id: exit.id, handle: 'left-in' });
        connect(right.exit, { id: exit.id, handle: 'right-in' });
        y = joinY + 12 + GAP;
      } else if (n.type === 'loop') {
        const bodyWidth = blockWidth(n.body);
        const bodyX = x - 20;
        let body: { exit: Pin; bottom: number };
        if (n.body.length) body = block(n.body, bodyX, y, start, '逐项');
        else {
          const empty = add(`@empty:${n.id}:body`, 'empty', bodyX, y, undefined, '空循环体');
          connect(start, { id: empty.id, handle: 'in' }, '逐项');
          body = { exit: empty, bottom: y + 40 };
        }
        connect(body.exit, { id: n.id, handle: 'return' }, '下一项', {
          routeX: bodyX - bodyWidth / 2 - 60,
          returning: true,
        });
        const joinY = body.bottom + GAP;
        exit = add(`@join:${n.id}`, 'join', x, joinY, undefined, '循环完成');
        connect({ id: n.id, handle: 'done' }, { id: exit.id, handle: 'right-in' }, '完成', {
          routeX: x + (bodyWidth + 200) / 2 - 20,
        });
        y = joinY + 12 + GAP;
      }
    }
    return { exit, bottom: y - GAP };
  }
  const center = blockWidth(steps) / 2 + 60;
  const start = add('@start', 'terminal', center, 24, undefined, '开始');
  const result = block(steps, center, 24 + 40 + GAP, start);
  const end = add('@end', 'terminal', center, result.bottom + GAP, undefined, '结束');
  connect(result.exit, { id: end.id, handle: 'in' });
  return { nodes, edges, stepCount: nodes.filter((n) => n.data.step).length };
}
