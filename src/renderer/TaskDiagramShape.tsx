import type { FlowShape } from './flow-diagram';
import processArtwork from './assets/task-graph/process.svg?raw';
import decisionArtwork from './assets/task-graph/decision.svg?raw';
import documentArtwork from './assets/task-graph/document.svg?raw';
import joinArtwork from './assets/task-graph/join.svg?raw';

const artwork = {
  process: processArtwork,
  decision: decisionArtwork,
  document: documentArtwork,
  join: joinArtwork,
};

export function hasTaskArtwork(shape: FlowShape) {
  return shape === 'terminal' || Object.hasOwn(artwork, shape);
}

export default function TaskDiagramShape({ shape }: { shape: FlowShape }) {
  return (
    <div className={`task-node-art task-node-art--${shape}`} aria-hidden="true">
      {shape !== 'terminal' && (
        // Only bundled, static artwork enters this slot. Inline SVG inherits the
        // workspace's semantic colours; external image documents cannot do so.
        <span
          className="task-node-svg"
          dangerouslySetInnerHTML={{ __html: artwork[shape as keyof typeof artwork] }}
        />
      )}
    </div>
  );
}
