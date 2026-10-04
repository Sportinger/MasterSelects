/**
 * CPU reference of the GPU LBVH (PtLbvh.wgsl): the same Morton codes in float32, the same stable
 * sort, Karras hierarchy and bottom-up bounds, so a GPU build can be compared node for node and the
 * algorithm can be tested against brute force without a GPU. Nodes: internal 0 .. N-2, leaves after.
 */

export interface PtReferenceNode { lo: [number, number, number]; hi: [number, number, number]; left: number; right: number; leaf: boolean }
export interface PtReferenceBvh { nodes: PtReferenceNode[]; sortedPrimitives: Uint32Array }

const EMPTY_KEY = 0xffffffff;
const f = Math.fround;

function expandBits(value: number): number {
  let x = value & 0x3ff;
  x = (x | (x << 16)) & 0x030000ff;
  x = (x | (x << 8)) & 0x0300f00f;
  x = (x | (x << 4)) & 0x030c30c3;
  x = (x | (x << 2)) & 0x09249249;
  return x >>> 0;
}

const empty = (lo: ArrayLike<number>, hi: ArrayLike<number>) => lo[0] > hi[0] || lo[1] > hi[1] || lo[2] > hi[2];

/** `aabbs`: 6 floats per primitive (min xyz, max xyz); empty bounds (min > max) mark hidden primitives. */
export function buildReferenceLbvh(aabbs: Float32Array): PtReferenceBvh {
  const count = aabbs.length / 6;
  if (count < 1) throw new Error('empty BVH');
  const sceneLo = [Infinity, Infinity, Infinity], sceneHi = [-Infinity, -Infinity, -Infinity];
  const centroid = (i: number, axis: number) => f(f(0.5) * f(aabbs[i * 6 + axis] + aabbs[i * 6 + 3 + axis]));
  for (let i = 0; i < count; i++) {
    if (empty(aabbs.subarray(i * 6, i * 6 + 3), aabbs.subarray(i * 6 + 3, i * 6 + 6))) continue;
    for (let axis = 0; axis < 3; axis++) {
      sceneLo[axis] = Math.min(sceneLo[axis], centroid(i, axis));
      sceneHi[axis] = Math.max(sceneHi[axis], centroid(i, axis));
    }
  }
  const keys = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    if (empty(aabbs.subarray(i * 6, i * 6 + 3), aabbs.subarray(i * 6 + 3, i * 6 + 6))) { keys[i] = EMPTY_KEY; continue; }
    const q = [0, 1, 2].map(axis => {
      const extent = Math.max(f(sceneHi[axis] - sceneLo[axis]), 1e-20);
      return Math.trunc(Math.min(1023, Math.max(0, f(f(f(centroid(i, axis) - sceneLo[axis]) / f(extent)) * 1023))));
    });
    keys[i] = ((expandBits(q[0]) << 2) | (expandBits(q[1]) << 1) | expandBits(q[2])) >>> 0;
  }
  const order = Array.from({ length: count }, (_, i) => i).toSorted((a, b) => keys[a] - keys[b] || a - b);
  const sortedKeys = Uint32Array.from(order, i => keys[i]);
  const internal = count - 1;
  const nodes: PtReferenceNode[] = Array.from({ length: internal + count }, () =>
    ({ lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity], left: 0, right: 0, leaf: false }));
  const delta = (i: number, j: number) => {
    if (j < 0 || j >= count) return -1;
    if (sortedKeys[i] === sortedKeys[j]) return 32 + Math.clz32(i ^ j);
    return Math.clz32((sortedKeys[i] ^ sortedKeys[j]) >>> 0);
  };
  for (let i = 0; i < internal; i++) {
    const d = delta(i, i + 1) - delta(i, i - 1) >= 0 ? 1 : -1;
    const minimum = delta(i, i - d);
    let lmax = 2;
    while (delta(i, i + lmax * d) > minimum) lmax *= 2;
    let l = 0;
    for (let t = lmax / 2; t >= 1; t = Math.floor(t / 2)) if (delta(i, i + (l + t) * d) > minimum) l += t;
    const j = i + l * d, common = delta(i, j);
    let s = 0, divisor = 2, step = Math.ceil(l / divisor);
    for (;;) {
      if (delta(i, i + (s + step) * d) > common) s += step;
      if (step <= 1) break;
      divisor *= 2;
      step = Math.ceil(l / divisor);
    }
    const gamma = i + s * d + Math.min(d, 0);
    nodes[i].left = Math.min(i, j) === gamma ? internal + gamma : gamma;
    nodes[i].right = Math.max(i, j) === gamma + 1 ? internal + gamma + 1 : gamma + 1;
  }
  for (let leaf = 0; leaf < count; leaf++) {
    const primitive = order[leaf], node = nodes[internal + leaf];
    node.leaf = true; node.left = primitive; node.right = 1;
    node.lo = [aabbs[primitive * 6], aabbs[primitive * 6 + 1], aabbs[primitive * 6 + 2]];
    node.hi = [aabbs[primitive * 6 + 3], aabbs[primitive * 6 + 4], aabbs[primitive * 6 + 5]];
  }
  const fill = (index: number): PtReferenceNode => {
    const node = nodes[index];
    if (node.leaf) return node;
    const a = fill(node.left), b = fill(node.right);
    node.lo = [0, 1, 2].map(axis => Math.min(a.lo[axis], b.lo[axis])) as [number, number, number];
    node.hi = [0, 1, 2].map(axis => Math.max(a.hi[axis], b.hi[axis])) as [number, number, number];
    return node;
  };
  fill(0);
  return { nodes, sortedPrimitives: Uint32Array.from(order) };
}

/** Slab test: entry distance of the ray into the box, or Infinity when it misses within [tMin, tMax] or the box is empty. */
export function referenceRayBox(origin: readonly number[], inverse: readonly number[], lo: readonly number[], hi: readonly number[],
  tMin: number, tMax: number): number {
  // Empty bounds (hidden primitives) would pass the slab test with swapped planes.
  if (empty(lo, hi)) return Infinity;
  let near = tMin, far = tMax;
  for (let axis = 0; axis < 3; axis++) {
    const t0 = (lo[axis] - origin[axis]) * inverse[axis], t1 = (hi[axis] - origin[axis]) * inverse[axis];
    near = Math.max(near, Math.min(t0, t1));
    far = Math.min(far, Math.max(t0, t1));
  }
  return near <= far ? near : Infinity;
}

/** Closest hit through the tree; `intersect` returns the hit distance of a primitive or Infinity. */
export function traverseReferenceLbvh(bvh: PtReferenceBvh, origin: readonly number[], direction: readonly number[],
  intersect: (primitive: number, tMax: number) => number, tMax = Infinity): { t: number; primitive: number; visited: number } {
  const inverse = direction.map(value => 1 / value);
  const stack = [0];
  let best = tMax, primitive = -1, visited = 0;
  while (stack.length) {
    const node = bvh.nodes[stack.pop()!];
    visited++;
    if (referenceRayBox(origin, inverse, node.lo, node.hi, 0, best) === Infinity) continue;
    if (node.leaf) {
      const t = intersect(node.left, best);
      if (t < best) { best = t; primitive = node.left; }
      continue;
    }
    stack.push(node.left, node.right);
  }
  return { t: best, primitive, visited };
}
