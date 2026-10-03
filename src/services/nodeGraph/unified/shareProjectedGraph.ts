import { startNodeMeasure, endNodeMeasure } from './nodeGraphPerformance';
import type { NodeGraph } from '../../../types/nodeGraph';

/** Projection values are plain data. Compare all fields, including unknown future
 * fields, rather than maintaining a partial revision key that can hide an edit. */
function equalProjection(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && equalProjection(left[key], right[key]));
}

function shareItems<T extends { id: string }>(before: T[] | undefined, next: T[]): T[] {
  const byId = new Map(before?.map(item => [item.id, item]));
  const shared = next.map(item => {
    const old = byId.get(item.id);
    return old && equalProjection(old, item) ? old : item;
  });
  return before?.length === shared.length && shared.every((item, i) => item === before[i]) ? before : shared;
}

/** Instance-owned cache: retains only the preceding projection, never a project.
 * Work is proportional to projected data; unchanged cards/ports keep identity. */
export function shareProjectedGraph(before: NodeGraph | undefined, next: NodeGraph): NodeGraph {
  const measurement = import.meta.env.DEV ? startNodeMeasure('structural-sharing') : undefined;
  try {
  if (!before || before.id !== next.id) return next;
  return { ...next, nodes: shareItems(before.nodes, next.nodes), edges: shareItems(before.edges, next.edges),
    groups: next.groups && shareItems(before.groups, next.groups),
    expandedNodes: next.expandedNodes && shareItems(before.expandedNodes, next.expandedNodes) };
  } finally { if (import.meta.env.DEV) endNodeMeasure('structural-sharing', measurement); }
}
