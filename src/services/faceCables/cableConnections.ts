import type { FaceCableConfig } from './cableData';
import type { CablePoint, CableState } from './cablePhysics';

/** Parent-first order, independent of display order. Reject broken graphs before simulation. */
export function cableSimulationOrder(configs: FaceCableConfig[]): number[] {
  const indices = new Map(configs.map((c, i) => [c.id, i]));
  if (indices.size !== configs.length) throw new Error('Cable IDs must be unique.');
  const visiting = new Set<number>(), visited = new Set<number>(), order: number[] = [];
  const visit = (index: number) => {
    if (visiting.has(index)) throw new Error('Cable connections cannot form a cycle.');
    if (visited.has(index)) return;
    visiting.add(index);
    const parent = configs[index].fromCableId;
    if (parent !== undefined) {
      const parentIndex = indices.get(parent);
      if (parentIndex === undefined) throw new Error('The source cable is missing.');
      visit(parentIndex);
    }
    visiting.delete(index); visited.add(index); order.push(index);
  };
  configs.forEach((_, i) => visit(i));
  return order;
}

/** Material midpoint of the simulated rope, including depth and odd segment counts. */
export function cableMidpoint(state: CableState): CablePoint {
  const position = (state.points.length - 1) / 2;
  const i = Math.floor(position), t = position - i;
  const coordinate = (index: number, axis: 'x' | 'y' | 'z') =>
    state.points[Math.max(0, Math.min(state.points.length - 1, index))][axis] ?? 0;
  const smooth = (axis: 'x' | 'y' | 'z') => {
    const a = coordinate(i - 1, axis), b = coordinate(i, axis), c = coordinate(i + 1, axis), d = coordinate(i + 2, axis);
    return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  };
  return { x: smooth('x'), y: smooth('y'), z: smooth('z') };
}
