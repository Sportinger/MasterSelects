import { useCallback, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, WheelEvent } from 'react';
import type { NodeGraph, NodeGraphEdge, NodeGraphNode, NodeGraphPort } from '../../../services/nodeGraph';

const DEFAULT_VIEWPORT = { zoom: 0.88, panX: 36, panY: 28 };
const MIN_ZOOM = 0.18;
const MAX_ZOOM = 2.4;
const NODE_WIDTH = 184;
const NODE_MIN_HEIGHT = 126;
const PORT_ROW_HEIGHT = 18;
const PORT_START_Y = 78;
const FIT_MARGIN = 42;

interface NodeGraphCanvasProps {
  graph: NodeGraph;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}

interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

interface PanGesture {
  pointerId: number;
  clientX: number;
  clientY: number;
  panX: number;
  panY: number;
}

interface NodeBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getNodeHeight(node: NodeGraphNode): number {
  const portRows = Math.max(node.inputs.length, node.outputs.length, 1);
  return Math.max(NODE_MIN_HEIGHT, PORT_START_Y + (portRows * PORT_ROW_HEIGHT) + 16);
}

function getGraphBounds(graph: NodeGraph): NodeBounds {
  if (graph.nodes.length === 0) {
    return { left: 0, top: 0, right: 400, bottom: 260 };
  }

  return graph.nodes.reduce<NodeBounds>((bounds, node) => {
    const nodeHeight = getNodeHeight(node);
    return {
      left: Math.min(bounds.left, node.layout.x),
      top: Math.min(bounds.top, node.layout.y),
      right: Math.max(bounds.right, node.layout.x + NODE_WIDTH),
      bottom: Math.max(bounds.bottom, node.layout.y + nodeHeight),
    };
  }, {
    left: graph.nodes[0].layout.x,
    top: graph.nodes[0].layout.y,
    right: graph.nodes[0].layout.x + NODE_WIDTH,
    bottom: graph.nodes[0].layout.y + getNodeHeight(graph.nodes[0]),
  });
}

function getPortCenter(node: NodeGraphNode, portId: string, direction: 'input' | 'output'): { x: number; y: number } {
  const ports = direction === 'input' ? node.inputs : node.outputs;
  const portIndex = Math.max(0, ports.findIndex((port) => port.id === portId));
  return {
    x: node.layout.x + (direction === 'input' ? 0 : NODE_WIDTH),
    y: node.layout.y + PORT_START_Y + (portIndex * PORT_ROW_HEIGHT) + 6,
  };
}

function getEdgePath(edge: NodeGraphEdge, nodesById: Map<string, NodeGraphNode>): string | null {
  const fromNode = nodesById.get(edge.fromNodeId);
  const toNode = nodesById.get(edge.toNodeId);
  if (!fromNode || !toNode) return null;

  const from = getPortCenter(fromNode, edge.fromPortId, 'output');
  const to = getPortCenter(toNode, edge.toPortId, 'input');
  const handle = Math.max(72, Math.abs(to.x - from.x) * 0.42);
  return `M ${from.x} ${from.y} C ${from.x + handle} ${from.y}, ${to.x - handle} ${to.y}, ${to.x} ${to.y}`;
}

function getPortTitle(port: NodeGraphPort): string {
  return `${port.label} (${port.type})`;
}

function renderPort(port: NodeGraphPort) {
  return (
    <div key={port.id} className={`node-workspace-port node-workspace-port-${port.direction}`} title={getPortTitle(port)}>
      <span className="node-workspace-port-dot" />
      <span className="node-workspace-port-label">{port.label}</span>
    </div>
  );
}

export function NodeGraphCanvas({ graph, selectedNodeId, onSelectNode }: NodeGraphCanvasProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const panGestureRef = useRef<PanGesture | null>(null);
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [isPanning, setIsPanning] = useState(false);

  const nodesById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const graphBounds = useMemo(() => getGraphBounds(graph), [graph]);

  const gridStyle = useMemo(() => ({
    '--node-workspace-grid-x': `${viewport.panX % 32}px`,
    '--node-workspace-grid-y': `${viewport.panY % 32}px`,
  }) as CSSProperties, [viewport.panX, viewport.panY]);

  const fitGraph = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = Math.max(1, canvas.clientWidth - (FIT_MARGIN * 2));
    const height = Math.max(1, canvas.clientHeight - (FIT_MARGIN * 2));
    const boundsWidth = Math.max(1, graphBounds.right - graphBounds.left);
    const boundsHeight = Math.max(1, graphBounds.bottom - graphBounds.top);
    const nextZoom = clamp(Math.min(width / boundsWidth, height / boundsHeight), MIN_ZOOM, MAX_ZOOM);
    setViewport({
      zoom: nextZoom,
      panX: FIT_MARGIN - (graphBounds.left * nextZoom),
      panY: FIT_MARGIN - (graphBounds.top * nextZoom),
    });
  }, [graphBounds]);

  const resetView = useCallback(() => {
    setViewport(DEFAULT_VIEWPORT);
  }, []);

  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const boardX = (pointerX - viewport.panX) / viewport.zoom;
    const boardY = (pointerY - viewport.panY) / viewport.zoom;
    const direction = event.deltaY > 0 ? -1 : 1;
    const zoomFactor = direction > 0 ? 1.08 : 1 / 1.08;
    const nextZoom = clamp(viewport.zoom * zoomFactor, MIN_ZOOM, MAX_ZOOM);

    setViewport({
      zoom: nextZoom,
      panX: pointerX - (boardX * nextZoom),
      panY: pointerY - (boardY * nextZoom),
    });
  }, [viewport]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('.node-workspace-node')) return;

    panGestureRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      panX: viewport.panX,
      panY: viewport.panY,
    };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [viewport.panX, viewport.panY]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    setViewport((current) => ({
      ...current,
      panX: gesture.panX + (event.clientX - gesture.clientX),
      panY: gesture.panY + (event.clientY - gesture.clientY),
    }));
  }, []);

  const finishPanGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    panGestureRef.current = null;
    setIsPanning(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  return (
    <div
      className={`node-workspace-board${isPanning ? ' board-interacting' : ''}`}
      style={gridStyle}
    >
      <div className="node-workspace-toolbar">
        <div className="node-workspace-toolbar-title">
          <span>{graph.owner.name}</span>
          <span>{graph.nodes.length} nodes / {graph.edges.length} links</span>
        </div>
        <div className="node-workspace-toolbar-actions">
          <button type="button" className="node-workspace-toolbar-button" onClick={fitGraph}>Fit</button>
          <button type="button" className="node-workspace-toolbar-button" onClick={resetView}>Reset</button>
          <span className="node-workspace-zoom">{Math.round(viewport.zoom * 100)}%</span>
        </div>
      </div>

      <div
        ref={canvasRef}
        className="node-workspace-canvas"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPanGesture}
        onPointerCancel={finishPanGesture}
      >
        <div
          className="node-workspace-canvas-inner"
          style={{
            transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
          }}
        >
          <svg
            className="node-workspace-edges"
            style={{
              left: graphBounds.left - 96,
              top: graphBounds.top - 96,
              width: graphBounds.right - graphBounds.left + 192,
              height: graphBounds.bottom - graphBounds.top + 192,
            }}
            viewBox={`${graphBounds.left - 96} ${graphBounds.top - 96} ${graphBounds.right - graphBounds.left + 192} ${graphBounds.bottom - graphBounds.top + 192}`}
            aria-hidden="true"
          >
            {graph.edges.map((edge) => {
              const path = getEdgePath(edge, nodesById);
              if (!path) return null;
              return (
                <path
                  key={edge.id}
                  className={`node-workspace-edge node-workspace-edge-${edge.type}`}
                  d={path}
                />
              );
            })}
          </svg>

          {graph.nodes.map((node) => {
            const nodeHeight = getNodeHeight(node);
            const isSelected = node.id === selectedNodeId;
            return (
              <div
                key={node.id}
                role="button"
                tabIndex={0}
                className={`node-workspace-node node-workspace-node-${node.kind}${isSelected ? ' selected' : ''}`}
                style={{
                  left: node.layout.x,
                  top: node.layout.y,
                  width: NODE_WIDTH,
                  height: nodeHeight,
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectNode(node.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectNode(node.id);
                  }
                }}
              >
                <div className="node-workspace-node-header">
                  <span>{node.kind}</span>
                  <span>{node.runtime}</span>
                </div>
                <div className="node-workspace-node-title" title={node.label}>{node.label}</div>
                <div className="node-workspace-node-description" title={node.description}>
                  {node.description ?? 'Built-in processing node'}
                </div>
                <div className="node-workspace-node-ports">
                  <div className="node-workspace-port-column">
                    {node.inputs.map(renderPort)}
                  </div>
                  <div className="node-workspace-port-column node-workspace-port-column-output">
                    {node.outputs.map(renderPort)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
