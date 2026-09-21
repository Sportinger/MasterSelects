import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { NodeGraph } from '../../../../types/nodeGraph';
import type { NodeBounds, Viewport } from './canvasGeometry';
import { fittedNodeViewport } from './useNodeGraphViewport';
import { NODE_LAYOUT_DURATION } from './nodeLayoutTransition';

/** Follow the displayed bounds of every intermediate fold, never just the final
 * destination. A manual gesture immediately releases camera ownership. */
export function useNodeFoldViewport(canvas: RefObject<HTMLDivElement | null>, source: NodeGraph, target: NodeGraph,
  shown: NodeGraph, bounds: NodeBounds, animating: boolean, visual: RefObject<Viewport>, setViewport: (next: Viewport) => void) {
  const pending = useRef<{ graph: NodeGraph; collapsed: boolean; from: Viewport; started: number; width: number; height: number } | null>(null);
  const cancel = useCallback(() => { pending.current = null; }, []);
  const request = useCallback((collapsed: boolean) => {
    const element = canvas.current;
    if (!element) return;
    // Read before React moves hundreds of cards. Reading these dimensions after
    // each commit forces a synchronous browser layout during the animation.
    pending.current = { graph: source, collapsed, from: visual.current, started: performance.now(),
      width: element.clientWidth, height: element.clientHeight };
  }, [source, visual, canvas]);
  useEffect(() => {
    const element = canvas.current;
    element?.addEventListener('wheel', cancel, true);
    element?.addEventListener('pointerdown', cancel, true);
    return () => { element?.removeEventListener('wheel', cancel, true); element?.removeEventListener('pointerdown', cancel, true); };
  }, [canvas, cancel]);
  useLayoutEffect(() => {
    const follow = pending.current, element = canvas.current;
    if (!follow || !element || follow.graph === source) return;
    if (follow.graph.id !== source.id || !target.groups?.every(group => !!group.collapsed === follow.collapsed)) { cancel(); return; }
    const finished = !animating && shown === target;
    const progress = finished || matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 1 : Math.min(1, (performance.now() - follow.started) / NODE_LAYOUT_DURATION);
    const t = 1 - (1 - progress) ** 3;
    const fit = fittedNodeViewport(bounds, follow.width, follow.height);
    setViewport({ zoom: follow.from.zoom + (fit.zoom - follow.from.zoom) * t,
      panX: follow.from.panX + (fit.panX - follow.from.panX) * t,
      panY: follow.from.panY + (fit.panY - follow.from.panY) * t });
    if (finished) cancel();
  }, [source, target, shown, bounds, animating, canvas, cancel, setViewport]);
  return { request, cancel };
}
