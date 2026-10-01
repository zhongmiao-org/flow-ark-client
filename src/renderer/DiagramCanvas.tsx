import { useEffect, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  ControlButton,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import { Focus, Maximize } from 'lucide-react';
import { flowNodeTypes, flowEdgeTypes } from './FlowNode';
import type { DiagramEdge, DiagramNode } from './flow-diagram';
import { diagramGeometry, diagramViewport, nodeBounds } from './diagram-viewport';

type Props = {
  active?: boolean;
  focusRequest?: number;
  taskPresentation?: boolean;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  selected: string;
  select: (id: string, source?: 'keyboard') => void;
};

function Canvas({
  nodes,
  edges,
  selected,
  select,
  active = true,
  focusRequest,
  taskPresentation = false,
}: Props) {
  const { setViewport, viewportInitialized: ready } = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const { bounds, layoutKey } = diagramGeometry(nodes, edges);
  const startNode = nodes.find((node) => node.id === '@start');
  const fullViewport = diagramViewport(
    bounds,
    width,
    height,
    taskPresentation,
    startNode ? startNode.position.x + startNode.data.width / 2 : undefined,
  );
  const selectedNode = nodes.find((node) => node.id === selected && node.data.step);
  const focusedViewport = diagramViewport(
    selectedNode ? nodeBounds(selectedNode) : null,
    width,
    height,
  );
  const previous = useRef<{ layoutKey: string; width: number; height: number } | null>(null);
  const focusedRequest = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!active || !ready || !fullViewport) return;
    const requested = focusRequest !== undefined && focusRequest !== focusedRequest.current;
    const before = previous.current;
    if (
      !requested &&
      before?.layoutKey === layoutKey &&
      before.width === width &&
      before.height === height
    )
      return;
    const frame = requestAnimationFrame(() => {
      previous.current = { layoutKey, width, height };
      focusedRequest.current = focusRequest;
      // Resize keeps the edited step readable. Structural changes show the
      // complete new projection; selection and parameter edits keep manual pan/zoom.
      void setViewport(
        (requested || before?.layoutKey === layoutKey) && selectedNode && focusedViewport
          ? focusedViewport
          : fullViewport,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [
    active,
    focusRequest,
    ready,
    layoutKey,
    width,
    height,
    fullViewport,
    focusedViewport,
    selectedNode,
    setViewport,
  ]);

  return (
    <ReactFlow
      style={{ background: 'var(--fa-bg-canvas)' }}
      ariaLabelConfig={{
        'node.a11yDescription.default': '按 Enter 或空格查看此步骤，按 Tab 浏览下一步骤。',
        'node.a11yDescription.keyboardDisabled': '流程步骤。',
        'controls.ariaLabel': '流程图视图控制',
        'controls.zoomIn.ariaLabel': '放大流程图',
        'controls.zoomOut.ariaLabel': '缩小流程图',
      }}
      nodes={nodes}
      edges={edges}
      nodeTypes={flowNodeTypes}
      edgeTypes={flowEdgeTypes}
      deleteKeyCode={null}
      panActivationKeyCode={active ? 'Space' : null}
      selectionKeyCode={active ? 'Shift' : null}
      multiSelectionKeyCode={active ? ['Meta', 'Control'] : null}
      zoomActivationKeyCode={active ? ['Meta', 'Control'] : null}
      disableKeyboardA11y={!active}
      onKeyDownCapture={(event) => {
        if (!active || (event.key !== 'Enter' && event.key !== ' ')) return;
        // Handle only the focused node wrapper, never a field or control inside it.
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.matches('.react-flow__node')) return;
        const node = nodes.find((item) => item.id === target.dataset.id && item.data.step);
        if (!node) return;
        event.preventDefault();
        event.stopPropagation();
        select(node.id, 'keyboard');
      }}
      onNodeClick={(_event, node) => {
        if (active && node.data.step) select(node.id);
      }}
      nodesConnectable={false}
      minZoom={fullViewport ? Math.min(0.15, fullViewport.zoom) : 0.15}
      elementsSelectable
    >
      <Controls showInteractive={false} showFitView={false}>
        <ControlButton
          className="react-flow__controls-fitview"
          aria-label="显示完整流程"
          title="显示完整流程"
          disabled={!ready || !fullViewport}
          onClick={() => {
            if (fullViewport) void setViewport(fullViewport);
          }}
        >
          <Maximize />
        </ControlButton>
        <ControlButton
          aria-label="聚焦所选步骤"
          title="聚焦所选步骤"
          disabled={!ready || !focusedViewport}
          onClick={() => {
            if (focusedViewport) void setViewport(focusedViewport);
          }}
        >
          <Focus />
        </ControlButton>
      </Controls>
    </ReactFlow>
  );
}

export default function DiagramCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
