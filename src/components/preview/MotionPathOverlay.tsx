import type { PointerEvent as ReactPointerEvent } from 'react';

export interface ProjectedMotionPathPoint {
  x: number;
  y: number;
  time: number;
}

export interface ProjectedMotionPathNode extends ProjectedMotionPathPoint {
  id: string;
}

export interface ProjectedMotionPathOnionPoint extends ProjectedMotionPathPoint {
  direction: 'previous' | 'next';
  frameOffset: number;
}

export interface MotionPathOverlayProps {
  width: number;
  height: number;
  visible: boolean;
  samples: readonly ProjectedMotionPathPoint[];
  nodes: readonly ProjectedMotionPathNode[];
  onionPositions?: readonly ProjectedMotionPathOnionPoint[];
  activeNodeId?: string | null;
  onNodePointerDown: (
    event: ReactPointerEvent<SVGCircleElement>,
    node: ProjectedMotionPathNode,
  ) => void;
}

function buildPath(points: readonly ProjectedMotionPathPoint[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
}

export function MotionPathOverlay({
  width,
  height,
  visible,
  samples,
  nodes,
  onionPositions = [],
  activeNodeId = null,
  onNodePointerDown,
}: MotionPathOverlayProps) {
  if (!visible || width <= 0 || height <= 0 || nodes.length === 0) return null;

  const path = buildPath(samples);
  return (
    <svg
      aria-label="Motion path overlay"
      data-motion-path-overlay="true"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width,
        height,
        transform: 'translate(-50%, -50%)',
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: 15,
      }}
    >
      {path && (
        <path
          aria-hidden="true"
          d={path}
          fill="none"
          stroke="rgba(41, 151, 229, 0.9)"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {onionPositions.map((position) => (
        <circle
          aria-hidden="true"
          key={`${position.direction}:${position.time}`}
          cx={position.x}
          cy={position.y}
          r={4}
          fill={position.direction === 'previous' ? '#5dd8ff' : '#ffad4d'}
          fillOpacity={0.5}
          stroke="rgba(0, 0, 0, 0.65)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {nodes.map((node) => {
        const active = node.id === activeNodeId;
        return (
          <circle
            aria-label={`Position keyframe at ${node.time.toFixed(3)} seconds`}
            data-motion-path-node-id={node.id}
            key={node.id}
            cx={node.x}
            cy={node.y}
            r={active ? 6 : 5}
            fill={active ? '#ffffff' : '#2997e5'}
            stroke={active ? '#2997e5' : '#ffffff'}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: active ? 'grabbing' : 'grab', pointerEvents: 'all' }}
            onPointerDown={(event) => onNodePointerDown(event, node)}
          />
        );
      })}
    </svg>
  );
}
