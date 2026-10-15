import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { Step } from '../shared/types';
import { kinds } from './node-kinds';

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
  task?: { ordinal: number; title: string; summary: string };
  presentation?: 'editor' | 'task' | 'control';
};
export type DiagramNode = Node<DiagramData, 'semantic'>;
export type DiagramEdge = Edge<{
  routeX?: number;
  returning?: boolean;
  labelY?: number;
  labelX?: number;
}>;
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
      return 'subprocess';
    case 'skill':
    case 'document':
    case 'file':
      return 'document';
    case 'excel':
      return 'workbook';
    default:
      return 'process';
  }
}
export function dimensions(
  shape: FlowShape,
  presentation: 'editor' | 'task' | 'control' = 'editor',
) {
  if (presentation === 'control') {
    if (shape === 'data' || shape === 'subprocess') return { width: 260, height: 64 };
    if (shape === 'loop' || shape === 'manual') return { width: 260, height: 72 };
  }
  if (presentation !== 'editor') {
    if (shape === 'decision') return { width: 220, height: 100 };
    if (shape === 'terminal' || shape === 'empty') return { width: 88, height: 30 };
    if (shape === 'join') return { width: 8, height: 8 };
    if (shape === 'document') return { width: 240, height: 78 };
    // Shapes without a task-board design retain the semantic editor geometry.
    if (shape === 'process') return { width: 260, height: 64 };
  }
  if (shape === 'decision') return { width: 280, height: 168 };
  if (shape === 'terminal' || shape === 'empty') return { width: 120, height: 40 };
  if (shape === 'join') return { width: 12, height: 12 };
  return { width: 280, height: shape === 'workbook' ? 112 : shape === 'document' ? 104 : 96 };
}

/** Projection only. Synthetic IDs cannot be valid persisted node IDs. */
export function buildDiagram(
  steps: Step[],
  selected = '',
  presentation: 'editor' | 'task' | 'control' = 'editor',
) {
  const task = presentation !== 'editor';
  // Figma 23:7158 uses compact task geometry; editor projection stays unchanged.
  const gap = task ? 26 : GAP;
  const laneGap = task ? 20 : LANE_GAP;
  const baseWidth = task ? 260 : 280;
  const sizeOf = (shape: FlowShape) => dimensions(shape, presentation);
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const widths = new Map<Step[], number>();
  function blockWidth(block: Step[]): number {
    if (widths.has(block)) return widths.get(block)!;
    const value = Math.max(
      baseWidth,
      ...block.map((n) =>
        n.type === 'condition'
          ? blockWidth(n.then) + laneGap + blockWidth(n.else)
          : n.type === 'loop'
            ? blockWidth(n.body) + 200
            : sizeOf(shapeOf(n)).width,
      ),
    );
    widths.set(block, value);
    return value;
  }
  function add(id: string, shape: FlowShape, x: number, y: number, step?: Step, label?: string) {
    const size = sizeOf(shape);
    nodes.push({
      id,
      type: 'semantic',
      position: { x: x - size.width / 2, y },
      data: { shape, ...size, step, label, presentation },
      ...size,
      selected: id === selected,
      selectable: Boolean(step),
      focusable: Boolean(step),
      draggable: false,
      deletable: false,
      ariaLabel: step
        ? `${kinds[step.type]?.label ?? step.type} · ${typeof step.name === 'string' ? step.name : step.id}`
        : label,
      ariaRole: step ? 'button' : undefined,
      domAttributes: step ? { 'aria-pressed': id === selected } : undefined,
    });
    return { id, handle: 'out' };
  }
  function connect(
    from: Pin,
    to: Pin,
    label?: string,
    route?: { routeX: number; returning?: boolean; labelY?: number; labelX?: number },
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
      markerEnd: task
        ? undefined
        : {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: route?.returning ? 'var(--fa-status-warning)' : 'var(--fa-border-default)',
          },
      style: {
        stroke:
          route?.returning && presentation !== 'control'
            ? 'var(--fa-status-warning)'
            : 'var(--fa-border-default)',
        strokeWidth: 1.5,
      },
      labelStyle: {
        fill:
          label === '成立'
            ? 'var(--fa-status-success)'
            : presentation === 'control' && route?.returning
              ? 'var(--fa-action-primary)'
              : 'var(--fa-text-secondary)',
        fontSize: task ? 12 : 11,
        fontWeight: task ? 400 : 500,
      },
      labelBgStyle: { fill: 'var(--fa-bg-canvas)' },
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
      connect(
        exit,
        { id: n.id, handle: 'in' },
        label,
        task && label && ['yes', 'no'].includes(exit.handle)
          ? { routeX: x, labelY: y - 40, labelX: x + (label === '成立' ? -43 : 2) }
          : undefined,
      );
      label = undefined;
      y += sizeOf(shape).height + (task && n.type === 'condition' ? 44 : gap);
      exit = start;
      if (n.type === 'condition') {
        const leftWidth = blockWidth(n.then),
          rightWidth = blockWidth(n.else);
        const span = leftWidth + rightWidth + laneGap;
        const branch = (
          children: Step[],
          cx: number,
          side: 'yes' | 'no',
          text: string,
        ): {
          exit: Pin;
          bottom: number;
          routeX?: number;
          label?: string;
          labelY?: number;
          labelX?: number;
        } => {
          const from = { id: n.id, handle: side };
          if (children.length) return block(children, cx, y, from, text);
          if (task)
            return {
              exit: from,
              bottom: y,
              routeX: cx,
              label: text,
              labelY: y - 40,
              labelX: cx + (text === '成立' ? -43 : 2),
            };
          const empty = add(`@empty:${n.id}:${side}`, 'empty', cx, y, undefined, '直接汇合');
          connect(from, { id: empty.id, handle: 'in' }, text);
          return { exit: empty, bottom: y + 40 };
        };
        const left = branch(n.then, x - span / 2 + leftWidth / 2, 'yes', '成立');
        const right = branch(n.else, x + span / 2 - rightWidth / 2, 'no', '否则');
        const joinY = Math.max(left.bottom, right.bottom) + (task ? 36 : gap);
        exit = add(`@join:${n.id}`, 'join', x, joinY, undefined, '条件汇合');
        connect(
          left.exit,
          { id: exit.id, handle: 'left-in' },
          left.label,
          left.routeX !== undefined
            ? { routeX: left.routeX, labelY: left.labelY, labelX: left.labelX }
            : undefined,
        );
        connect(
          right.exit,
          { id: exit.id, handle: 'right-in' },
          right.label,
          right.routeX !== undefined
            ? { routeX: right.routeX, labelY: right.labelY, labelX: right.labelX }
            : undefined,
        );
        y = joinY + sizeOf('join').height + (task ? 34 : gap);
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
        const joinY = body.bottom + gap;
        exit = add(`@join:${n.id}`, 'join', x, joinY, undefined, '循环完成');
        connect({ id: n.id, handle: 'done' }, { id: exit.id, handle: 'right-in' }, '完成', {
          routeX: x + (bodyWidth + 200) / 2 - 20,
        });
        y = joinY + sizeOf('join').height + gap;
      }
    }
    return { exit, bottom: y - gap, next: y };
  }
  const center = blockWidth(steps) / 2 + 60;
  const top = task ? 16 : 24;
  const start = add('@start', 'terminal', center, top, undefined, '开始');
  const result = block(steps, center, top + sizeOf('terminal').height + (task ? 24 : gap), start);
  const end = add('@end', 'terminal', center, result.next, undefined, '结束');
  connect(result.exit, { id: end.id, handle: 'in' });
  return { nodes, edges, stepCount: nodes.filter((n) => n.data.step).length };
}
