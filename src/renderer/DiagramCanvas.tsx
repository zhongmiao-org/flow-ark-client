import { useEffect, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
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
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  selected: string;
  select: (id: string) => void;
};

function Canvas({ nodes, edges, selected, select }: Props) {
  const { setViewport, viewportInitialized: ready } = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const { bounds, layoutKey } = diagramGeometry(nodes, edges);
  const fullViewport = diagramViewport(bounds, width, height);
  const selectedNode = nodes.find((node) => node.id === selected && node.data.step);
  const focusedViewport = diagramViewport(
    selectedNode ? nodeBounds(selectedNode) : null,
    width,
    height,
  );
  const previous = useRef<{ layoutKey: string; width: number; height: number } | null>(null);

  useEffect(() => {
    if (!ready || !fullViewport) return;
    const before = previous.current;
    if (before?.layoutKey === layoutKey && before.width === width && before.height === height)
      return;
    const frame = requestAnimationFrame(() => {
      previous.current = { layoutKey, width, height };
      // Resize keeps the edited step readable. Structural changes show the
      // complete new projection; selection and parameter edits keep manual pan/zoom.
      void setViewport(
        before?.layoutKey === layoutKey && focusedViewport ? focusedViewport : fullViewport,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, layoutKey, width, height, fullViewport, focusedViewport, setViewport]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={flowNodeTypes}
      edgeTypes={flowEdgeTypes}
      deleteKeyCode={null}
      onNodeClick={(_event, node) => {
        if (node.data.step) select(node.id);
      }}
      nodesConnectable={false}
      minZoom={fullViewport ? Math.min(0.15, fullViewport.zoom) : 0.15}
      elementsSelectable
    >
      <Background gap={22} color="#d7e0de" />
      <Controls showInteractive={false} showFitView={false}>
        <ControlButton
          className="react-flow__controls-fitview"
          aria-label="Fit View"
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
