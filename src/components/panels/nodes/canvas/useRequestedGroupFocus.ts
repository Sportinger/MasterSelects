import { useEffect, useRef, type RefObject } from 'react';
import type { NodeGraph } from '../../../../types/nodeGraph';

export interface NodeGroupFocusRequest { id: string; nonce: number }

/** Inline controllers publish asynchronously. Consume the request only after
 * their expanded group has arrived and the shared fold animation has settled. */
export function useRequestedGroupFocus(canvas: RefObject<HTMLDivElement | null>, graph: NodeGraph,
  animating: boolean, request: NodeGroupFocusRequest | undefined, focus: (id: string) => void) {
  const consumed = useRef<NodeGroupFocusRequest | undefined>(undefined);
  useEffect(() => {
    const element = canvas.current;
    const cancel = () => { consumed.current = request; };
    element?.addEventListener('wheel', cancel, true);
    element?.addEventListener('pointerdown', cancel, true);
    return () => { element?.removeEventListener('wheel', cancel, true); element?.removeEventListener('pointerdown', cancel, true); };
  }, [canvas, request]);
  useEffect(() => {
    if (!request || consumed.current === request || animating) return;
    const group = graph.groups?.find(group => group.id === request.id);
    // A request may also name a single node (e.g. a selected transition); it waits until that node is displayed.
    if (group ? group.collapsed || !graph.nodes.some(node => group.nodeIds.includes(node.id))
      : !graph.nodes.some(node => node.id === request.id)) return;
    const element = canvas.current;
    if (!element?.clientWidth || !element.clientHeight) return;
    consumed.current = request;
    focus(request.id);
  }, [canvas, graph, animating, request, focus]);
}
