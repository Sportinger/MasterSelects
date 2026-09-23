import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { NodeGraph } from '../../../../types/nodeGraph';
import type { NodeBounds, Viewport } from './canvasGeometry';
import { fittedNodeViewport } from './useNodeGraphViewport';
import { NODE_LAYOUT_DURATION } from './nodeLayoutTransition';

/** Follow the displayed bounds of every intermediate fold, never just the final
 * destination. A manual gesture immediately releases camera ownership. */
export function useNodeFoldViewport(canvas: RefObject<HTMLDivElement | null>, source: NodeGraph, target: NodeGraph,
  shown: NodeGraph, bounds: NodeBounds, animating: boolean, visual: RefObject<Viewport>, setViewport: (next: Viewport) => void,
  groupBounds?: ReadonlyMap<string, NodeBounds>) {
  const savedViews = useRef(new Map<string, Viewport>());
  const pending = useRef<{ graph: NodeGraph; collapsed: boolean; groupId?: string; restore?: Viewport; from: Viewport; started: number; width: number; height: number; automatic?: boolean } | null>(null);
  const previousFolds = useRef({ graph: source, states: new Map(source.groups?.map(group => [group.id, !!group.collapsed])) });
  const sourceFoldsChanged = previousFolds.current.graph.id === source.id && !!source.groups?.some(group =>
    previousFolds.current.states.has(group.id) && previousFolds.current.states.get(group.id) !== !!group.collapsed);
  const cancel = useCallback(() => { pending.current = null; }, []);
  const forget = useCallback(() => { cancel(); savedViews.current.clear(); }, [cancel]);
  useEffect(forget, [source.id, forget]);
  const request = useCallback((collapsed: boolean, groupId?: string) => {
    const element = canvas.current;
    if (!element) return;
    const restore = groupId && collapsed ? savedViews.current.get(groupId) : undefined;
    if (groupId) {
      if (collapsed) savedViews.current.delete(groupId);
      else savedViews.current.set(groupId, { ...visual.current });
    } else savedViews.current.clear();
    // Read before React moves hundreds of cards. Reading these dimensions after
    // each commit forces a synchronous browser layout during the animation.
    pending.current = { graph: source, collapsed, groupId, restore, from: { ...visual.current }, started: performance.now(),
      width: element.clientWidth, height: element.clientHeight };
  }, [source, visual, canvas]);
  useEffect(() => {
    const element = canvas.current;
    element?.addEventListener('wheel', cancel, true);
    element?.addEventListener('pointerdown', cancel, true);
    return () => { element?.removeEventListener('wheel', cancel, true); element?.removeEventListener('pointerdown', cancel, true); };
  }, [canvas, cancel]);
  useLayoutEffect(() => {
    if (sourceFoldsChanged && !pending.current) {
      const element = canvas.current;
      if (element) pending.current = { graph: previousFolds.current.graph, collapsed: false, automatic: true,
        from: { ...visual.current }, started: performance.now(), width: element.clientWidth, height: element.clientHeight };
    }
    previousFolds.current = { graph: source, states: new Map(source.groups?.map(group => [group.id, !!group.collapsed])) };
    const follow = pending.current, element = canvas.current;
    if (!follow || !element || follow.graph === source) return;
    const matches = follow.automatic ? true : follow.groupId ? target.groups?.some(group => group.id === follow.groupId && !!group.collapsed === follow.collapsed)
      : target.groups?.every(group => !!group.collapsed === follow.collapsed);
    if (follow.graph.id !== source.id || !matches) { cancel(); return; }
    const finished = !animating && shown === target;
    const progress = finished || matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 1 : Math.min(1, (performance.now() - follow.started) / NODE_LAYOUT_DURATION);
    const t = 1 - (1 - progress) ** 3;
    const focusBounds = follow.groupId && !follow.collapsed ? groupBounds?.get(follow.groupId) : bounds;
    if (!focusBounds) { if (finished) cancel(); return; }
    const fit = follow.restore ?? fittedNodeViewport(focusBounds, follow.width, follow.height);
    if (follow.automatic) {
      const current = visual.current, amount = finished ? 1 : 0.28;
      setViewport({ zoom: current.zoom + (fit.zoom - current.zoom) * amount,
        panX: current.panX + (fit.panX - current.panX) * amount,
        panY: current.panY + (fit.panY - current.panY) * amount });
      if (finished) cancel();
      return;
    }
    setViewport({ zoom: follow.from.zoom + (fit.zoom - follow.from.zoom) * t,
      panX: follow.from.panX + (fit.panX - follow.from.panX) * t,
      panY: follow.from.panY + (fit.panY - follow.from.panY) * t });
    if (finished) cancel();
  }, [source, target, shown, bounds, groupBounds, animating, canvas, cancel, setViewport, sourceFoldsChanged, visual]);
  return { request, cancel, forget, following: pending.current !== null || sourceFoldsChanged };
}
