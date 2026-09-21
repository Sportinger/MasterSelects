import { NodeGraphGroups } from './canvas/NodeGraphGroups';
import { useNodeDomViewport } from './canvas/useNodeDomViewport';
import { useNodeDomVisibility } from './canvas/useNodeDomVisibility';
import { useNodePreviewPreferences } from './previews/useNodePreviewPreferences';
import { nodePreviewKey, nodePreviewPreferenceKey, previewOutput } from '../../../services/nodePreview/previewTypes';
import { useNodeCanvasPlacement } from './canvas/useNodeCanvasPlacement';
import { useNodeLayoutTransition } from './canvas/useNodeLayoutTransition';
import { groupPlacementMembers } from './canvas/nodeCanvasPlacement';
import { hasUnlockedSource, nodeGroupDropTarget } from './canvas/nodeGroupDrop';
import { placeTransferredNodes } from './canvas/placeTransferredNodes';
import { NodeGraphCanvasSurface } from './canvas/rendering/NodeGraphCanvasSurface';
import { annotatedGraphBounds, nodeGroupBounds } from './canvas/groupBounds';
import { Profiler, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { recordNodeCanvasRender } from './canvas/rendering/nodeCanvasProfile';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
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
import { fittedNodeViewport, useNodeGraphViewport } from './canvas/useNodeGraphViewport';
import { useNodeFoldViewport } from './canvas/useNodeFoldViewport';
import { useNodeConnectionDrag } from './canvas/useNodeConnectionDrag';
import { getConnectionPlugs } from './canvas/connectionPlugs';
import { NodeGraphPlugs } from './canvas/NodeGraphPlugs';
import { useNodePortHover } from './canvas/useNodePortHover';
import { useNodeMarqueeSelection } from './canvas/useNodeMarqueeSelection';
import {
  DEFAULT_VIEWPORT,
  getGraphBounds,
} from './canvas/canvasGeometry';

export interface NodeGraphMove {
  nodeId: string;
  layout: NodeGraphLayout;
}

interface NodeGraphCanvasProps {
  graph: NodeGraph;
  projectGroupStates?: (collapsed: Record<string, boolean>) => NodeGraph;
  selectedNodeId: string | null;
  /** Additional multi-selection (domains that support group operations). */
  selectedNodeIds?: readonly string[];
  onSelectNode: (nodeId: string) => void;
  onToggleNodeSelection?: (nodeId: string) => void;
  onSelectNodes?: (nodeIds: string[]) => void;
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
  onSetAllGroupsCollapsed?: (collapsed: boolean) => void;
  onTransferNodes?: (nodeIds: string[], groupId: string) => Record<string, string>;
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
  groupId?: string;
}

export function NodeGraphCanvas({
  graph: sourceGraph,
  projectGroupStates,
  selectedNodeId,
  selectedNodeIds,
  onSelectNode,
  onToggleNodeSelection,
  onSelectNodes,
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
  onSetAllGroupsCollapsed,
  onTransferNodes,
  layoutScaleX = 1,
}: NodeGraphCanvasProps) {
  const { preferences, toggleGlobal, toggleNode, selectOutput, aspectRatio } = useNodePreviewPreferences(sourceGraph.owner.id);
  const prepareGraph = useCallback((input: NodeGraph) => ({ ...input, nodes: input.nodes.map(node => {
    const preference = preferences.nodes[nodePreviewPreferenceKey(sourceGraph.owner.id, node)] ?? preferences.nodes[node.id];
    const port = previewOutput(node, preference?.portId);
    const imageRatio = port?.type === 'texture' || port?.type === 'mask' || port?.metadata?.semanticKind === 'operator:landmarks';
    return { ...node, preview: { enabled: preference?.enabled ?? preferences.enabled, requested: preference?.enabled ?? preferences.enabled,
      portId: preference?.portId, key: nodePreviewKey(sourceGraph.owner.id, node, preference?.portId), aspectRatio: imageRatio ? aspectRatio : 16 / 9 } };
  }) }), [sourceGraph.owner.id, preferences, aspectRatio]);
  const targetGraph = useMemo(() => prepareGraph(sourceGraph), [sourceGraph, prepareGraph]);
  const projectFolds = useMemo(() => projectGroupStates
    ? (states: Record<string, boolean>) => prepareGraph(projectGroupStates(states)) : undefined, [projectGroupStates, prepareGraph]);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const recordRender = useCallback((_id: string, _phase: string, duration: number) => recordNodeCanvasRender(canvasRef.current, duration), []);
  const canvasSurfaceRef = useRef<HTMLDivElement | null>(null);
  const canvasBackgroundRef = useRef<HTMLDivElement | null>(null);
  const canvasInnerRef = useRef<HTMLDivElement | null>(null);
  const panGestureRef = useRef<PanGesture | null>(null);
  const pendingPanRef = useRef<{ panX: number; panY: number } | null>(null);
  const panFrameRef = useRef<number | null>(null);
  const nodeDragGestureRef = useRef<NodeDragGesture | null>(null);
  const suppressNextClickRef = useRef(false);
  const renderedViewportRef = useRef(DEFAULT_VIEWPORT);
  const visualViewportRef = useRef(DEFAULT_VIEWPORT);
  const showVisualViewport = useCallback((visual: Viewport) => {
    visualViewportRef.current = visual;
    if (canvasInnerRef.current) {
      canvasInnerRef.current.style.transform = `translate3d(${visual.panX}px, ${visual.panY}px, 0) scale(${visual.zoom})`;
    }
    if (canvasBackgroundRef.current) {
      canvasBackgroundRef.current.style.transform = `translate3d(${visual.panX}px, ${visual.panY}px, 0) scale(${visual.zoom})`;
    }
    const rendered = renderedViewportRef.current;
    const scale = visual.zoom / rendered.zoom;
    const x = visual.panX - rendered.panX * scale;
    const y = visual.panY - rendered.panY * scale;
    if (canvasSurfaceRef.current) {
      // Keep the bitmap in the same compositing layer when its view catches up.
      // Dropping the transform can leave Chromium presenting the previous scale
      // until the next pointer move, even though the new bitmap is already ready.
      canvasSurfaceRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    }
  }, []);
  const { viewport, setViewport } = useNodeGraphViewport(canvasRef, showVisualViewport);
  // This transform has one owner. React must not overwrite a newer pointer
  // position with the viewport of an earlier scheduled render.
  useLayoutEffect(() => { showVisualViewport(visualViewportRef.current); }, [showVisualViewport]);
  const [isPanning, setIsPanning] = useState(false);
  const [canvasRendered, setCanvasRendered] = useState(false);
  const [draftLayouts, setDraftLayouts] = useState<Record<string, NodeGraphLayout>>({});
  const draftLayoutsRef = useRef(draftLayouts);
  draftLayoutsRef.current = draftLayouts;
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [groupMessage, setGroupMessage] = useState('');
  const multiSelection = useMemo(() => new Set(selectedNodeIds ?? []), [selectedNodeIds]);

  const { nodes: spacedNodes, placement, commit: commitPlacement, toggleLock, arrange } = useNodeCanvasPlacement(targetGraph, layoutScaleX);
  const targetNodes = useMemo(() => (
    spacedNodes.map((node) => !draftLayouts[node.id] ? node : ({
      ...node,
      layout: draftLayouts[node.id],
    }))
  ), [draftLayouts, spacedNodes]);
  const { graph, nodes: displayNodes, animating } = useNodeLayoutTransition(targetGraph, targetNodes, Object.keys(draftLayouts).length > 0, placement, projectFolds);
  const nodeGesture = nodeDragGestureRef.current;
  const freezeGroupFrames = nodeGesture && !nodeGesture.groupId
    && hasUnlockedSource(graph, placement, nodeGesture.members.map(member => member.nodeId));
  const groupFrameNodes = freezeGroupFrames ? spacedNodes : displayNodes;
  const nodesById = useMemo(() => new Map(displayNodes.map((node) => [node.id, node])), [displayNodes]);
  const nodesByIdRef = useRef(nodesById);
  nodesByIdRef.current = nodesById;
  // Keep card props stable while only the viewport moves. Per-node closures
  // here bypass React.memo and reconcile every port on every pan/zoom frame.
  const toggleNodePreview = useCallback((nodeId: string) => {
    const node = nodesByIdRef.current.get(nodeId);
    if (node) toggleNode(nodePreviewPreferenceKey(sourceGraph.owner.id, node), nodeId);
  }, [sourceGraph.owner.id, toggleNode]);
  const selectNodePreviewOutput = useCallback((nodeId: string, portId: string) => {
    const node = nodesByIdRef.current.get(nodeId);
    if (node) selectOutput(nodePreviewPreferenceKey(sourceGraph.owner.id, node), portId);
  }, [sourceGraph.owner.id, selectOutput]);
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
    // Move a cached sibling layer; inherited variables invalidate every node style.
    transform: `translate3d(${viewport.panX % 32}px, ${viewport.panY % 32}px, 0)`,
  }) as CSSProperties, [viewport.panX, viewport.panY]);

  const foldViewport = useNodeFoldViewport(canvasRef, sourceGraph, targetGraph, graph, graphBounds, animating, visualViewportRef, setViewport);
  const cancelFoldFit = foldViewport.cancel;
  const fitBounds = useCallback((bounds: typeof graphBounds) => {
    cancelFoldFit();
    const canvas = canvasRef.current;
    if (!canvas) return;
    setViewport(fittedNodeViewport(bounds, canvas.clientWidth, canvas.clientHeight));
  }, [setViewport, cancelFoldFit]);
  const fitGraph = useCallback(() => fitBounds(graphBounds), [fitBounds, graphBounds]);
  const focusGroup = useCallback((id: string) => {
    const members = new Set(graph.groups?.find(g => g.id === id)?.nodeIds);
    fitBounds(nodeGroupBounds(graph, displayNodes).get(id) ?? getGraphBounds({ ...graph, nodes: displayNodes.filter(n => members.has(n.id)) }));
  }, [graph, displayNodes, fitBounds]);

  const fittedGraph = useRef<string | null>(null);
  const toggleGroup = useCallback((id: string) => {
    onToggleGroup?.(id);
  }, [onToggleGroup]);
  const clearSelectedEdge = useCallback(() => setSelectedEdgeId(null), []);
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
    cancelFoldFit();
    setViewport(DEFAULT_VIEWPORT);
  }, [setViewport, cancelFoldFit]);

  const getGraphPointFromClient = useCallback((clientX: number, clientY: number): NodeGraphPoint => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }

    const visual = visualViewportRef.current;
    return {
      x: (clientX - rect.left - visual.panX) / visual.zoom,
      y: (clientY - rect.top - visual.panY) / visual.zoom,
    };
  }, []);

  const nodeMarquee = useNodeMarqueeSelection({
    nodes: displayNodes,
    viewport,
    getGraphPoint: getGraphPointFromClient,
    onSelectNodes,
  });

  const { connectionDraft, startConnectionDrag, startPlugDrag, moveConnectionDrag, finishConnectionDrag, cancelConnectionDrag } = useNodeConnectionDrag({
    graphId: graph.id, canvasRef, nodesById, getGraphPoint: getGraphPointFromClient,
    onConnectPorts, onReconnectPorts, onDisconnectEdge,
  });
  const domViewport = useNodeDomViewport(canvasRef, viewport, !!nodeGesture || !!connectionDraft);
  const dom = useNodeDomVisibility(displayNodes, plugs, domViewport);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (nodeMarquee.start(event)) return;
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
      panX: visualViewportRef.current.panX,
      panY: visualViewportRef.current.panY,
    };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [nodeMarquee]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (nodeMarquee.move(event)) return;
    if (moveConnectionDrag(event)) return;

    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const next = {
      panX: gesture.panX + (event.clientX - gesture.clientX),
      panY: gesture.panY + (event.clientY - gesture.clientY),
    };
    pendingPanRef.current = next;
    showVisualViewport({ ...visualViewportRef.current, ...next, zoom: viewport.zoom });
    if (panFrameRef.current === null) panFrameRef.current = requestAnimationFrame(() => {
      panFrameRef.current = null;
      const pending = pendingPanRef.current;
      if (pending) setViewport(current => ({ ...current, ...pending }));
    });
  }, [moveConnectionDrag, nodeMarquee, setViewport, showVisualViewport, viewport.zoom]);

  const finishPanGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const pending = pendingPanRef.current;
    pendingPanRef.current = null;
    if (pending) {
      if (panFrameRef.current !== null) cancelAnimationFrame(panFrameRef.current);
      panFrameRef.current = null;
      setViewport(current => ({ ...current, ...pending }));
    }
    panGestureRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, [setViewport]);

  const handleViewRendered = useCallback((rendered: Viewport) => {
    renderedViewportRef.current = rendered;
    showVisualViewport(visualViewportRef.current);
  }, [showVisualViewport]);

  useEffect(() => () => {
    if (panFrameRef.current !== null) cancelAnimationFrame(panFrameRef.current);
  }, []);

  const startNodeDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, node: NodeGraphNode) => {
    event.stopPropagation();
    setGroupMessage('');
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
        const member = nodesByIdRef.current.get(memberId);
        return member ? [{ nodeId: memberId, startX: member.layout.x, startY: member.layout.y }] : [];
      }),
      moved: false,
      groupId: !dragsSelection ? graph.groups?.find(group => group.collapsed && group.proxyId === node.id)?.id : undefined,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [multiSelection, onSelectNode, onToggleNodeSelection, graph.groups]);

  const startGroupDrag = (event: ReactPointerEvent<HTMLDivElement>, groupId: string) => {
    event.stopPropagation();
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    event.preventDefault();
    const members = [...groupPlacementMembers(placement, groupId)].flatMap(id => {
      const node = nodesByIdRef.current.get(id);
      return node ? [{ nodeId: id, startX: node.layout.x, startY: node.layout.y }] : [];
    });
    if (!members.length) return;
    setSelectedEdgeId(null);
    nodeDragGestureRef.current = { pointerId: event.pointerId, nodeId: members[0].nodeId, groupId,
      clientX: event.clientX, clientY: event.clientY, members, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleNodePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = nodeDragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const deltaX = (event.clientX - gesture.clientX) / visualViewportRef.current.zoom;
    const deltaY = (event.clientY - gesture.clientY) / visualViewportRef.current.zoom;
    if (!gesture.moved && Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY) < 3) return;
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
  }, []);

  const finishNodeDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = nodeDragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const moves = gesture.moved && event.type === 'pointerup'
      ? gesture.members.flatMap((member) => {
          const finalLayout = draftLayoutsRef.current[member.nodeId];
          return finalLayout
            ? [{ nodeId: member.nodeId, layout: finalLayout }]
            : [];
        })
      : [];
    try {
      const ids = moves.map(move => move.nodeId);
      const target = moves.length && !gesture.groupId && onTransferNodes && hasUnlockedSource(graph, placement, ids)
        ? nodeGroupDropTarget(graph, spacedNodes, placement, ids, getGraphPointFromClient(event.clientX, event.clientY)) : undefined;
      const placed = target ? placeTransferredNodes(graph, spacedNodes, target, moves) : moves;
      if (moves.length) commitPlacement(placed, gesture.groupId, gesture.groupId ? undefined : () => {
        if (target && onTransferNodes) return onTransferNodes(ids, target);
        const domainMoves = moves.map(move => ({ ...move, layout: { x: Math.round(move.layout.x / layoutScaleX), y: move.layout.y } }));
        if (domainMoves.length > 1 && onMoveNodes) onMoveNodes(domainMoves);
        else for (const move of domainMoves) onMoveNode?.(move.nodeId, move.layout);
      });
    } catch (error) { setGroupMessage(error instanceof Error ? error.message : String(error)); }
    if (gesture.moved && gesture.members.length > 1 && !gesture.groupId) {
      suppressNextClickRef.current = true;
    }
    nodeDragGestureRef.current = null;
    setDraftLayouts((current) => {
      const next = { ...current };
      for (const member of gesture.members) delete next[member.nodeId];
      return next;
    });
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, [layoutScaleX, onMoveNode, onMoveNodes, commitPlacement, graph, placement, spacedNodes, getGraphPointFromClient, onTransferNodes]);

  const handleNodeClick = useCallback((nodeId: string) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    onSelectNode(nodeId);
  }, [onSelectNode]);

  const disconnectPortEdges = useCallback((node: NodeGraphNode, port: NodeGraphPort) => {
    if (!onDisconnectEdge || port.metadata?.readOnly) {
      return;
    }

    for (const edge of graph.edges) {
      if (edge.readOnly) continue;
      const matchesPort = port.direction === 'output'
        ? edge.fromNodeId === node.id && edge.fromPortId === port.id
        : edge.toNodeId === node.id && edge.toPortId === port.id;
      if (matchesPort) {
        onDisconnectEdge(edge.id);
      }
    }
  }, [graph.edges, onDisconnectEdge]);

  const disconnectSelectedEdge = useCallback(() => {
    if (!selectedEdge || selectedEdge.readOnly || !onDisconnectEdge) return;
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

  return (<Profiler id="node-canvas" onRender={recordRender}>
    <div
      className={`node-workspace-board${isPanning ? ' board-interacting' : ''}`}
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
          <button type="button" className="node-workspace-toolbar-button" aria-pressed={preferences.enabled}
            title="Toggle all node previews" onClick={event => {
              toggleGlobal(sourceGraph.nodes.map(node => nodePreviewPreferenceKey(sourceGraph.owner.id, node)));
              if (event.detail > 0) event.currentTarget.blur();
            }}>Previews</button>
          {selectedEdge && !selectedEdge.readOnly && (
            <button type="button" className="node-workspace-toolbar-button" onClick={disconnectSelectedEdge}>
              Disconnect
            </button>
          )}
          <button type="button" className="node-workspace-toolbar-button" onClick={event => { fitGraph(); if (event.detail > 0) event.currentTarget.blur(); }}>Fit</button>
          {!!targetGraph.groups?.length && onSetAllGroupsCollapsed && <button type="button" className="node-workspace-toolbar-button"
            title="Expand or collapse every group, including nested groups" onClick={event => {
              const collapsed = !targetGraph.groups?.some(group => group.collapsed);
              foldViewport.request(collapsed);
              onSetAllGroupsCollapsed(collapsed);
              if (event.detail > 0) event.currentTarget.blur();
            }}>{targetGraph.groups.some(group => group.collapsed) ? 'Expand all' : 'Collapse all'}</button>}
          {targetGraph.groups?.some(group => group.layoutMode === 'flow') && <button type="button" className="node-workspace-toolbar-button"
            title="Arrange Kaleidoscope, Fisheye and their connected outer nodes by data flow" onClick={event => {
              arrange(); if (event.detail > 0) event.currentTarget.blur();
            }}>Arrange</button>}
          <button type="button" className="node-workspace-toolbar-button" onClick={event => { resetView(); if (event.detail > 0) event.currentTarget.blur(); }}>Reset</button>
          <span className="node-workspace-zoom">{Math.round(viewport.zoom * 100)}%</span>
        </div>
      </div>
      {groupMessage && <div className="node-workspace-graph-message" role="status">{groupMessage}</div>}

      <div
        ref={canvasRef}
        className={`node-workspace-canvas${canvasRendered ? ' canvas-rendered' : ''}`}
        tabIndex={0}
        {...portHoverEvents}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => {
          if (nodeMarquee.finish(event)) return;
          if (!finishConnectionDrag(event)) {
            finishPanGesture(event);
          }
        }}
        onLostPointerCapture={event => { nodeMarquee.finish(event); cancelConnectionDrag(event); finishPanGesture(event); }}
        onPointerCancel={(event) => {
          if (nodeMarquee.finish(event)) return;
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
          if (nodeMarquee.suppressContextMenu()) return;
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
        <div className="node-workspace-grid" style={gridStyle} aria-hidden="true" />
        <NodeGraphCanvasSurface graph={graph} nodes={displayNodes} groupFrameNodes={groupFrameNodes} plugs={plugs} viewport={viewport} previewsSuspended={animating}
          surfaceRef={canvasSurfaceRef} backgroundRef={canvasBackgroundRef} onViewRendered={handleViewRendered}
          selectedNodeId={selectedNodeId} selection={multiSelection} selectedEdgeId={selectedEdgeId}
          hoveredEdgeId={hoveredEdgeId} hoveredPort={hoveredPort} draft={connectionDraft} canBypass={!!onToggleNodeBypass} onReady={setCanvasRendered} />
        {nodeMarquee.marquee && <div className="node-workspace-marquee" style={nodeMarquee.marquee} aria-hidden="true" />}
        <div
          ref={canvasInnerRef}
          className="node-workspace-canvas-inner"
        >
          <NodeGraphGroups graph={graph} nodes={displayNodes} zoom={viewport.zoom} onToggle={toggleGroup} onFocus={focusGroup}
            frameNodes={groupFrameNodes}
            locks={placement.groups} onToggleLock={toggleLock} onToggleNodeBypass={onToggleNodeBypass}
            onStartDrag={startGroupDrag} onPointerMove={handleNodePointerMove} onFinishDrag={finishNodeDrag} />
          {/* The worker paints moving cards/cables. Rebuild their invisible DOM
              hit targets once they settle, not on every animation frame. */}
          {(!canvasRendered || !animating) && <>
          <NodeGraphEdges
            graph={graph} frameNodes={groupFrameNodes}
            visibleEdgeIds={dom.edgeIds}
            canvasRendered={canvasRendered}
            zoom={viewport.zoom}
            graphBounds={graphBounds}
            edges={graph.edges}
            plugs={plugs}
            nodesById={nodesById}
            selectedEdgeId={selectedEdgeId}
            hoveredEdgeId={hoveredEdgeId}
            connectionDraft={connectionDraft}
            onSelectEdge={setSelectedEdgeId}
            onClearSelectedEdge={clearSelectedEdge}
            onDisconnectEdge={onDisconnectEdge}
          />

          <NodeGraphPlugs canvasRendered={canvasRendered} visibleNodeIds={dom.nodeIds} visiblePlugIds={dom.plugIds} plugs={plugs} nodes={displayNodes} draft={connectionDraft} selectedEdgeId={selectedEdgeId}
            hoveredPort={hoveredPort} hoveredEdgeId={hoveredEdgeId} onStartConnectionDrag={startConnectionDrag}
            onSelectEdge={setSelectedEdgeId} onStartDrag={startPlugDrag} onDisconnectEdge={onDisconnectEdge} />
          {dom.nodes.map((node) => (
            <NodeGraphNodeCard
              key={node.id}
              node={node}
              collapsedGroupId={graph.groups?.find(group => group.collapsed && group.proxyId === node.id)?.id}
              onToggleGroup={toggleGroup}
              clipId={sourceGraph.owner.id}
              canvasRendered={canvasRendered}
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
              onTogglePreview={toggleNodePreview}
              onPreviewOutput={selectNodePreviewOutput}
            />
          ))}
          </>}
        </div>
      </div>
    </div>
  </Profiler>);
}
