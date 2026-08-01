import {
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export interface ProjectedMotionPathPoint {
  x: number;
  y: number;
  time: number;
}

export interface ProjectedMotionPathNode extends ProjectedMotionPathPoint {
  id: string;
  selected?: boolean;
}

export interface ProjectedMotionPathHandle extends ProjectedMotionPathPoint {
  id: string;
  nodeId: string;
  direction: 'in' | 'out';
  nodeX: number;
  nodeY: number;
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
  handles?: readonly ProjectedMotionPathHandle[];
  onionPositions?: readonly ProjectedMotionPathOnionPoint[];
  activeNodeId?: string | null;
  activeHandleId?: string | null;
  onNodePointerDown: (
    event: ReactPointerEvent<SVGCircleElement>,
    node: ProjectedMotionPathNode,
  ) => void;
  onHandlePointerDown?: (
    event: ReactPointerEvent<SVGCircleElement>,
    handle: ProjectedMotionPathHandle,
  ) => void;
  onHandleKeyDown?: (
    event: ReactKeyboardEvent<SVGCircleElement>,
    handle: ProjectedMotionPathHandle,
  ) => void;
  onHandleBlur?: (
    event: ReactFocusEvent<SVGCircleElement>,
    handle: ProjectedMotionPathHandle,
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
  handles = [],
  onionPositions = [],
  activeNodeId = null,
  activeHandleId = null,
  onNodePointerDown,
  onHandlePointerDown,
  onHandleKeyDown,
  onHandleBlur,
}: MotionPathOverlayProps) {
  const [focusedHandleId, setFocusedHandleId] = useState<string | null>(null);
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

      {handles.map((handle) => {
        const active = handle.id === activeHandleId;
        const focused = handle.id === focusedHandleId;
        return (
          <g key={handle.id}>
            <line
              aria-hidden="true"
              x1={handle.nodeX}
              y1={handle.nodeY}
              x2={handle.x}
              y2={handle.y}
              stroke="rgba(255, 255, 255, 0.75)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              aria-label={`${handle.direction === 'in' ? 'Incoming' : 'Outgoing'} position curve handle at ${handle.time.toFixed(3)} seconds`}
              aria-pressed={active}
              data-motion-path-handle-id={handle.id}
              data-motion-path-handle-hit-target="true"
              cx={handle.x}
              cy={handle.y}
              r={12}
              fill="transparent"
              stroke={focused ? '#ffffff' : 'transparent'}
              strokeWidth={focused ? 2 : 0}
              strokeDasharray={focused ? '3 2' : undefined}
              vectorEffect="non-scaling-stroke"
              role="button"
              tabIndex={0}
              focusable="true"
              style={{ cursor: active ? 'grabbing' : 'grab', pointerEvents: 'all' }}
              onPointerDown={(event) => onHandlePointerDown?.(event, handle)}
              onKeyDown={(event) => onHandleKeyDown?.(event, handle)}
              onFocus={() => setFocusedHandleId(handle.id)}
              onBlur={(event) => {
                setFocusedHandleId((current) => current === handle.id ? null : current);
                onHandleBlur?.(event, handle);
              }}
            />
            <circle
              aria-hidden="true"
              data-motion-path-handle-visual="true"
              cx={handle.x}
              cy={handle.y}
              r={active ? 5 : 4}
              fill={active ? '#ffffff' : '#171717'}
              stroke="#2997e5"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: 'none' }}
            />
          </g>
        );
      })}

      {nodes.map((node) => {
        const active = node.id === activeNodeId;
        const highlighted = active || node.selected;
        return (
          <circle
            aria-label={`Position keyframe at ${node.time.toFixed(3)} seconds`}
            data-motion-path-node-id={node.id}
            key={node.id}
            cx={node.x}
            cy={node.y}
            r={highlighted ? 6 : 5}
            fill={highlighted ? '#ffffff' : '#2997e5'}
            stroke={highlighted ? '#2997e5' : '#ffffff'}
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
