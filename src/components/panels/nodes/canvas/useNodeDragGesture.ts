import { useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { NodeCanvasPlacement, NodeGraph, NodeGraphLayout, NodeGraphNode } from '../../../../types/nodeGraph';
import type { NodeGraphMove } from '../NodeGraphCanvas';
import type { NodeGraphPoint, Viewport } from './canvasGeometry';
import type { NodeCanvasDragChannel } from './rendering/canvasNodeDrag';
import { groupPlacementMembers } from './nodeCanvasPlacement';
import { hasUnlockedSource, nodeGroupDropTarget } from './nodeGroupDrop';
import { placeTransferredNodes } from './placeTransferredNodes';

export interface NodeDragGesture {
  pointerId: number;
  nodeId: string;
  clientX: number;
  clientY: number;
  members: Array<{ nodeId: string; startX: number; startY: number }>;
  moved: boolean;
  groupId?: string;
  delta?: { x: number; y: number };
}

/** Drag state the displayed layout depends on; the handlers attach later. */
export function useNodeDragState() {
  const gestureRef = useRef<NodeDragGesture | null>(null);
  const [draftLayouts, setDraftLayouts] = useState<Record<string, NodeGraphLayout>>({});
  const [nodeDragging, setNodeDragging] = useState(false);
  return { gestureRef, draftLayouts, setDraftLayouts, nodeDragging, setNodeDragging };
}

interface Options {
  state: ReturnType<typeof useNodeDragState>;
  graph: NodeGraph;
  placement: NodeCanvasPlacement;
  spacedNodes: NodeGraphNode[];
  multiSelection: ReadonlySet<string>;
  soleSelectionRef: RefObject<string | null>;
  nodesByIdRef: RefObject<Map<string, NodeGraphNode>>;
  canvasRef: RefObject<HTMLDivElement | null>;
  visualViewportRef: RefObject<Viewport>;
  dragChannel: RefObject<NodeCanvasDragChannel | null>;
  suppressNextClickRef: MutableRefObject<boolean>;
  layoutScaleX: number;
  getGraphPoint: (clientX: number, clientY: number) => NodeGraphPoint;
  commitPlacement: (moves: Array<{ nodeId: string; layout: NodeGraphLayout }>, groupId?: string, domainCommit?: () => Record<string, string> | void) => void;
  onSelectNode: (nodeId: string) => void;
  onToggleNodeSelection?: (nodeId: string) => void;
  onMoveNode?: (nodeId: string, layout: NodeGraphLayout) => void;
  onMoveNodes?: (moves: NodeGraphMove[]) => void;
  onTransferNodes?: (nodeIds: string[], groupId: string) => Record<string, string>;
  setGroupMessage: (message: string) => void;
  setSelectedEdgeId: (id: string | null) => void;
}

/**
 * Card and group-header dragging. Handlers are stable and read the latest
 * graph through a ref, so cards never re-render because a selection changed.
 * Card drags paint in the canvas worker; group drags move DOM frames in React.
 */
export function useNodeDragHandlers(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  return useMemo(() => {
    const clearDraft = (members: NodeDragGesture['members']) => latest.current.state.setDraftLayouts(current => {
      const next = { ...current };
      for (const member of members) delete next[member.nodeId];
      return next;
    });
    const startNodeDrag = (event: ReactPointerEvent<HTMLDivElement>, node: NodeGraphNode) => {
      const o = latest.current;
      event.stopPropagation();
      o.setGroupMessage('');
      if ((event.shiftKey || event.ctrlKey || event.metaKey) && o.onToggleNodeSelection && event.button === 0) {
        o.onToggleNodeSelection(node.id);
        o.suppressNextClickRef.current = true;
        return;
      }
      const dragsSelection = o.multiSelection.size > 1 && o.multiSelection.has(node.id);
      // Re-selecting the sole selected card re-renders the whole editor for nothing.
      if (!dragsSelection && node.id !== o.soleSelectionRef.current) o.onSelectNode(node.id);
      if (event.button !== 0) return;
      o.state.gestureRef.current = {
        pointerId: event.pointerId, nodeId: node.id, clientX: event.clientX, clientY: event.clientY, moved: false,
        members: (dragsSelection ? [...o.multiSelection] : [node.id]).flatMap(memberId => {
          const member = o.nodesByIdRef.current?.get(memberId);
          return member ? [{ nodeId: memberId, startX: member.layout.x, startY: member.layout.y }] : [];
        }),
        groupId: !dragsSelection ? o.graph.groups?.find(group => group.collapsed && group.proxyId === node.id)?.id : undefined,
      };
      // Cards may remount while dragging; the canvas element stays.
      (o.canvasRef.current ?? event.currentTarget).setPointerCapture(event.pointerId);
    };
    const startGroupDrag = (event: ReactPointerEvent<HTMLDivElement>, groupId: string) => {
      const o = latest.current;
      event.stopPropagation();
      if (event.button !== 0 || (event.target as Element).closest('button')) return;
      event.preventDefault();
      const members = [...groupPlacementMembers(o.placement, groupId)].flatMap(id => {
        const node = o.nodesByIdRef.current?.get(id);
        return node ? [{ nodeId: id, startX: node.layout.x, startY: node.layout.y }] : [];
      });
      if (!members.length) return;
      o.setSelectedEdgeId(null);
      o.state.gestureRef.current = { pointerId: event.pointerId, nodeId: members[0].nodeId, groupId,
        clientX: event.clientX, clientY: event.clientY, members, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    };
    const handleNodePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
      const o = latest.current, gesture = o.state.gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const zoom = o.visualViewportRef.current?.zoom ?? 1;
      const deltaX = (event.clientX - gesture.clientX) / zoom, deltaY = (event.clientY - gesture.clientY) / zoom;
      if (!gesture.moved && Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY) < 3) return;
      if (!gesture.moved) o.state.setNodeDragging(true);
      gesture.moved = true;
      gesture.delta = { x: deltaX, y: deltaY };
      // Group frames and headers are DOM, so group drags keep the React path.
      if (!gesture.groupId && o.dragChannel.current?.({ nodeIds: gesture.members.map(member => member.nodeId), dx: deltaX, dy: deltaY })) return;
      o.state.setDraftLayouts(current => ({ ...current, ...Object.fromEntries(gesture.members.map(member => [member.nodeId,
        { x: Math.round(member.startX + deltaX), y: Math.round(member.startY + deltaY) }])) }));
    };
    const finishNodeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
      const o = latest.current, gesture = o.state.gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const moves = gesture.moved && event.type === 'pointerup'
        ? gesture.members.map(member => ({ nodeId: member.nodeId,
            layout: { x: Math.round(member.startX + (gesture.delta?.x ?? 0)), y: Math.round(member.startY + (gesture.delta?.y ?? 0)) } }))
        : [];
      try {
        const ids = moves.map(move => move.nodeId);
        const target = moves.length && !gesture.groupId && o.onTransferNodes && hasUnlockedSource(o.graph, o.placement, ids)
          ? nodeGroupDropTarget(o.graph, o.spacedNodes, o.placement, ids, o.getGraphPoint(event.clientX, event.clientY)) : undefined;
        const placed = target ? placeTransferredNodes(o.graph, o.spacedNodes, target, moves) : moves;
        if (moves.length) o.commitPlacement(placed, gesture.groupId, gesture.groupId ? undefined : () => {
          if (target && o.onTransferNodes) return o.onTransferNodes(ids, target);
          const domainMoves = moves.map(move => ({ ...move, layout: { x: Math.round(move.layout.x / o.layoutScaleX), y: move.layout.y } }));
          if (domainMoves.length > 1 && o.onMoveNodes) o.onMoveNodes(domainMoves);
          else for (const move of domainMoves) o.onMoveNode?.(move.nodeId, move.layout);
        });
      } catch (error) { o.setGroupMessage(error instanceof Error ? error.message : String(error)); }
      if (gesture.moved && gesture.members.length > 1 && !gesture.groupId) o.suppressNextClickRef.current = true;
      o.state.gestureRef.current = null;
      // Committed positions reach the painter with a later scene; hold the dropped cards until then.
      o.dragChannel.current?.(null, moves.length > 0);
      o.state.setNodeDragging(false);
      clearDraft(gesture.members);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    const handleNodeClick = (nodeId: string) => {
      const o = latest.current;
      if (o.suppressNextClickRef.current) { o.suppressNextClickRef.current = false; return; }
      if (nodeId !== o.soleSelectionRef.current) o.onSelectNode(nodeId);
    };
    return { startNodeDrag, startGroupDrag, handleNodePointerMove, finishNodeDrag, handleNodeClick };
  }, []);
}
