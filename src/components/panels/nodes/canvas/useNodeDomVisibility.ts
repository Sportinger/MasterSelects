import { useMemo, useRef } from 'react';
import type { NodeGraphNode } from '../../../../types/nodeGraph';
import type { NodeBounds } from './canvasGeometry';
import type { ConnectionPlug } from './connectionPlugs';
import { cableDomVisible, intersectsNodeDomView, nodeDomVisible } from './nodeDomVisibility';

function useStableMembers<T>(next: T[]): T[] {
  const previous = useRef(next);
  if (previous.current.length !== next.length || next.some((item, index) => item !== previous.current[index])) previous.current = next;
  return previous.current;
}

/** Pan coordinates must not invalidate memoized DOM subtrees unless membership changes. */
export function useNodeDomVisibility(nodes: NodeGraphNode[], plugs: ConnectionPlug[], view: NodeBounds | null) {
  const candidates = useMemo(() => {
    const visibleNodes = nodes.filter(node => nodeDomVisible(node, view));
    const visiblePlugs = plugs.filter(({ center, tip }) => intersectsNodeDomView(view, {
      left: Math.min(center.x, tip.x) - 12, right: Math.max(center.x, tip.x) + 12, top: center.y - 12, bottom: center.y + 12,
    })).map(plug => `${plug.edge.id}:${plug.port.direction}`);
    const endpoints = new Map<string, { input?: ConnectionPlug; output?: ConnectionPlug }>();
    for (const plug of plugs) {
      const pair = endpoints.get(plug.edge.id) ?? {};
      pair[plug.port.direction] = plug; endpoints.set(plug.edge.id, pair);
    }
    const visibleEdges = [...endpoints].filter(([, pair]) => pair.input && pair.output && cableDomVisible(pair.output.tip, pair.input.tip, view)).map(([id]) => id);
    return { visibleNodes, visiblePlugs, visibleEdges };
  }, [nodes, plugs, view]);
  const visibleNodes = useStableMembers(candidates.visibleNodes);
  const visiblePlugs = useStableMembers(candidates.visiblePlugs);
  const visibleEdges = useStableMembers(candidates.visibleEdges);
  const nodeIds = useMemo(() => new Set(visibleNodes.map(node => node.id)), [visibleNodes]);
  const plugIds = useMemo(() => new Set(visiblePlugs), [visiblePlugs]);
  const edgeIds = useMemo(() => new Set(visibleEdges), [visibleEdges]);
  return { nodes: visibleNodes, nodeIds, plugIds, edgeIds };
}
