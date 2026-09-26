import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeGraph, NodeGraphNode } from '../../../../types/nodeGraph';
import { useSettingsStore } from '../../../../stores/settingsStore';
import { getNodeHeight, NODE_WIDTH, type NodeGraphPoint, type NodeBounds } from './canvasGeometry';
import type { RoutedCable } from './cableBranches';
import { routeAroundCards, type AvoidCable, type AvoidRect } from './cableAvoidance';

interface Route { from: NodeGraphPoint; to: NodeGraphPoint; via: NodeGraphPoint[]; laneX?: number }
/** Settle time after a layout change before cables are rerouted. */
const DEBOUNCE_MS = 120;
const same = (a: NodeGraphPoint, b: NodeGraphPoint) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

/** Carry the last route with moving ports until the obstacle worker has a new one.
 * This keeps unchanged links on their established lane during layout animation. */
function followEndpoints(route: Route, cable: RoutedCable): NodeGraphPoint[] {
  if (same(route.from, cable.from) && same(route.to, cable.to)) return route.via;
  const fromDx = cable.from.x - route.from.x, fromDy = cable.from.y - route.from.y;
  const toDx = cable.to.x - route.to.x, toDy = cable.to.y - route.to.y;
  return route.via.map((point, index) => {
    const weight = (index + 1) / (route.via.length + 1);
    return { x: point.x + fromDx * (1 - weight) + toDx * weight,
      y: point.y + fromDy * (1 - weight) + toDy * weight };
  });
}

/**
 * Optional obstacle avoidance: routes are computed in a worker after the layout
 * settles. Existing routes follow animated endpoints until their reroute arrives;
 * a pointer-dragged card still uses the direct interactive cable.
 */
export function useCableAvoidance(cables: RoutedCable[], nodes: readonly NodeGraphNode[], paused: boolean,
  groupBounds?: ReadonlyMap<string, NodeBounds>, groups?: NodeGraph['groups'], dragging = false): RoutedCable[] {
  const enabled = useSettingsStore(state => state.nodeCableAvoid);
  const [routes, setRoutes] = useState<ReadonlyMap<string, Route>>(() => new Map());
  const worker = useRef<Worker | null>(null), revision = useRef(0);

  useEffect(() => {
    if (!enabled) { setRoutes(current => current.size ? new Map() : current); return; }
    if (paused) return;
    const obstacles: AvoidRect[] = nodes.map(node => ({ x: node.layout.x, y: node.layout.y, width: NODE_WIDTH, height: getNodeHeight(node) }));
    const members = (id: string): string[] => {
      const group = groups?.find(candidate => candidate.id === id);
      return [...new Set([...(group?.nodeIds ?? []), ...(groups ?? []).filter(child => child.parentId === id).flatMap(child => members(child.id))])];
    };
    for (const group of groups ?? []) {
      const bounds = groupBounds?.get(group.id);
      if (group.collapsed || !bounds) continue;
      obstacles.push({ groupId: group.id, nodeIds: members(group.id), x: bounds.left, y: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top });
    }
    const request: AvoidCable[] = cables.map(cable => ({ id: cable.id, from: cable.from, to: cable.to, fromNode: cable.fromNode, toNode: cable.toNode, laneX: cable.laneX,
      source: cable.fromBranch ?? (cable.edge ? `${cable.edge.fromNodeId}:${cable.edge.fromPortId}` : undefined) }));
    const endpoints = new Map(cables.map(cable => [cable.id, { from: cable.from, to: cable.to, laneX: cable.laneX }]));
    const id = ++revision.current;
    const apply = (entries: Array<[string, NodeGraphPoint[]]>) => {
      if (id !== revision.current) return;
      setRoutes(new Map(entries.flatMap(([cableId, via]) => { const ends = endpoints.get(cableId); return ends ? [[cableId, { ...ends, via }]] : []; })));
    };
    const timer = setTimeout(() => {
      if (typeof Worker === 'undefined') { apply([...routeAroundCards(obstacles, request)]); return; }
      worker.current ??= new Worker(new URL('./cableAvoidance.worker.ts', import.meta.url), { type: 'module' });
      worker.current.onmessage = (event: MessageEvent<{ revision: number; routes: Array<[string, NodeGraphPoint[]]> }>) => {
        if (event.data.revision === revision.current) apply(event.data.routes);
      };
      worker.current.postMessage({ revision: id, obstacles, cables: request });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); revision.current++; };
  }, [enabled, paused, cables, nodes, groupBounds, groups]);

  useEffect(() => () => { worker.current?.terminate(); worker.current = null; }, []);
  useEffect(() => { if (!enabled) { worker.current?.terminate(); worker.current = null; } }, [enabled]);

  return useMemo(() => !enabled || dragging || !routes.size ? cables : cables.map(cable => {
    const route = routes.get(cable.id);
    return route && route.laneX === cable.laneX ? { ...cable, via: followEndpoints(route, cable) } : cable;
  }), [enabled, dragging, routes, cables]);
}
