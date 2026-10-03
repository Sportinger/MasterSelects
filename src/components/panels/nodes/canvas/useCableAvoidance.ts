import { nodeDurationMeasure, startNodeMeasure, endNodeMeasure } from '../../../../services/nodeGraph/unified/nodeGraphPerformance';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeGraph, NodeGraphNode } from '../../../../types/nodeGraph';
import { useSettingsStore } from '../../../../stores/settingsStore';
import { getNodeHeight, getNodeWidth, type NodeGraphPoint, type NodeBounds } from './canvasGeometry';
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
  const shift = (value: number, start: number, end: number, first: number, last: number) => {
    const weight = Math.abs(end - start) > 0.001 ? Math.max(0, Math.min(1, (value - start) / (end - start))) : 0.5;
    return value + first * (1 - weight) + last * weight;
  };
  return route.via.map(point => {
    // Equal X coordinates stay equal (a vertical lane); equal Y coordinates
    // stay equal (a horizontal run) while the two ports move independently.
    return { x: shift(point.x, route.from.x, route.to.x, fromDx, toDx),
      y: shift(point.y, route.from.y, route.to.y, fromDy, toDy) };
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

  const previousGeometry = useRef<{ key: string; obstacles: AvoidRect[]; request: AvoidCable[] } | undefined>(undefined);
  const geometry = useMemo(() => {
    const measurement = import.meta.env.DEV ? startNodeMeasure('routing-geometry') : undefined;
    try {
    const obstacles: AvoidRect[] = nodes.map(node => ({ x: node.layout.x, y: node.layout.y, width: getNodeWidth(node), height: getNodeHeight(node) }));
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
    const key = JSON.stringify([obstacles, request]);
    if (previousGeometry.current?.key === key) return previousGeometry.current;
    return previousGeometry.current = { key, obstacles, request };
    } finally { if (import.meta.env.DEV) endNodeMeasure('routing-geometry', measurement); }
  }, [nodes, cables, groups, groupBounds]);

  useEffect(() => {
    if (!enabled) { setRoutes(current => current.size ? new Map() : current); return; }
    if (paused) return;
    const { obstacles, request } = geometry;
    const endpoints = new Map(request.map(cable => [cable.id, { from: cable.from, to: cable.to, laneX: cable.laneX }]));
    const id = ++revision.current;
    const apply = (entries: Array<[string, NodeGraphPoint[]]>) => {
      if (id !== revision.current) return;
      setRoutes(new Map(entries.flatMap(([cableId, via]) => { const ends = endpoints.get(cableId); return ends ? [[cableId, { ...ends, via }]] : []; })));
    };
    const timer = setTimeout(() => {
      if (typeof Worker === 'undefined') {
        const measurement = import.meta.env.DEV ? startNodeMeasure('routing-avoid') : undefined;
        apply([...routeAroundCards(obstacles, request)]);
        if (import.meta.env.DEV) endNodeMeasure('routing-avoid', measurement, { backend: 'main' });
        return;
      }
      worker.current ??= new Worker(new URL('./cableAvoidance.worker.ts', import.meta.url), { type: 'module' });
      worker.current.onmessage = (event: MessageEvent<{ revision: number; duration?: number; routes: Array<[string, NodeGraphPoint[]]> }>) => {
        if (import.meta.env.DEV && event.data.duration !== undefined) nodeDurationMeasure('routing-avoid', event.data.duration, { backend: 'worker' });
        if (event.data.revision === revision.current) apply(event.data.routes);
      };
      worker.current.postMessage({ revision: id, obstacles, cables: request });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); revision.current++; };
  }, [enabled, paused, geometry]);

  useEffect(() => () => { worker.current?.terminate(); worker.current = null; }, []);
  useEffect(() => { if (!enabled) { worker.current?.terminate(); worker.current = null; } }, [enabled]);

  return useMemo(() => !enabled || dragging || !routes.size ? cables : cables.map(cable => {
    const route = routes.get(cable.id);
    return route && route.laneX === cable.laneX ? { ...cable, via: followEndpoints(route, cable) } : cable;
  }), [enabled, dragging, routes, cables]);
}
