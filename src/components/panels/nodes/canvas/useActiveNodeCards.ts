import { useCallback, useMemo, useRef, useState } from 'react';
import type { NodeGraphNode } from '../../../../types/nodeGraph';
import { getNodeHeight, NODE_WIDTH, type NodeGraphPoint } from './canvasGeometry';
import type { ConnectionPlug } from './connectionPlugs';

/** Graph units around a card that still count as hovering it. */
const CARD_MARGIN = 8;
/** Graph units around a plug segment that count as hovering its card. */
const PLUG_MARGIN = 12;

/** Topmost card (or card owning a plug) under a graph point. */
export function nodeUnderPoint(point: NodeGraphPoint, nodes: readonly NodeGraphNode[], plugs: readonly ConnectionPlug[]): string | null {
  for (let index = nodes.length - 1; index >= 0; index--) {
    const { id, layout } = nodes[index], node = nodes[index];
    if (point.x >= layout.x - CARD_MARGIN && point.x <= layout.x + NODE_WIDTH + CARD_MARGIN
      && point.y >= layout.y - CARD_MARGIN && point.y <= layout.y + getNodeHeight(node) + CARD_MARGIN) return id;
  }
  for (const { node, center, tip } of plugs) {
    if (Math.abs(point.y - center.y) <= PLUG_MARGIN && point.x >= Math.min(center.x, tip.x) - PLUG_MARGIN
      && point.x <= Math.max(center.x, tip.x) + PLUG_MARGIN) return node.id;
  }
  return null;
}

/**
 * In canvas mode every card is one focusable hit target; only active cards
 * (hovered, focused, selected) mount their ports, buttons and editors. The
 * pointer is tracked geometrically, so it also works under pointer capture
 * while a connection is dragged over other cards.
 */
export function useActiveNodeCards(nodes: readonly NodeGraphNode[], plugs: readonly ConnectionPlug[], getGraphPoint: (x: number, y: number) => NodeGraphPoint) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<ReadonlySet<string>>(() => new Set());
  const latest = useRef({ nodes, plugs, getGraphPoint });
  latest.current = { nodes, plugs, getGraphPoint };
  const track = useCallback((clientX: number, clientY: number) => {
    const { nodes: current, plugs: grips, getGraphPoint: toGraph } = latest.current;
    const id = nodeUnderPoint(toGraph(clientX, clientY), current, grips);
    setHovered(previous => previous === id ? previous : id);
  }, []);
  const leave = useCallback(() => setHovered(null), []);
  const setFocus = useCallback((id: string, active: boolean) => setFocused(current => {
    if (current.has(id) === active) return current;
    const next = new Set(current);
    if (active) next.add(id); else next.delete(id);
    return next;
  }), []);
  const active = useMemo(() => new Set([...focused, ...(hovered ? [hovered] : [])]), [focused, hovered]);
  return { active, track, leave, setFocus };
}
