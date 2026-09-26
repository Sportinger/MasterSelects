import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { NodeGraph } from '../../../../types/nodeGraph';
import { FIT_MARGIN, type NodeBounds, type Viewport } from './canvasGeometry';

/** Follow membership changes using the displayed bounds of animated group frames. */
export function useNodeGrowthViewport(canvas: RefObject<HTMLDivElement | null>, graph: NodeGraph,
  bounds: NodeBounds, animating: boolean, visual: RefObject<Viewport>, fit: (bounds: NodeBounds) => void, preserveFoldView = true) {
  const known = useRef({ graphId: graph.id, ids: new Set(graph.nodes.map(node => node.id)),
    folds: new Map(graph.groups?.map(group => [group.id, !!group.collapsed])) });
  const pending = useRef<'addition' | 'removal' | null>(null);

  useEffect(() => {
    const element = canvas.current;
    const cancel = () => { pending.current = null; };
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
    const ids = new Set(graph.nodes.map(node => node.id));
    if (known.current.graphId !== graph.id || (folding && preserveFoldView)) pending.current = null;
    else if ([...known.current.ids].some(id => !ids.has(id))) pending.current = 'removal';
    else if (graph.nodes.some(node => !known.current.ids.has(node.id))) pending.current ??= 'addition';
    known.current = { graphId: graph.id, ids,
      folds: new Map(graph.groups?.map(group => [group.id, !!group.collapsed])) };
    const element = canvas.current;
    if (!pending.current || !element || !element.clientWidth || !element.clientHeight) return;
    const refit = pending.current === 'removal';
    if (!animating) pending.current = null;
    if (!graph.nodes.length) return;
    const view = visual.current;
    // Removals also reclaim empty space. Visible additions, parameter/edge
    // changes and manual moves keep the user's framing.
    if (refit || bounds.left * view.zoom + view.panX < FIT_MARGIN
      || bounds.top * view.zoom + view.panY < FIT_MARGIN
      || bounds.right * view.zoom + view.panX > element.clientWidth - FIT_MARGIN
      || bounds.bottom * view.zoom + view.panY > element.clientHeight - FIT_MARGIN) fit(bounds);
  }, [canvas, graph, bounds, animating, visual, fit, preserveFoldView]);
}
