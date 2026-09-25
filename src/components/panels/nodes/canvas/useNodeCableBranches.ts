import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { NodeCableBranch, NodeGraphConnectionRequest } from '../../../../types/nodeGraph';
import { describeNodePort } from '../../../../services/nodeGraph/nodePortPresentation';
import { startBatch, endBatch } from '../../../../stores/historyStore';
import type { NodeGraphPoint } from './canvasGeometry';
import type { NodeMarqueeRect } from './useNodeMarqueeSelection';
import type { CanvasBranch } from './rendering/nodeCanvasTypes';
import type { NodeCanvasDragChannel } from './rendering/canvasNodeDrag';
import { addBranchTarget, branchCableId, branchOfCable, insertCableBranch, removeCableBranches, type ResolvedCableBranches, type RoutedCable } from './cableBranches';

type Branches = Record<string, NodeCableBranch>;
export interface CableMenuState { cableId: string; clientX: number; clientY: number; point: NodeGraphPoint }
interface MoveGesture { pointerId: number; start: NodeGraphPoint; ids: string[]; delta?: NodeGraphPoint }

interface Options {
  branches: Branches | undefined;
  resolved: ResolvedCableBranches;
  cables: readonly RoutedCable[];
  commit: (branches: Branches, label: string) => void;
  getGraphPoint: (clientX: number, clientY: number) => NodeGraphPoint;
  dragChannel: RefObject<NodeCanvasDragChannel | null>;
  canvas: RefObject<HTMLDivElement | null>;
  onConnectPorts?: (connection: NodeGraphConnectionRequest) => void;
}

/** Selection, moves and edits of presentation-only cable branch points. */
export function useNodeCableBranches({ branches, resolved, cables, commit, getGraphPoint, dragChannel, canvas, onConnectPorts }: Options) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [menu, setMenu] = useState<CableMenuState | null>(null);
  const gesture = useRef<MoveGesture | null>(null);
  const latest = useRef({ branches: branches ?? {}, resolved, cables, commit, getGraphPoint, onConnectPorts, selected });
  latest.current = { branches: branches ?? {}, resolved, cables, commit, getGraphPoint, onConnectPorts, selected };


  const sceneBranches = useMemo<CanvasBranch[]>(() => {
    const colors = new Map(cables.filter(cable => cable.toBranch).map(cable => [cable.toBranch!, describeNodePort(cable.output.port).color]));
    return [...resolved.live].flatMap(([id, branch]) => colors.has(id) ? [{ id, x: branch.x, y: branch.y, color: colors.get(id)!, selected: selected.has(id) }] : []);
  }, [cables, resolved, selected]);

  const insertAt = useCallback((cableId: string | null, point: NodeGraphPoint) => {
    const { cables: routed, branches: current, commit: save } = latest.current;
    const cable = cableId ? routed.find(item => item.id === cableId) : undefined;
    if (!cable || cable.edge?.readOnly) return false;
    save(insertCableBranch(current, cable, point), 'Add cable branch point');
    return true;
  }, []);
  const remove = useCallback((ids: Iterable<string>) => {
    const set = new Set(ids);
    if (!set.size) return;
    latest.current.commit(removeCableBranches(latest.current.branches, set), 'Remove cable branch point');
    setSelected(current => new Set([...current].filter(id => !set.has(id))));
  }, []);
  // Clicking anywhere else on the canvas clears the point selection.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const clear = (event: PointerEvent) => {
      if (!event.shiftKey && !(event.target as Element).closest('.node-workspace-branch')) setSelected(current => current.size ? new Set() : current);
    };
    // Delete removes selected points first; cards are only deleted once no point is selected.
    const key = (event: KeyboardEvent) => {
      const ids = latest.current.selected;
      if ((event.key !== 'Delete' && event.key !== 'Backspace') || !ids.size || (event.target as Element).closest('input, textarea, select, [contenteditable]')) return;
      event.preventDefault(); event.stopPropagation(); remove(ids);
    };
    element.addEventListener('pointerdown', clear, true);
    element.addEventListener('keydown', key, true);
    return () => { element.removeEventListener('pointerdown', clear, true); element.removeEventListener('keydown', key, true); };
  }, [canvas, remove]);
  const connect = useCallback((id: string, connection: NodeGraphConnectionRequest) => {
    const batch = startBatch('Branch cable');
    try {
      latest.current.onConnectPorts?.(connection);
      latest.current.commit(addBranchTarget(latest.current.branches, id, { nodeId: connection.toNodeId, portId: connection.toPortId }), 'Branch cable');
    } finally { if (batch.opened) endBatch(); }
  }, []);
  const selectInRect = useCallback((rect: NodeMarqueeRect) => {
    const ids = [...latest.current.resolved.live].filter(([, branch]) => branch.x >= rect.left && branch.x <= rect.left + rect.width
      && branch.y >= rect.top && branch.y <= rect.top + rect.height).map(([id]) => id);
    setSelected(current => ids.length === current.size && ids.every(id => current.has(id)) ? current : new Set(ids));
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const openMenu = useCallback((cableId: string, clientX: number, clientY: number) => {
    setMenu({ cableId, clientX, clientY, point: latest.current.getGraphPoint(clientX, clientY) });
  }, []);

  const startMove = useCallback((event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const current = latest.current.selected;
    const next = event.shiftKey ? new Set(current.has(id) ? [...current].filter(item => item !== id) : [...current, id])
      : current.has(id) ? current : new Set([id]);
    setSelected(next);
    if (!next.has(id)) return;
    gesture.current = { pointerId: event.pointerId, start: latest.current.getGraphPoint(event.clientX, event.clientY), ids: [...next] };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);
  const move = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const point = latest.current.getGraphPoint(event.clientX, event.clientY);
    active.delta = { x: point.x - active.start.x, y: point.y - active.start.y };
    dragChannel.current?.({ nodeIds: [], branchIds: active.ids, dx: active.delta.x, dy: active.delta.y });
  }, [dragChannel]);
  const finish = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    gesture.current = null;
    const { delta } = active, current = latest.current.branches;
    const committed = !!delta && event.type === 'pointerup' && Math.hypot(delta.x, delta.y) > 0.5;
    if (committed) {
      const next = { ...current };
      for (const id of active.ids) if (next[id]) next[id] = { ...next[id], x: Math.round(next[id].x + delta.x), y: Math.round(next[id].y + delta.y) };
      latest.current.commit(next, active.ids.length > 1 ? 'Move cable branch points' : 'Move cable branch point');
    }
    dragChannel.current?.(null, committed); // the committed positions arrive with a later scene
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, [dragChannel]);

  const menuCable = menu ? cables.find(cable => cable.id === menu.cableId) : undefined;
  return {
    cables, sceneBranches, selected, insertAt, remove, connect, selectInRect, openMenu,
    menu: menu && menuCable ? { ...menu, cable: menuCable, trunk: branchOfCable(menu.cableId) } : null,
    closeMenu,
    handles: { branches: resolved.live, selected, onStartMove: startMove, onMove: move, onFinishMove: finish, onRemove: remove,
      onOpenMenu: (id: string, clientX: number, clientY: number) => openMenu(branchCableId(id), clientX, clientY) },
  };
}
