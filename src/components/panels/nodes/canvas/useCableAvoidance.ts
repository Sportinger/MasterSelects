import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeGraphNode } from '../../../../types/nodeGraph';
import { useSettingsStore } from '../../../../stores/settingsStore';
import { getNodeHeight, NODE_WIDTH, type NodeGraphPoint } from './canvasGeometry';
import type { RoutedCable } from './cableBranches';
import { routeAroundCards, type AvoidCable, type AvoidRect } from './cableAvoidance';

interface Route { from: NodeGraphPoint; to: NodeGraphPoint; via: NodeGraphPoint[] }
/** Settle time after a layout change before cables are rerouted. */
const DEBOUNCE_MS = 120;
const same = (a: NodeGraphPoint, b: NodeGraphPoint) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

/**
 * Optional obstacle avoidance: routes are computed in a worker after the layout
 * settles and applied only while a cable's endpoints are unchanged, so moving
 * cards run direct until their reroute arrives.
 */
export function useCableAvoidance(cables: RoutedCable[], nodes: readonly NodeGraphNode[], paused: boolean): RoutedCable[] {
  const enabled = useSettingsStore(state => state.nodeCableAvoid);
  const [routes, setRoutes] = useState<ReadonlyMap<string, Route>>(() => new Map());
  const worker = useRef<Worker | null>(null), revision = useRef(0);

  useEffect(() => {
    if (!enabled) { setRoutes(current => current.size ? new Map() : current); return; }
    if (paused) return;
    const obstacles: AvoidRect[] = nodes.map(node => ({ x: node.layout.x, y: node.layout.y, width: NODE_WIDTH, height: getNodeHeight(node) }));
    const request: AvoidCable[] = cables.map(cable => ({ id: cable.id, from: cable.from, to: cable.to,
      source: cable.fromBranch ?? (cable.edge ? `${cable.edge.fromNodeId}:${cable.edge.fromPortId}` : undefined) }));
    const endpoints = new Map(cables.map(cable => [cable.id, { from: cable.from, to: cable.to }]));
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
    return () => clearTimeout(timer);
  }, [enabled, paused, cables, nodes]);

  useEffect(() => () => { worker.current?.terminate(); worker.current = null; }, []);
  useEffect(() => { if (!enabled) { worker.current?.terminate(); worker.current = null; } }, [enabled]);

  return useMemo(() => !enabled || !routes.size ? cables : cables.map(cable => {
    const route = routes.get(cable.id);
    return route && same(route.from, cable.from) && same(route.to, cable.to) ? { ...cable, via: route.via } : cable;
  }), [enabled, routes, cables]);
}
