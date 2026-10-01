import { getViewportForBounds, type Rect } from '@xyflow/react';
import type { DiagramEdge, DiagramNode } from './flow-diagram';

// Current edges have a 24-unit return bend, a 20-unit smoothstep offset,
// 16-unit markers and route labels up to 47 units wide. Include their ink,
// not just the fixed node rectangles, when fitting the whole projection.
const edgeMargin = 32;

export function nodeBounds(node: DiagramNode): Rect {
  return { ...node.position, width: node.data.width, height: node.data.height };
}

export function diagramGeometry(nodes: DiagramNode[], edges: DiagramEdge[]) {
  const layoutKey = JSON.stringify([
    nodes.map((node) => [
      node.id,
      node.position.x,
      node.position.y,
      node.data.width,
      node.data.height,
    ]),
    edges.map((edge) => [
      edge.id,
      edge.source,
      edge.sourceHandle,
      edge.target,
      edge.targetHandle,
      edge.type,
      edge.data?.routeX,
      edge.data?.returning,
      edge.data?.labelX,
      edge.data?.labelY,
    ]),
  ]);
  if (!nodes.length) return { layoutKey, bounds: null };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of nodes) {
    const bounds = nodeBounds(node);
    left = Math.min(left, bounds.x);
    top = Math.min(top, bounds.y);
    right = Math.max(right, bounds.x + bounds.width);
    bottom = Math.max(bottom, bounds.y + bounds.height);
  }
  for (const edge of edges) {
    const labelX = edge.data?.labelX;
    if (labelX !== undefined) {
      left = Math.min(left, labelX);
      right = Math.max(right, labelX);
    }
    const x = edge.data?.routeX;
    if (x !== undefined) {
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  return {
    layoutKey,
    bounds: {
      x: left - edgeMargin,
      y: top - edgeMargin,
      width: right - left + edgeMargin * 2,
      height: bottom - top + edgeMargin * 2,
    },
  };
}

export function diagramViewport(
  bounds: Rect | null,
  width: number,
  height: number,
  task = false,
  centerX?: number,
) {
  if (!bounds || width <= 0 || height <= 0 || bounds.width <= 0 || bounds.height <= 0) return null;
  if (task) {
    // Keep short task plans at design size, centered on the start node and
    // 16 px from the top. Clamp the center so asymmetric branches still fit.
    const zoom = Math.min(
      1,
      Math.max(1, width - 32) / bounds.width,
      Math.max(1, height - 32) / bounds.height,
    );
    const centered = (width - bounds.width * zoom) / 2 - bounds.x * zoom;
    const x =
      centerX === undefined
        ? centered
        : Math.max(
            16 - bounds.x * zoom,
            Math.min(width - 16 - (bounds.x + bounds.width) * zoom, width / 2 - centerX * zoom),
          );
    return {
      x,
      y: 16 - (bounds.y + edgeMargin) * zoom,
      zoom,
    };
  }
  // Zero disables a fixed lower clamp only during this calculation. The
  // positive result becomes the canvas's actual lower zoom limit.
  return getViewportForBounds(bounds, width, height, 0, 1, 0.2);
}
