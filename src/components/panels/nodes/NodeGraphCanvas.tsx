import { NodeGraphGroups } from './canvas/NodeGraphGroups';
import { annotatedGraphBounds, nodeGroupBounds } from './canvas/groupBounds';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { NodeGraphPoint, Viewport } from './canvas/canvasGeometry';
import { useNodeConnectionDrag } from './canvas/useNodeConnectionDrag';
import { getConnectionPlugs } from './canvas/connectionPlugs';
import { NodeGraphPlugs } from './canvas/NodeGraphPlugs';
import { useNodePortHover } from './canvas/useNodePortHover';
import {
  clamp,
  DEFAULT_VIEWPORT,
  FIT_MARGIN,
  getGraphBounds,
  MAX_ZOOM,
  MIN_ZOOM,
} from './canvas/canvasGeometry';

export interface NodeGraphMove {
  nodeId: string;
  layout: NodeGraphLayout;
}

interface NodeGraphCanvasProps {
  graph: NodeGraph;
  selectedNodeId: string | null;
  /** Additional multi-selection (domains that support group operations). */
  selectedNodeIds?: readonly string[];
  onSelectNode: (nodeId: string) => void;
  onToggleNodeSelection?: (nodeId: string) => void;
  onMoveNode?: (nodeId: string, layout: NodeGraphLayout) => void;
  onMoveNodes?: (moves: NodeGraphMove[]) => void;
  onConnectPorts?: (connection: NodeGraphConnectionRequest) => void;
  onDisconnectEdge?: (edgeId: string) => void;
  onReconnectPorts?: (edgeId: string, connection: NodeGraphConnectionRequest) => void;
  onDeleteNode?: (nodeId: string) => void;
  onDeleteNodes?: (nodeIds: string[]) => void;
  onDuplicateSelection?: () => void;
  onGroupSelection?: () => void;
  onToggleNodeBypass?: (nodeId: string) => void;
  onOpenAddMenu?: (position: { x: number; y: number; layout: NodeGraphLayout; nodeId?: string | null }) => void;
  onToggleGroup?: (id: string) => void;
  layoutScaleX?: number;
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
  members: Array<{ nodeId: string; startX: number; startY: number }>;
  moved: boolean;
}

export function NodeGraphCanvas({
  graph,
  selectedNodeId,
  selectedNodeIds,
  onSelectNode,
  onToggleNodeSelection,
  onMoveNode,
  onMoveNodes,
  onConnectPorts,
  onDisconnectEdge,
  onReconnectPorts,
  onDeleteNode,
  onDeleteNodes,
  onDuplicateSelection,
  onGroupSelection,
  onToggleNodeBypass,
  onOpenAddMenu,
  onToggleGroup,
  layoutScaleX = 1,
}: NodeGraphCanvasProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const panGestureRef = useRef<PanGesture | null>(null);
  const nodeDragGestureRef = useRef<NodeDragGesture | null>(null);
  const suppressNextClickRef = useRef(false);
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [isPanning, setIsPanning] = useState(false);
  const [draftLayouts, setDraftLayouts] = useState<Record<string, NodeGraphLayout>>({});
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const multiSelection = useMemo(() => new Set(selectedNodeIds ?? []), [selectedNodeIds]);

  const displayNodes = useMemo(() => (
    graph.nodes.map((node) => ({
      ...node,
      layout: draftLayouts[node.id] ?? {
        x: node.layout.x * layoutScaleX,
        y: node.layout.y,
      },
    }))
  ), [draftLayouts, graph.nodes, layoutScaleX]);
  const nodesById = useMemo(() => new Map(displayNodes.map((node) => [node.id, node])), [displayNodes]);
  const plugs = useMemo(() => getConnectionPlugs(graph.edges, nodesById), [graph.edges, nodesById]);
  const { hoveredPort, hoveredEdgeId, portHoverEvents } = useNodePortHover(nodesById);
  const graphBounds = useMemo(() => {
    const bounds = annotatedGraphBounds(graph, displayNodes);
    for (const { tip } of plugs) {
      bounds.left = Math.min(bounds.left, tip.x - 10);
      bounds.right = Math.max(bounds.right, tip.x + 10);
    }
    return bounds;
  }, [displayNodes, graph, plugs]);
  const selectedEdge = useMemo(() => (
    selectedEdgeId ? graph.edges.find((edge) => edge.id === selectedEdgeId) ?? null : null
  ), [graph.edges, selectedEdgeId]);

  const gridStyle = useMemo(() => ({
    '--node-workspace-grid-x': `${viewport.panX % 32}px`,
    '--node-workspace-grid-y': `${viewport.panY % 32}px`,
  }) as CSSProperties, [viewport.panX, viewport.panY]);

  const fitBounds = useCallback((bounds: typeof graphBounds) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = Math.max(1, canvas.clientWidth - (FIT_MARGIN * 2));
    const height = Math.max(1, canvas.clientHeight - (FIT_MARGIN * 2));
    const boundsWidth = Math.max(1, bounds.right - bounds.left);
    const boundsHeight = Math.max(1, bounds.bottom - bounds.top);
    const nextZoom = clamp(Math.min(width / boundsWidth, height / boundsHeight), MIN_ZOOM, MAX_ZOOM);
    setViewport({
      zoom: nextZoom,
      panX: FIT_MARGIN - (bounds.left * nextZoom),
      panY: FIT_MARGIN - (bounds.top * nextZoom),
    });
  }, []);
  const fitGraph = useCallback(() => fitBounds(graphBounds), [fitBounds, graphBounds]);
  const focusGroup = (id: string) => {
    const members = new Set(graph.groups?.find(g => g.id === id)?.nodeIds);
    fitBounds(nodeGroupBounds(graph, displayNodes).get(id) ?? getGraphBounds({ ...graph, nodes: displayNodes.filter(n => members.has(n.id)) }));
  };

  const fittedGraph = useRef<string | null>(null);
  useEffect(() => {
    if (fittedGraph.current !== graph.id) { fittedGraph.current = graph.id; fitGraph(); }
  }, [graph.id, fitGraph]);

  const knownNodes = useRef(new Set(graph.nodes.map(node => node.id)));
  useEffect(() => {
    const selected = graph.nodes.find(node => node.id === selectedNodeId);
    if (selected?.binding?.kind === 'keyframe-node' && !knownNodes.current.has(selected.id)) fitGraph();
    knownNodes.current = new Set(graph.nodes.map(node => node.id));
  }, [graph.nodes, selectedNodeId, fitGraph]);

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

  const { connectionDraft, startConnectionDrag, startPlugDrag, moveConnectionDrag, finishConnectionDrag, cancelConnectionDrag } = useNodeConnectionDrag({
    graphId: graph.id, canvasRef, nodesById, getGraphPoint: getGraphPointFromClient,
    onConnectPorts, onReconnectPorts, onDisconnectEdge,
  });

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
    if (moveConnectionDrag(event)) return;

    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    setViewport((current) => ({
      ...current,
      panX: gesture.panX + (event.clientX - gesture.clientX),
      panY: gesture.panY + (event.clientY - gesture.clientY),
    }));
  }, [moveConnectionDrag]);

  const finishPanGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    panGestureRef.current = null;
    setIsPanning(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const startNodeDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, node: NodeGraphNode) => {
    event.stopPropagation();
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (additive && onToggleNodeSelection && event.button === 0) {
      onToggleNodeSelection(node.id);
      suppressNextClickRef.current = true;
      return;
    }

    const dragsSelection = multiSelection.size > 1 && multiSelection.has(node.id);
    if (!dragsSelection) {
      onSelectNode(node.id);
    }
    if (event.button !== 0) {
      return;
    }

    const memberIds = dragsSelection ? [...multiSelection] : [node.id];
    nodeDragGestureRef.current = {
      pointerId: event.pointerId,
      nodeId: node.id,
      clientX: event.clientX,
      clientY: event.clientY,
      members: memberIds.flatMap((memberId) => {
        const member = nodesById.get(memberId);
        return member ? [{ nodeId: memberId, startX: member.layout.x, startY: member.layout.y }] : [];
      }),
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [multiSelection, nodesById, onSelectNode, onToggleNodeSelection]);

  const handleNodePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = nodeDragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const deltaX = (event.clientX - gesture.clientX) / viewport.zoom;
    const deltaY = (event.clientY - gesture.clientY) / viewport.zoom;
    if (!gesture.moved && Math.hypot(deltaX, deltaY) < 2) return;
    gesture.moved = true;
    setDraftLayouts((current) => {
      const next = { ...current };
      for (const member of gesture.members) {
        next[member.nodeId] = {
          x: Math.round(member.startX + deltaX),
          y: Math.round(member.startY + deltaY),
        };
      }
      return next;
    });
  }, [viewport.zoom]);

  const finishNodeDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = nodeDragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const moves = gesture.moved
      ? gesture.members.flatMap((member) => {
          const finalLayout = draftLayouts[member.nodeId];
          return finalLayout
            ? [{ nodeId: member.nodeId, layout: { x: Math.round(finalLayout.x / layoutScaleX), y: finalLayout.y } }]
            : [];
        })
      : [];
    if (moves.length > 1 && onMoveNodes) {
      onMoveNodes(moves);
    } else {
      for (const move of moves) onMoveNode?.(move.nodeId, move.layout);
    }
    if (gesture.moved && gesture.members.length > 1) {
      suppressNextClickRef.current = true;
    }
    nodeDragGestureRef.current = null;
    setDraftLayouts((current) => {
      const next = { ...current };
      for (const member of gesture.members) delete next[member.nodeId];
      return next;
    });
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, [draftLayouts, layoutScaleX, onMoveNode, onMoveNodes]);

  const handleNodeClick = useCallback((nodeId: string) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    onSelectNode(nodeId);
  }, [onSelectNode]);

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
    if (multiSelection.size > 1 && onDeleteNodes) {
      onDeleteNodes([...multiSelection]);
      return;
    }
    if (!selectedNodeId || !onDeleteNode) return;
    onDeleteNode(selectedNodeId);
  }, [multiSelection, onDeleteNode, onDeleteNodes, selectedNodeId]);

  return (
    <div
      className={`node-workspace-board${isPanning ? ' board-interacting' : ''}`}
      style={gridStyle}
    >
      <div className="node-workspace-toolbar">
        <div className="node-workspace-toolbar-title">
          <span>{graph.owner.name}</span>
          <span>
            {graph.nodes.length} nodes / {graph.edges.length} links
            {multiSelection.size > 1 ? ` / ${multiSelection.size} selected` : ''}
          </span>
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
        {...portHoverEvents}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => {
          if (!finishConnectionDrag(event)) {
            finishPanGesture(event);
          }
        }}
        onLostPointerCapture={cancelConnectionDrag}
        onPointerCancel={(event) => {
          if (!cancelConnectionDrag(event)) {
            finishPanGesture(event);
          }
        }}
        onKeyDown={(event) => {
          const modifier = event.ctrlKey || event.metaKey;
          if (modifier && (event.key === 'd' || event.key === 'D') && onDuplicateSelection) {
            event.preventDefault();
            onDuplicateSelection();
            return;
          }
          if (modifier && (event.key === 'g' || event.key === 'G') && onGroupSelection) {
            event.preventDefault();
            onGroupSelection();
            return;
          }
          if (event.key !== 'Delete' && event.key !== 'Backspace') {
            return;
          }

          if (selectedEdge) {
            event.preventDefault();
            disconnectSelectedEdge();
            return;
          }

          if (selectedNodeId || multiSelection.size > 0) {
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
          if (targetNodeId && !multiSelection.has(targetNodeId)) {
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
          <NodeGraphGroups graph={graph} nodes={displayNodes} onToggle={id => { fittedGraph.current = null; onToggleGroup?.(id); }} onFocus={focusGroup} />
          <NodeGraphEdges
            graphBounds={graphBounds}
            edges={graph.edges}
            plugs={plugs}
            nodesById={nodesById}
            selectedEdgeId={selectedEdgeId}
            hoveredEdgeId={hoveredEdgeId}
            connectionDraft={connectionDraft}
            onSelectEdge={setSelectedEdgeId}
            onClearSelectedEdge={() => setSelectedEdgeId(null)}
            onDisconnectEdge={onDisconnectEdge}
          />

          <NodeGraphPlugs plugs={plugs} nodes={displayNodes} draft={connectionDraft} selectedEdgeId={selectedEdgeId}
            hoveredPort={hoveredPort} hoveredEdgeId={hoveredEdgeId} onStartConnectionDrag={startConnectionDrag}
            onSelectEdge={setSelectedEdgeId} onStartDrag={startPlugDrag} onDisconnectEdge={onDisconnectEdge} />
          {displayNodes.map((node) => (
            <NodeGraphNodeCard
              key={node.id}
              node={node}
              selectedNodeId={selectedNodeId}
              isInSelection={multiSelection.has(node.id)}
              connectionDraft={connectionDraft}
              onSelectNode={handleNodeClick}
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
