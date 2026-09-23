import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { NodeGraph } from '../../../../types/nodeGraph';
import { FIT_MARGIN, type NodeBounds, type Viewport } from './canvasGeometry';

/** Reframe additions once their placement settles, without undoing manual navigation. */
export function useNodeGrowthViewport(canvas: RefObject<HTMLDivElement | null>, graph: NodeGraph,
  bounds: NodeBounds, animating: boolean, visual: RefObject<Viewport>, fit: (bounds: NodeBounds) => void, preserveFoldView = true) {
  const known = useRef({ graphId: graph.id, ids: new Set(graph.nodes.map(node => node.id)),
    folds: new Map(graph.groups?.map(group => [group.id, !!group.collapsed])) });
  const pending = useRef(false);

  useEffect(() => {
    const element = canvas.current;
    const cancel = () => { pending.current = false; };
    element?.addEventListener('wheel', cancel, true);
    element?.addEventListener('pointerdown', cancel, true);
    return () => {
      element?.removeEventListener('wheel', cancel, true);
      element?.removeEventListener('pointerdown', cancel, true);
    };
  }, [canvas]);

  useLayoutEffect(() => {
    const folding = graph.groups?.some(group => known.current.folds.has(group.id)
      && known.current.folds.get(group.id) !== !!group.collapsed);
    if (known.current.graphId !== graph.id || (folding && preserveFoldView)) pending.current = false;
    else if (graph.nodes.some(node => !known.current.ids.has(node.id))) pending.current = true;
    known.current = { graphId: graph.id, ids: new Set(graph.nodes.map(node => node.id)),
      folds: new Map(graph.groups?.map(group => [group.id, !!group.collapsed])) };
    const element = canvas.current;
    if (!pending.current || animating || !element || !element.clientWidth || !element.clientHeight) return;
    pending.current = false;
    const view = visual.current;
    // Keep the current view when additions already fit. Parameter/edge changes,
    // removals and manual moves alone never trigger a camera reset.
    if (bounds.left * view.zoom + view.panX < FIT_MARGIN
      || bounds.top * view.zoom + view.panY < FIT_MARGIN
      || bounds.right * view.zoom + view.panX > element.clientWidth - FIT_MARGIN
      || bounds.bottom * view.zoom + view.panY > element.clientHeight - FIT_MARGIN) fit(bounds);
  }, [canvas, graph, bounds, animating, visual, fit, preserveFoldView]);
}
