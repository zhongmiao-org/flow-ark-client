import type { FlowShape } from './flow-diagram';

const artwork = {
  process: new URL('./assets/task-graph/process.svg?no-inline', import.meta.url).href,
  decision: new URL('./assets/task-graph/decision.svg?no-inline', import.meta.url).href,
  document: new URL('./assets/task-graph/document.svg?no-inline', import.meta.url).href,
  join: new URL('./assets/task-graph/join.svg?no-inline', import.meta.url).href,
};

export function hasTaskArtwork(shape: FlowShape) {
  return shape === 'terminal' || Object.hasOwn(artwork, shape);
}

export default function TaskDiagramShape({ shape }: { shape: FlowShape }) {
  return (
    <div className={`task-node-art task-node-art--${shape}`} aria-hidden="true">
      {shape !== 'terminal' && <img src={artwork[shape as keyof typeof artwork]} alt="" />}
    </div>
  );
}
