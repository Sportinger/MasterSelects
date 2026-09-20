import { useState, type FocusEvent, type PointerEvent } from 'react';
import type { NodeGraphNode, NodeGraphPort } from '../../../../types/nodeGraph';

export interface HoveredNodePort { node: NodeGraphNode; port: NodeGraphPort }

/** Port labels and their outboard plug are one continuous hover/focus target. */
export function useNodePortHover(nodes: Map<string, NodeGraphNode>) {
  const [hovered, setHovered] = useState<HoveredNodePort | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const update = (target: EventTarget | null) => {
    const edge = target instanceof Element ? target.closest<HTMLElement>('.node-workspace-plug, .node-workspace-edge-group') : null;
    setHoveredEdgeId(edge?.dataset.edgeId ?? null);
    const element = target instanceof Element ? target.closest<HTMLElement>('.node-workspace-port, .node-workspace-plug') : null;
    const node = element && nodes.get(element.dataset.nodeId ?? '');
    const port = (element?.dataset.direction === 'input' ? node?.inputs : node?.outputs)?.find(p => p.id === element?.dataset.portId);
    setHovered(current => node && port
      ? current?.node === node && current.port === port ? current : { node, port }
      : null);
  };
  return {
    hoveredPort: hovered,
    hoveredEdgeId,
    portHoverEvents: {
      onPointerOver: (event: PointerEvent) => { if (event.pointerType !== 'touch') update(event.target); },
      onPointerOut: (event: PointerEvent) => { if (event.pointerType !== 'touch') update(event.relatedTarget); },
      onFocusCapture: (event: FocusEvent) => update(event.target),
      onBlurCapture: (event: FocusEvent) => update(event.relatedTarget),
    },
  };
}
