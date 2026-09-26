import { NodeGraphGroups } from './canvas/NodeGraphGroups';
import type { NodeConnectionDrop } from '../../../types/nodeGraph';
import { useNodeDomViewport } from './canvas/useNodeDomViewport';
import { useNodeDomVisibility } from './canvas/useNodeDomVisibility';
import { useProgressiveMount } from './canvas/useProgressiveMount';
import { NO_EDGE_TARGETS, useCanvasEdgeHits } from './canvas/useCanvasEdgeHits';
import { useNodePreviewPreferences } from './previews/useNodePreviewPreferences';
import { nodePreviewKey, nodePreviewPreferenceKey, previewOutput } from '../../../services/nodePreview/previewTypes';
import { useNodeCanvasPlacement } from './canvas/useNodeCanvasPlacement';
import { useNodeLayoutTransition } from './canvas/useNodeLayoutTransition';
import { hasUnlockedSource } from './canvas/nodeGroupDrop';
import { NodeGraphCanvasSurface } from './canvas/rendering/NodeGraphCanvasSurface';
import type { NodeCanvasDragChannel } from './canvas/rendering/canvasNodeDrag';
import { annotatedGraphBounds, nodeGroupBounds } from './canvas/groupBounds';
import { Profiler, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { NodeCableAvoidButton, NodeCableStyleButton, NodePlaybackSignalsButton } from './canvas/NodeCableStyleButton';
import { NodeCompactLayoutButton } from './canvas/NodeCompactLayoutButton';
import { useCableAvoidance } from './canvas/useCableAvoidance';
import { parallelAngularLanes } from './canvas/parallelAngularLanes';
import { useSettingsStore } from '../../../stores/settingsStore';
import { resolveCableBranches, routeCables } from './canvas/cableBranches';
import { useNodeCableBranches } from './canvas/useNodeCableBranches';
import { NodeGraphBranchHandles } from './canvas/NodeGraphBranchHandles';
import { NodeCableMenu } from './canvas/NodeCableMenu';
import { useNodeDragHandlers, useNodeDragState } from './canvas/useNodeDragGesture';
import { useActiveNodeCards } from './canvas/useActiveNodeCards';
import type { NodeGraphPoint, Viewport } from './canvas/canvasGeometry';
import { fittedNodeViewport, useNodeGraphViewport } from './canvas/useNodeGraphViewport';
import { useNodeFoldViewport } from './canvas/useNodeFoldViewport';
import { useNodeGrowthViewport } from './canvas/useNodeGrowthViewport';
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
  initialGroupId?: string;
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
  onDropConnection?: (drop: NodeConnectionDrop) => void;
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


export function NodeGraphCanvas({
  graph: sourceGraph,
  projectGroupStates,
  initialGroupId,
  selectedNodeId,
  selectedNodeIds,
  onSelectNode,
  onToggleNodeSelection,
  onSelectNodes,
  onMoveNode,
  onMoveNodes,
  onConnectPorts,
  onDisconnectEdge,
  onDropConnection,
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
  const dragState = useNodeDragState(), nodeDragGestureRef = dragState.gestureRef, { draftLayouts, nodeDragging } = dragState;
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
  const { viewport, setViewport, zoomingRef } = useNodeGraphViewport(canvasRef, showVisualViewport);
  // This transform has one owner. React must not overwrite a newer pointer
  // position with the viewport of an earlier scheduled render.
  useLayoutEffect(() => { showVisualViewport(visualViewportRef.current); }, [showVisualViewport]);
  const [isPanning, setIsPanning] = useState(false);
  const [canvasRendered, setCanvasRendered] = useState(false);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [groupMessage, setGroupMessage] = useState('');
  const multiSelection = useMemo(() => new Set(selectedNodeIds ?? []), [selectedNodeIds]);
  const soleSelectionRef = useRef<string | null>(null); soleSelectionRef.current = multiSelection.size > 1 ? null : selectedNodeId;

  const { nodes: spacedNodes, placement, commit: commitPlacement, setBranches, toggleLock, arrange, reset: resetPlacement, toggleCompact } = useNodeCanvasPlacement(targetGraph, layoutScaleX);
  const targetNodes = useMemo(() => (
    spacedNodes.map((node) => !draftLayouts[node.id] ? node : ({
      ...node,
      layout: draftLayouts[node.id],
    }))
  ), [draftLayouts, spacedNodes]);
  const { graph, nodes: displayNodes, animating, glideMs } = useNodeLayoutTransition(targetGraph, targetNodes, nodeDragging || Object.keys(draftLayouts).length > 0, placement, projectFolds);
  const nodeGesture = nodeDragGestureRef.current;
  const freezeGroupFrames = nodeGesture && !nodeGesture.groupId
    && hasUnlockedSource(graph, placement, nodeGesture.members.map(member => member.nodeId));
  const groupFrameNodes = freezeGroupFrames ? spacedNodes : displayNodes;
  const groupBounds = useMemo(() => nodeGroupBounds(graph, groupFrameNodes), [graph, groupFrameNodes]);
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
  const resolvedBranches = useMemo(() => resolveCableBranches(graph.edges, placement.branches), [graph.edges, placement.branches]);
  const plugs = useMemo(() => getConnectionPlugs(graph.edges, nodesById, resolvedBranches.edgeRoot), [graph.edges, nodesById, resolvedBranches]);
  const routedCables = useMemo(() => routeCables(plugs, resolvedBranches), [plugs, resolvedBranches]);
  const cableStyle = useSettingsStore(state => state.nodeCableStyle);
  const styledCables = useMemo(() => cableStyle === 'angular' ? parallelAngularLanes(routedCables) : routedCables,
    [cableStyle, routedCables]);
  const shownCables = useCableAvoidance(styledCables, displayNodes, animating || nodeDragging, groupBounds, graph.groups, nodeDragging);
  const { hoveredPort, hoveredEdgeId, portHoverEvents } = useNodePortHover(nodesById);
  const graphBounds = useMemo(() => {
    const bounds = annotatedGraphBounds(graph, displayNodes, freezeGroupFrames ? undefined : groupBounds);
    for (const { tip } of plugs) { bounds.left = Math.min(bounds.left, tip.x - 10); bounds.right = Math.max(bounds.right, tip.x + 10); }
    for (const { x, y } of resolvedBranches.live.values()) {
      bounds.left = Math.min(bounds.left, x - 20); bounds.right = Math.max(bounds.right, x + 30); bounds.top = Math.min(bounds.top, y - 20); bounds.bottom = Math.max(bounds.bottom, y + 20);
    }
    return bounds;
  }, [displayNodes, graph, plugs, groupBounds, freezeGroupFrames, resolvedBranches]);
  const selectedEdge = useMemo(() => (selectedEdgeId ? graph.edges.find((edge) => edge.id === selectedEdgeId) ?? null : null), [graph.edges, selectedEdgeId]);

  const gridStyle = useMemo(() => ({
    // Move a cached sibling layer; inherited variables invalidate every node style.
    transform: `translate3d(${viewport.panX % 32}px, ${viewport.panY % 32}px, 0)`,
  }) as CSSProperties, [viewport.panX, viewport.panY]);

  const foldViewport = useNodeFoldViewport(canvasRef, sourceGraph, targetGraph, graph, graphBounds, animating, visualViewportRef, setViewport, groupBounds, showVisualViewport);
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
    const group = sourceGraph.groups?.find(group => group.id === id);
    if (group && onToggleGroup) foldViewport.request(!group.collapsed, id);
    onToggleGroup?.(id);
  }, [onToggleGroup, sourceGraph.groups, foldViewport.request]);
  const clearSelectedEdge = useCallback(() => setSelectedEdgeId(null), []);
  useEffect(() => {
    if (fittedGraph.current !== graph.id) {
      fittedGraph.current = graph.id;
      const group = initialGroupId && graph.groups?.find(g => g.id.split('/').at(-1) === initialGroupId.split('/').at(-1));
      if (group) focusGroup(group.id); else fitGraph();
    }
  }, [graph.id, graph.groups, initialGroupId, focusGroup, fitGraph]);

  useNodeGrowthViewport(canvasRef, graph, graphBounds, animating, fitBounds, foldViewport.following);

  const resetView = useCallback(() => {
    foldViewport.forget();
    const reset = resetPlacement();
    fitBounds(annotatedGraphBounds(targetGraph, targetGraph.nodes.map(node => ({ ...node, layout: reset.nodes[node.id] ?? node.layout }))));
  }, [foldViewport.forget, resetPlacement, targetGraph, fitBounds]);

  const getGraphPointFromClient = useCallback((clientX: number, clientY: number): NodeGraphPoint => {
    const rect = canvasRef.current?.getBoundingClientRect(), visual = visualViewportRef.current;
    return rect ? { x: (clientX - rect.left - visual.panX) / visual.zoom, y: (clientY - rect.top - visual.panY) / visual.zoom } : { x: 0, y: 0 };
  }, []);
  const dragChannel = useRef<NodeCanvasDragChannel | null>(null); // card drags repaint in the worker, not React
  const { startNodeDrag, startGroupDrag, handleNodePointerMove, finishNodeDrag, handleNodeClick } = useNodeDragHandlers({ state: dragState, graph, placement, spacedNodes,
    multiSelection, soleSelectionRef, nodesByIdRef, canvasRef, visualViewportRef, dragChannel, suppressNextClickRef, layoutScaleX, getGraphPoint: getGraphPointFromClient,
    commitPlacement, onSelectNode, onToggleNodeSelection, onMoveNode, onMoveNodes, onTransferNodes, setGroupMessage, setSelectedEdgeId });
  const branchUi = useNodeCableBranches({ branches: placement.branches, resolved: resolvedBranches, cables: routedCables, commit: setBranches,
    getGraphPoint: getGraphPointFromClient, dragChannel, canvas: canvasRef, onConnectPorts });

  const nodeMarquee = useNodeMarqueeSelection({
    nodes: displayNodes,
    viewport,
    getGraphPoint: getGraphPointFromClient,
    onSelectNodes, onSelectRect: branchUi.selectInRect,
  });

  const { connectionDraft, startConnectionDrag, startPlugDrag, startBranchDrag, moveConnectionDrag, finishConnectionDrag, cancelConnectionDrag, suppressConnectionContextMenu } = useNodeConnectionDrag({
    graphId: graph.id, canvasRef, nodesById, edges: graph.edges, getGraphPoint: getGraphPointFromClient,
    onConnectPorts, onReconnectPorts, onDisconnectEdge, onDropConnection, onConnectBranch: branchUi.connect,
  });
  const domViewport = useNodeDomViewport(canvasRef, viewport, !!nodeGesture || !!connectionDraft, isPanning, zoomingRef);
  const dom = useNodeDomVisibility(displayNodes, plugs, domViewport);
  const activeCards = useActiveNodeCards(dom.nodes, plugs, getGraphPointFromClient);
  const isCardActive = (id: string) => !canvasRendered || activeCards.active.has(id) || id === selectedNodeId || multiSelection.has(id);
  const activePlugIds = useMemo(() => canvasRendered ? new Set(plugs.flatMap(plug => { const id = `${plug.edge.id}:${plug.port.direction}`;
    return dom.plugIds.has(id) && (activeCards.active.has(plug.node.id) || plug.node.id === selectedNodeId || multiSelection.has(plug.node.id)) ? [id] : []; })) : dom.plugIds,
  [canvasRendered, plugs, dom.plugIds, activeCards.active, selectedNodeId, multiSelection]);
  // Settled hit targets: cards mount in batches, cables/plugs as a deferred update.
  const hitTargetsActive = !canvasRendered || !animating;
  const mountedNodeCount = useProgressiveMount(dom.nodes.length, hitTargetsActive && canvasRendered);
  // Active cards stay mounted while the rest mounts in batches: a focused or
  // captured card must never be unmounted by a changing batch window.
  const mountedNodes = !canvasRendered || mountedNodeCount >= dom.nodes.length ? dom.nodes
    : dom.nodes.filter((node, index) => index < mountedNodeCount || isCardActive(node.id));
  const cablesReady = useDeferredValue(hitTargetsActive);
  const hoverChannel = useRef<((edgeId: string | null) => void) | null>(null); // canvas-mode cable hits from a geometry index
  const edgeHits = useCanvasEdgeHits({ enabled: canvasRendered && !animating, cables: shownCables, canvas: canvasRef, visual: visualViewportRef, getGraphPoint: getGraphPointFromClient, hover: hoverChannel });

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
    if (!target.closest('.node-workspace-plug, .node-workspace-group-header')) edgeHits.press(event.clientX, event.clientY);

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
  }, [edgeHits, nodeMarquee]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.buttons === 0 && event.pointerType !== 'touch') edgeHits.move(event.clientX, event.clientY);
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
  }, [edgeHits, moveConnectionDrag, nodeMarquee, setViewport, showVisualViewport, viewport.zoom]);

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
          <NodePlaybackSignalsButton /><NodeCableStyleButton /><NodeCableAvoidButton />
          <NodeCompactLayoutButton enabled={placement.compactEffects !== false} onToggle={toggleCompact} />
          {selectedEdge && !selectedEdge.readOnly && <button type="button" className="node-workspace-toolbar-button" onClick={disconnectSelectedEdge}>Disconnect</button>}
          <button type="button" className="node-workspace-toolbar-button" onClick={event => { fitGraph(); if (event.detail > 0) event.currentTarget.blur(); }}>Fit</button>
          {!!targetGraph.groups?.length && onSetAllGroupsCollapsed && <button type="button" className="node-workspace-toolbar-button"
            title="Expand or collapse every group, including nested groups" onClick={event => {
              const collapsed = !targetGraph.groups?.some(group => group.collapsed);
              foldViewport.request(collapsed);
              onSetAllGroupsCollapsed(collapsed);
              if (event.detail > 0) event.currentTarget.blur();
            }}>{targetGraph.groups.some(group => group.collapsed) ? 'Expand all' : 'Collapse all'}</button>}
          {targetGraph.groups?.some(group => group.layoutMode === 'flow') && <button type="button" className="node-workspace-toolbar-button"
            title="Arrange groups and their connected outer nodes by data flow" onClick={event => {
              arrange(); if (event.detail > 0) event.currentTarget.blur();
            }}>Arrange</button>}
          <button type="button" className="node-workspace-toolbar-button" onClick={event => { resetView(); if (event.detail > 0) event.currentTarget.blur(); }}>Reset</button>
          <span className="node-workspace-zoom">{Math.round(viewport.zoom * 100)}%</span>
        </div>
      </div>
      {groupMessage && <div className="node-workspace-graph-message" role="status">{groupMessage}</div>}

      <div
        ref={canvasRef}
        data-layout-animating={animating}
        className={`node-workspace-canvas${canvasRendered ? ' canvas-rendered' : ''}`}
        tabIndex={0}
        {...portHoverEvents}
        onPointerDown={handlePointerDown}
        onPointerMove={event => { handleNodePointerMove(event); if (canvasRendered && !nodeDragGestureRef.current && !panGestureRef.current) activeCards.track(event.clientX, event.clientY); handlePointerMove(event); }}
        onPointerLeave={() => { edgeHits.leave(); activeCards.leave(); }}
        onPointerUp={(event) => {
          if (nodeDragGestureRef.current?.pointerId === event.pointerId) { finishNodeDrag(event); return; }
          if (nodeMarquee.finish(event)) return;
          if (!finishConnectionDrag(event)) {
            finishPanGesture(event);
            const clicked = edgeHits.release(event.clientX, event.clientY); if (clicked) setSelectedEdgeId(clicked);
          }
        }}
        onLostPointerCapture={event => { finishNodeDrag(event); nodeMarquee.finish(event); cancelConnectionDrag(event); finishPanGesture(event); }}
        onPointerCancel={(event) => {
          finishNodeDrag(event);
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
        onContextMenuCapture={event => {
          if (suppressConnectionContextMenu()) { event.preventDefault(); event.stopPropagation(); }
        }}
        onDoubleClick={event => {
          if (!(event.target as Element).closest('.node-workspace-node, .node-workspace-group, .node-workspace-plug')) branchUi.insertAt(edgeHits.at(event.clientX, event.clientY), getGraphPointFromClient(event.clientX, event.clientY));
        }}
        onKeyDownCapture={event => {
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
          const port = (event.target as Element).closest<HTMLElement>('.node-workspace-port');
          if (!port || !onDropConnection) return;
          event.preventDefault(); event.stopPropagation();
          const rect = port.getBoundingClientRect(), x = rect.right + 24, y = rect.bottom;
          onDropConnection({ nodeId: port.dataset.nodeId!, portId: port.dataset.portId!, direction: port.dataset.direction as 'input' | 'output',
            x, y, layout: getGraphPointFromClient(x, y) });
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          if (nodeMarquee.suppressContextMenu()) return;
          if ((event.target as Element).closest('.node-workspace-port, .node-workspace-edge-hit')) {
            return;
          }
          const cable = !(event.target as Element).closest('.node-workspace-node, .node-workspace-plug') ? edgeHits.at(event.clientX, event.clientY) : null;
          if (cable) { branchUi.openMenu(cable, event.clientX, event.clientY); return; }
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
        <NodeGraphCanvasSurface graph={graph} nodes={displayNodes} glideMs={glideMs} hoverRef={hoverChannel} dragRef={dragChannel} groupFrameNodes={groupFrameNodes} groupBounds={groupBounds} plugs={plugs} viewport={viewport} previewsSuspended={animating}
          surfaceRef={canvasSurfaceRef} backgroundRef={canvasBackgroundRef} onViewRendered={handleViewRendered}
          selectedNodeId={selectedNodeId} selection={multiSelection} selectedEdgeId={selectedEdgeId}
          hoveredEdgeId={hoveredEdgeId} hoveredPort={hoveredPort} draft={connectionDraft} canBypass={!!onToggleNodeBypass} onReady={setCanvasRendered}
          cables={shownCables} edgeRoots={resolvedBranches.edgeRoot} branches={branchUi.sceneBranches} />
        {nodeMarquee.marquee && <div className="node-workspace-marquee" style={nodeMarquee.marquee} aria-hidden="true" />}
        <div
          ref={canvasInnerRef}
          className="node-workspace-canvas-inner"
        >
          <NodeGraphGroups graph={graph} nodes={displayNodes} zoom={viewport.zoom} onToggle={toggleGroup} onFocus={focusGroup}
            frameNodes={groupFrameNodes} groupBounds={groupBounds}
            locks={placement.groups} onToggleLock={toggleLock} onToggleNodeBypass={onToggleNodeBypass}
            onStartDrag={startGroupDrag} onPointerMove={handleNodePointerMove} onFinishDrag={finishNodeDrag} />
          {/* The worker paints moving cards/cables. Rebuild their invisible DOM
              hit targets once they settle, not on every animation frame. */}
          {hitTargetsActive && <>
          {(!canvasRendered || cablesReady) && <>
          <NodeGraphEdges
            graph={graph} frameNodes={groupFrameNodes}
            routedCables={shownCables}
            visibleEdgeIds={canvasRendered ? NO_EDGE_TARGETS : dom.edgeIds}
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

          <NodeGraphPlugs canvasRendered={canvasRendered} visibleNodeIds={dom.nodeIds} visiblePlugIds={activePlugIds} plugs={plugs} nodes={displayNodes} draft={connectionDraft} selectedEdgeId={selectedEdgeId}
            hoveredPort={hoveredPort} hoveredEdgeId={hoveredEdgeId} onStartConnectionDrag={startConnectionDrag}
            onSelectEdge={setSelectedEdgeId} onStartDrag={startPlugDrag} onDisconnectEdge={onDisconnectEdge} />
          </>}
          {mountedNodes.map((node) => (
            <NodeGraphNodeCard
              key={node.id}
              node={node}
              collapsedGroupId={graph.groups?.find(group => group.collapsed && group.proxyId === node.id)?.id}
              onToggleGroup={toggleGroup}
              clipId={sourceGraph.owner.id}
              canvasRendered={canvasRendered}
              // Per-card values: a selection or connection draft re-renders only the cards it touches.
              selectedNodeId={node.id === selectedNodeId ? selectedNodeId : null}
              isInSelection={multiSelection.has(node.id)}
              active={isCardActive(node.id)} onFocusChange={activeCards.setFocus}
              connectionDraft={isCardActive(node.id) ? connectionDraft : null}
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
          {canvasRendered && <NodeGraphBranchHandles {...branchUi.handles} zoom={viewport.zoom} onStartConnection={startBranchDrag} />}
        </div>
      </div>
      {branchUi.menu && <NodeCableMenu menu={branchUi.menu} onClose={branchUi.closeMenu} onAddBranch={branchUi.insertAt} onRemoveBranch={id => branchUi.remove([id])}
        onDisconnect={onDisconnectEdge && (id => { onDisconnectEdge(id); setSelectedEdgeId(null); })} />}
    </div>
  </Profiler>);
}
