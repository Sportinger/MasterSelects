/** In-memory diagnostics only; reading metrics never triggers a projection. */
export interface CompositionGraphMetrics {
  count: number;
  lastMs: number;
  totalMs: number;
  maxMs: number;
  nodeCount: number;
  edgeCount: number;
}

const counters: CompositionGraphMetrics = import.meta.hot?.data?.compositionGraphMetrics
  ?? { count: 0, lastMs: 0, totalMs: 0, maxMs: 0, nodeCount: 0, edgeCount: 0 };

export function measureCompositionProjection<T extends { nodes: unknown[]; edges: unknown[] }>(fn: () => T): T {
  if (!import.meta.env.DEV) return fn();
  const start = performance.now();
  const graph = fn();
  const elapsed = performance.now() - start;
  counters.count++;
  counters.lastMs = elapsed;
  counters.totalMs += elapsed;
  counters.maxMs = Math.max(counters.maxMs, elapsed);
  counters.nodeCount = graph.nodes.length;
  counters.edgeCount = graph.edges.length;
  return graph;
}

export function getCompositionGraphMetrics(): CompositionGraphMetrics { return { ...counters }; }

export function resetCompositionGraphMetrics(): void {
  Object.assign(counters, { count: 0, lastMs: 0, totalMs: 0, maxMs: 0, nodeCount: 0, edgeCount: 0 });
}

if (import.meta.hot) {
  import.meta.hot.dispose(data => { data.compositionGraphMetrics = counters; });
  import.meta.hot.accept();
}
