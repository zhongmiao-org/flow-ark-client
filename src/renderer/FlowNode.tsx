import { memo, useEffect, useRef, type CSSProperties } from 'react';
import {
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  useReactFlow,
  useStore,
  type NodeProps,
  type EdgeProps,
} from '@xyflow/react';
import type { DiagramNode, DiagramEdge, FlowShape } from './flow-diagram';
import { kinds } from './node-kinds';

function Shape({
  shape,
  width: w,
  height: h,
}: {
  shape: FlowShape;
  width: number;
  height: number;
}) {
  const box = (
    <rect
      x="2"
      y="2"
      width={w - 4}
      height={h - 4}
      rx={shape === 'terminal' || shape === 'empty' ? h / 2 : 3}
    />
  );
  if (shape === 'decision')
    return <path d={`M ${w / 2} 2 L ${w - 2} ${h / 2} L ${w / 2} ${h - 2} L 2 ${h / 2} Z`} />;
  if (shape === 'data') return <path d={`M 28 2 H ${w - 2} L ${w - 28} ${h - 2} H 2 Z`} />;
  if (shape === 'manual') return <path d={`M 2 2 H ${w - 2} L ${w - 28} ${h - 2} H 28 Z`} />;
  if (shape === 'loop')
    return (
      <path d={`M 28 2 H ${w - 28} L ${w - 2} ${h / 2} L ${w - 28} ${h - 2} H 28 L 2 ${h / 2} Z`} />
    );
  if (shape === 'subprocess')
    return (
      <>
        {box}
        <path className="shape-detail" d={`M 16 2 V ${h - 2} M ${w - 16} 2 V ${h - 2}`} />
      </>
    );
  if (shape === 'document' || shape === 'workbook') {
    const inset = shape === 'workbook' ? 12 : 0;
    return (
      <>
        {inset > 0 && (
          <>
            <path d={`M 14 2 H ${w - 2} V ${h - 26} H 14 Z`} />
            <path d={`M 8 8 H ${w - 8} V ${h - 20} H 8 Z`} />
          </>
        )}
        <path
          d={`M 2 ${2 + inset} H ${w - 2 - inset} V ${h - 16} C ${(w - inset) * 0.75} ${h - 34}, ${(w - inset) * 0.25} ${h + 2}, 2 ${h - 16} Z`}
        />
      </>
    );
  }
  if (shape === 'join') return <circle cx={w / 2} cy={h / 2} r="4" />;
  return box;
}

const FlowNode = memo(function FlowNode({ data, selected }: NodeProps<DiagramNode>) {
  const { shape, width, height, step, label } = data;
  const kind = step && kinds[step.type];
  const Icon = kind?.icon;
  const port = (id: string, type: 'source' | 'target', position: Position) => (
    <Handle
      key={id}
      id={id}
      type={type}
      position={position}
      isConnectable={false}
      style={
        id === 'out' && (shape === 'document' || shape === 'workbook')
          ? { bottom: 16, left: (width - (shape === 'workbook' ? 12 : 0)) / 2 }
          : undefined
      }
    />
  );
  return (
    <div
      className={`flow-shape flow-shape--${shape}${selected ? ' is-selected' : ''}`}
      style={{ width, height, '--node-accent': kind?.color ?? '#44745e' } as CSSProperties}
      data-shape={shape}
      data-step-id={step?.id}
    >
      <svg className="flow-shape-outline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <Shape shape={shape} width={width} height={height} />
      </svg>
      {step && kind && Icon ? (
        <div className="flow-shape-content">
          <span className="flow-node-icon">
            <Icon size={18} strokeWidth={1.8} />
          </span>
          <div className="flow-node-text">
            <small>{kind.label}</small>
            <b title={typeof step.name === 'string' ? step.name : step.id}>
              {typeof step.name === 'string' && step.name
                ? step.name
                : step.type === 'browser'
                  ? {
                      navigate: '打开网页',
                      click: '点击元素',
                      fill: '填写内容',
                      read: '读取文字',
                      wait: '等待元素',
                      upload: '上传文件',
                      download: '下载文件',
                      screenshot: '页面截图',
                      select: '选择选项',
                      check: '设置勾选',
                      inputValue: '读取输入值',
                      press: '按下按键',
                    }[step.operation]
                  : step.id}
            </b>
          </div>
          <span className="flow-node-version">v{step.version}</span>
        </div>
      ) : (
        shape !== 'join' && <span className="flow-auxiliary-label">{label}</span>
      )}
      {port('in', 'target', Position.Top)}
      {shape === 'decision' ? (
        <>
          {port('yes', 'source', Position.Left)}
          {port('no', 'source', Position.Right)}
        </>
      ) : (
        <>
          {port('out', 'source', Position.Bottom)}
          {shape === 'loop' && (
            <>
              {port('return', 'target', Position.Left)}
              {port('done', 'source', Position.Right)}
            </>
          )}
        </>
      )}
      {shape === 'join' && (
        <>
          {port('left-in', 'target', Position.Left)}
          {port('right-in', 'target', Position.Right)}
        </>
      )}
    </div>
  );
});

function RoutedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
  data,
  label,
}: EdgeProps<DiagramEdge>) {
  const x = data?.routeX ?? sourceX;
  const sy = data?.returning ? sourceY + 24 : sourceY;
  const d = `M ${sourceX} ${sourceY} L ${sourceX} ${sy} L ${x} ${sy} L ${x} ${targetY} L ${targetX} ${targetY}`;
  return (
    <>
      <BaseEdge id={id} path={d} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <span
          className="flow-route-label"
          style={{ transform: `translate(-50%, -50%) translate(${x}px, ${(sy + targetY) / 2}px)` }}
        >
          {label}
        </span>
      </EdgeLabelRenderer>
    </>
  );
}
export const flowNodeTypes = { semantic: FlowNode };
export const flowEdgeTypes = { routed: RoutedEdge };
export function FitDiagram({ layoutKey, selected }: { layoutKey: string; selected: string }) {
  // Projection nodes already declare their sizes; only the viewport must be ready.
  const { fitView, viewportInitialized: ready } = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const previous = useRef<{ layoutKey: string; width: number; height: number } | null>(null);
  useEffect(() => {
    if (!ready || !width || !height) return;
    const before = previous.current;
    if (before?.layoutKey === layoutKey && before.width === width && before.height === height)
      return;
    const frame = requestAnimationFrame(() => {
      previous.current = { layoutKey, width, height };
      // A panel resize keeps the edited step in view, including in long flows.
      // Selection or parameter edits alone must not undo a user's pan or zoom.
      void fitView({
        padding: 0.2,
        minZoom: 0.15,
        maxZoom: 1,
        nodes: before?.layoutKey === layoutKey && selected ? [{ id: selected }] : undefined,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, layoutKey, selected, width, height, fitView]);
  return null;
}
