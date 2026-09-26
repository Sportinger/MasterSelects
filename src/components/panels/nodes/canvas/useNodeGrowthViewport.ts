import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { NodeGraph } from '../../../../types/nodeGraph';
import type { NodeBounds } from './canvasGeometry';

const connectionIds = (graph: NodeGraph) => new Set(graph.edges.map(edge =>
  JSON.stringify([edge.id, edge.fromNodeId, edge.fromPortId, edge.toNodeId, edge.toPortId])));

/** Follow membership changes using the displayed bounds of animated group frames. */
export function useNodeGrowthViewport(canvas: RefObject<HTMLDivElement | null>, graph: NodeGraph,
  bounds: NodeBounds, animating: boolean, fit: (bounds: NodeBounds) => void, preserveFoldView = true) {
  const known = useRef({ graphId: graph.id, ids: new Set(graph.nodes.map(node => node.id)),
    links: connectionIds(graph), folds: new Map(graph.groups?.map(group => [group.id, !!group.collapsed])) });
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
    const ids = new Set(graph.nodes.map(node => node.id));
    const links = connectionIds(graph);
    if (known.current.graphId !== graph.id || (folding && preserveFoldView)) pending.current = false;
    else if (ids.size !== known.current.ids.size || [...ids].some(id => !known.current.ids.has(id))
      || links.size !== known.current.links.size || [...links].some(id => !known.current.links.has(id))) pending.current = true;
    known.current = { graphId: graph.id, ids, links,
      folds: new Map(graph.groups?.map(group => [group.id, !!group.collapsed])) };
    const element = canvas.current;
    if (!pending.current || !element || !element.clientWidth || !element.clientHeight) return;
    if (!animating) pending.current = false;
    if (!graph.nodes.length) return;
    // Always use the available canvas after structural changes. Streamed cables
    // can reflow the graph after the last node has already arrived.
    fit(bounds);
  }, [canvas, graph, bounds, animating, fit, preserveFoldView]);
}
