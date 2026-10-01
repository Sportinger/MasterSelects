import type { RodRest } from './rodRest';
import type { RodSegments } from './rodContacts';

/**
 * Constraint topology of a rod simulation, shared by the CPU solver and the GPU solver: segments,
 * bends at every interior node (every node of a ring), node masses (unit linear density), node
 * neighbours and a colouring of the constraints. Constraints of one colour share no node, so they
 * can be solved in parallel, and solving the colours in order gives the same result on both sides.
 */
export interface RodBends { prev: Uint32Array; mid: Uint32Array; next: Uint32Array; inverse1: Float64Array; inverse2: Float64Array; length: Float64Array }
export interface RodTopology {
  nodeCount: number;
  segments: RodSegments;
  bends: RodBends;
  /** Node neighbours along the rod (themselves at open ends), for the axis of air drag. */
  before: Uint32Array;
  after: Uint32Array;
  /** Rod length around each node; a lone node gets none. */
  mass: Float64Array;
  /** Segment indices per colour, and bend indices per colour, each ascending. */
  stretchColors: Uint32Array[];
  bendColors: Uint32Array[];
  /** Per node: the segment ending at it and the one starting at it (-1 at open ends). */
  nodeSegments: Int32Array;
}

/** Greedy colouring in constraint order: each constraint takes the lowest colour none of its nodes uses yet. */
export function colorConstraints(count: number, nodeCount: number, nodesOf: (index: number) => readonly number[]): Uint32Array[] {
  const used = new Uint32Array(nodeCount), lists: number[][] = [];
  for (let index = 0; index < count; index++) {
    const nodes = nodesOf(index);
    let mask = 0;
    for (const node of nodes) mask |= used[node];
    let color = 0;
    while (mask & (1 << color)) color++;
    if (color > 30) throw new Error('Rod constraint colouring needs too many colours.');
    for (const node of nodes) used[node] |= 1 << color;
    (lists[color] ??= []).push(index);
  }
  return lists.map(list => Uint32Array.from(list));
}

export function buildRodTopology(rest: RodRest): RodTopology {
  const { starts, counts, closed, positions } = rest, nodeCount = positions.length / 3;
  const before = new Uint32Array(nodeCount), after = new Uint32Array(nodeCount), nodeSegments = new Int32Array(nodeCount * 2).fill(-1);
  let total = 0;
  for (let rod = 0; rod < counts.length; rod++) total += closed[rod] ? counts[rod] : Math.max(0, counts[rod] - 1);
  const segments: RodSegments = { a: new Uint32Array(total), b: new Uint32Array(total), rest: new Float64Array(total),
    rod: new Uint32Array(total), arc: new Float64Array(total), rodLength: new Float64Array(counts.length), rodClosed: Uint8Array.from(closed) };
  const triples: number[][] = [];
  let c = 0;
  for (let rod = 0; rod < counts.length; rod++) {
    const start = starts[rod], count = counts[rod], ring = closed[rod] === 1, links = ring ? count : Math.max(0, count - 1), first = c;
    for (let node = 0; node < count; node++) {
      before[start + node] = start + (ring ? (node - 1 + count) % count : Math.max(0, node - 1));
      after[start + node] = start + (ring ? (node + 1) % count : Math.min(count - 1, node + 1));
    }
    let arc = 0;
    for (let link = 0; link < links; link++, c++) {
      const i = start + link, j = start + (link + 1) % count;
      const length = Math.hypot(positions[j * 3] - positions[i * 3], positions[j * 3 + 1] - positions[i * 3 + 1], positions[j * 3 + 2] - positions[i * 3 + 2]);
      segments.a[c] = i; segments.b[c] = j; segments.rest[c] = length; segments.rod[c] = rod;
      segments.arc[c] = arc + length / 2; arc += length;
      nodeSegments[i * 2 + 1] = c; nodeSegments[j * 2] = c;
    }
    segments.rodLength[rod] = arc;
    for (let node = ring ? 0 : 1; node < (ring ? count : count - 1); node++) {
      const left = first + (ring ? (node - 1 + count) % count : node - 1), right = first + node;
      triples.push([before[start + node], start + node, after[start + node], segments.rest[left], segments.rest[right]]);
    }
  }
  const bends: RodBends = { prev: new Uint32Array(triples.length), mid: new Uint32Array(triples.length), next: new Uint32Array(triples.length),
    inverse1: new Float64Array(triples.length), inverse2: new Float64Array(triples.length), length: new Float64Array(triples.length) };
  triples.forEach(([prev, mid, next, l1, l2], index) => {
    bends.prev[index] = prev; bends.mid[index] = mid; bends.next[index] = next;
    bends.inverse1[index] = l1 > 0 ? 1 / l1 : 0; bends.inverse2[index] = l2 > 0 ? 1 / l2 : 0;
    bends.length[index] = (l1 + l2) / 2;
  });
  const mass = new Float64Array(nodeCount);
  for (let s = 0; s < total; s++) { mass[segments.a[s]] += segments.rest[s] / 2; mass[segments.b[s]] += segments.rest[s] / 2; }
  return { nodeCount, segments, bends, before, after, mass, nodeSegments,
    stretchColors: colorConstraints(total, nodeCount, s => [segments.a[s], segments.b[s]]),
    bendColors: colorConstraints(triples.length, nodeCount, k => [bends.prev[k], bends.mid[k], bends.next[k]]) };
}
