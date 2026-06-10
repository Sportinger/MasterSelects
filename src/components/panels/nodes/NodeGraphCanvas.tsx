import { useCallback, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, WheelEvent } from 'react';
import type {
  NodeGraph,
  NodeGraphConnectionRequest,
  NodeGraphLayout,
  NodeGraphNode,
  NodeGraphPort,
} from '../../../services/nodeGraph';
import { NodeGraphEdges } from './canvas/NodeGraphEdges';
import { NodeGraphNodeCard } from './canvas/NodeGraphNodeCard';
import type { ConnectionDraft, NodeGraphPoint, PortReference, Viewport } from './canvas/canvasGeometry';
import {
  clamp,
  DEFAULT_VIEWPORT,
  FIT_MARGIN,
  getGraphBounds,
  getPortCenter,
  MAX_ZOOM,
  MIN_ZOOM,
} from './canvas/canvasGeometry';

interface NodeGraphCanvasProps {
  graph: NodeGraph;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onMoveNode?: (nodeId: string, layout: NodeGraphLayout) => void;
  onConnectPorts?: (connection: NodeGraphConnectionRequest) => void;
  onDisconnectEdge?: (edgeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onToggleNodeBypass?: (nodeId: string) => void;
  onOpenAddMenu?: (position: { x: number; y: number; layout: NodeGraphLayout; nodeId?: string | null }) => void;
}

interface PanGesture {
  pointerId: number;
  clientX: number;
  clientY: number;
  panX: number;
  panY: number;
}

interface NodeDragGesture {
  pointerId: number;
  nodeId: string;
  clientX: number;
  clientY: number;
  startX: number;
  startY: number;
}

export function NodeGraphCanvas({
  graph,
  selectedNodeId,
  onSelectNode,
  onMoveNode,
  onConnectPorts,
  onDisconnectEdge,
  onDeleteNode,
  onToggleNodeBypass,
  onOpenAddMenu,
}: NodeGraphCanvasProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const panGestureRef = useRef<PanGesture | null>(null);
  const nodeDragGestureRef = useRef<NodeDragGesture | null>(null);
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [isPanning, setIsPanning] = useState(false);
  const [draftLayouts, setDraftLayouts] = useState<Record<string, NodeGraphLayout>>({});
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const displayNodes = useMemo(() => (
    graph.nodes.map((node) => (
      draftLayouts[node.id]
        ? { ...node, layout: draftLayouts[node.id] }
        : node
    ))
  ), [draftLayouts, graph.nodes]);
  const nodesById = useMemo(() => new Map(displayNodes.map((node) => [node.id, node])), [displayNodes]);
  const graphBounds = useMemo(() => getGraphBounds({ ...graph, nodes: displayNodes }), [displayNodes, graph]);
  const selectedEdge = useMemo(() => (
    selectedEdgeId ? graph.edges.find((edge) => edge.id === selectedEdgeId) ?? null : null
  ), [graph.edges, selectedEdgeId]);

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

  const getGraphPointFromClient = useCallback((clientX: number, clientY: number): NodeGraphPoint => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }

    return {
      x: (clientX - rect.left - viewport.panX) / viewport.zoom,
      y: (clientY - rect.top - viewport.panY) / viewport.zoom,
    };
  }, [viewport.panX, viewport.panY, viewport.zoom]);

  const getPortReferenceFromElement = useCallback((element: Element | null): PortReference | null => {
    const portElement = element?.closest('.node-workspace-port') as HTMLElement | null;
    if (!portElement) {
      return null;
    }

    const nodeId = portElement.dataset.nodeId;
    const portId = portElement.dataset.portId;
    const direction = portElement.dataset.direction;
    if (!nodeId || !portId || (direction !== 'input' && direction !== 'output')) {
      return null;
    }

    const node = nodesById.get(nodeId);
    const port = (direction === 'input' ? node?.inputs : node?.outputs)?.find((candidate) => candidate.id === portId);
    if (!port) {
      return null;
    }

    return {
      nodeId,
      portId,
      direction,
      type: port.type,
    };
  }, [nodesById]);

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
    if (event.button !== 0) {
      return;
    }

    const target = event.target as Element;
    if (
      target.closest('.node-workspace-node') ||
      target.closest('.node-workspace-edge-hit')
    ) {
      return;
    }

    setSelectedEdgeId(null);
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
    if (connectionDraft?.pointerId === event.pointerId) {
      const end = getGraphPointFromClient(event.clientX, event.clientY);
      setConnectionDraft((current) => (
        current && current.pointerId === event.pointerId
          ? { ...current, end }
          : current
      ));
      return;
    }

    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    setViewport((current) => ({
      ...current,
      panX: gesture.panX + (event.clientX - gesture.clientX),
      panY: gesture.panY + (event.clientY - gesture.clientY),
    }));
  }, [connectionDraft?.pointerId, getGraphPointFromClient]);

  const finishPanGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    panGestureRef.current = null;
    setIsPanning(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const finishConnectionDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>): boolean => {
    const draft = connectionDraft;
    if (!draft || draft.pointerId !== event.pointerId) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();

    const portReference = typeof document === 'undefined'
      ? null
      : getPortReferenceFromElement(document.elementFromPoint(event.clientX, event.clientY));

    if (
      portReference &&
      portReference.nodeId !== draft.nodeId &&
      portReference.direction !== draft.direction &&
      portReference.type === draft.type
    ) {
      const connection = draft.direction === 'output'
        ? {
            fromNodeId: draft.nodeId,
            fromPortId: draft.portId,
            toNodeId: portReference.nodeId,
            toPortId: portReference.portId,
          }
        : {
            fromNodeId: portReference.nodeId,
            fromPortId: portReference.portId,
            toNodeId: draft.nodeId,
            toPortId: draft.portId,
          };
      onConnectPorts?.(connection);
    }

    setConnectionDraft(null);
    if (canvasRef.current?.hasPointerCapture(event.pointerId)) {
      canvasRef.current.releasePointerCapture(event.pointerId);
    }
    return true;
  }, [connectionDraft, getPortReferenceFromElement, onConnectPorts]);

  const cancelConnectionDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>): boolean => {
    if (!connectionDraft || connectionDraft.pointerId !== event.pointerId) {
      return false;
    }

    setConnectionDraft(null);
    if (canvasRef.current?.hasPointerCapture(event.pointerId)) {
      canvasRef.current.releasePointerCapture(event.pointerId);
    }
    return true;
  }, [connectionDraft]);

  const startNodeDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, node: NodeGraphNode) => {
    event.stopPropagation();
    onSelectNode(node.id);
    if (event.button !== 0) {
      return;
    }

    nodeDragGestureRef.current = {
      pointerId: event.pointerId,
      nodeId: node.id,
      clientX: event.clientX,
      clientY: event.clientY,
      startX: node.layout.x,
      startY: node.layout.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [onSelectNode]);

  const handleNodePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = nodeDragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const nextLayout = {
      x: Math.round(gesture.startX + ((event.clientX - gesture.clientX) / viewport.zoom)),
      y: Math.round(gesture.startY + ((event.clientY - gesture.clientY) / viewport.zoom)),
    };
    setDraftLayouts((current) => ({
      ...current,
      [gesture.nodeId]: nextLayout,
    }));
  }, [viewport.zoom]);

  const finishNodeDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = nodeDragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const finalLayout = draftLayouts[gesture.nodeId];
    if (finalLayout) {
      onMoveNode?.(gesture.nodeId, finalLayout);
    }
    nodeDragGestureRef.current = null;
    setDraftLayouts((current) => {
      const next = { ...current };
      delete next[gesture.nodeId];
      return next;
    });
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, [draftLayouts, onMoveNode]);

  const startConnectionDrag = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
    node: NodeGraphNode,
    port: NodeGraphPort,
  ) => {
    if (!onConnectPorts || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    setConnectionDraft({
      pointerId: event.pointerId,
      nodeId: node.id,
      portId: port.id,
      direction: port.direction,
      type: port.type,
      start: getPortCenter(node, port.id, port.direction),
      end: getGraphPointFromClient(event.clientX, event.clientY),
    });
    canvasRef.current?.setPointerCapture(event.pointerId);
  }, [getGraphPointFromClient, onConnectPorts]);

  const disconnectPortEdges = useCallback((node: NodeGraphNode, port: NodeGraphPort) => {
    if (!onDisconnectEdge) {
      return;
    }

    for (const edge of graph.edges) {
      const matchesPort = port.direction === 'output'
        ? edge.fromNodeId === node.id && edge.fromPortId === port.id
        : edge.toNodeId === node.id && edge.toPortId === port.id;
      if (matchesPort) {
        onDisconnectEdge(edge.id);
      }
    }
  }, [graph.edges, onDisconnectEdge]);

  const disconnectSelectedEdge = useCallback(() => {
    if (!selectedEdge || !onDisconnectEdge) return;
    onDisconnectEdge(selectedEdge.id);
    setSelectedEdgeId(null);
  }, [onDisconnectEdge, selectedEdge]);

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNodeId || !onDeleteNode) return;
    onDeleteNode(selectedNodeId);
  }, [onDeleteNode, selectedNodeId]);

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
          {selectedEdge && (
            <button type="button" className="node-workspace-toolbar-button" onClick={disconnectSelectedEdge}>
              Disconnect
            </button>
          )}
          <button type="button" className="node-workspace-toolbar-button" onClick={fitGraph}>Fit</button>
          <button type="button" className="node-workspace-toolbar-button" onClick={resetView}>Reset</button>
          <span className="node-workspace-zoom">{Math.round(viewport.zoom * 100)}%</span>
        </div>
      </div>

      <div
        ref={canvasRef}
        className="node-workspace-canvas"
        tabIndex={0}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => {
          if (!finishConnectionDrag(event)) {
            finishPanGesture(event);
          }
        }}
        onPointerCancel={(event) => {
          if (!cancelConnectionDrag(event)) {
            finishPanGesture(event);
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Delete' && event.key !== 'Backspace') {
            return;
          }

          if (selectedEdge) {
            event.preventDefault();
            disconnectSelectedEdge();
            return;
          }

          if (selectedNodeId) {
            event.preventDefault();
            deleteSelectedNode();
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          if ((event.target as Element).closest('.node-workspace-port, .node-workspace-edge-hit')) {
            return;
          }
          const targetNode = (event.target as Element).closest('.node-workspace-node') as HTMLElement | null;
          const targetNodeId = targetNode?.dataset.nodeId ?? null;
          if (targetNodeId) {
            onSelectNode(targetNodeId);
            setSelectedEdgeId(null);
          }
          const rect = canvasRef.current?.getBoundingClientRect();
          const layout = rect
            ? {
                x: Math.round((event.clientX - rect.left - viewport.panX) / viewport.zoom),
                y: Math.round((event.clientY - rect.top - viewport.panY) / viewport.zoom),
              }
            : { x: 0, y: 0 };
          onOpenAddMenu?.({ x: event.clientX, y: event.clientY, layout, nodeId: targetNodeId });
        }}
      >
        <div
          className="node-workspace-canvas-inner"
          style={{
            transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
          }}
        >
          <NodeGraphEdges
            graphBounds={graphBounds}
            edges={graph.edges}
            nodesById={nodesById}
            selectedEdgeId={selectedEdgeId}
            connectionDraft={connectionDraft}
            onSelectEdge={setSelectedEdgeId}
            onClearSelectedEdge={() => setSelectedEdgeId(null)}
            onDisconnectEdge={onDisconnectEdge}
          />

          {displayNodes.map((node) => (
            <NodeGraphNodeCard
              key={node.id}
              node={node}
              selectedNodeId={selectedNodeId}
              connectionDraft={connectionDraft}
              onSelectNode={onSelectNode}
              onStartNodeDrag={startNodeDrag}
              onNodePointerMove={handleNodePointerMove}
              onFinishNodeDrag={finishNodeDrag}
              onStartConnectionDrag={startConnectionDrag}
              onDisconnectPortEdges={disconnectPortEdges}
              onToggleNodeBypass={onToggleNodeBypass}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
