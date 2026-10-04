// Linear BVH construction (Karras 2012) and refit on the GPU. Requires PtCommon.wgsl.
//
// Build: primitive bounds (PtPrimitiveBounds.wgsl) -> Morton codes over the centroid bounds ->
// stable radix sort (FlockRadixSort, ties keep primitive order) -> hierarchy (one thread per
// internal node) -> leaves -> bottom-up bounds -> finalize. Refit repeats the last three steps.
// Node layout of a BLAS with N primitives: internal nodes 0 .. N-2, leaf j at N-1+j, root 0 (a single
// primitive is its own root). Child and primitive indices are local; traversal adds the instance's
// node and primitive offsets.
//
// Bottom-up bounds use the "second arrival" scheme: the last child to finish computes its parent.
// Every bounds read and write goes through atomics, so results never come from a stale cache line.
// Hidden primitives carry the key 0xffffffff and empty bounds; they sort last and are never hit.

struct LbvhParams {
  count: u32,            // primitives
  dispatchWidth: u32,    // threads per row of a 2D dispatch (large counts)
  pad0: u32,
  pad1: u32,
};

@group(0) @binding(0) var<uniform> params: LbvhParams;
@group(0) @binding(1) var<storage, read> aabbs: array<vec4f>;               // min, max per primitive (w unused)
@group(0) @binding(2) var<storage, read_write> sorted: array<vec2u>;         // radix input (morton) / sorted (key, primitive)
@group(0) @binding(3) var<storage, read_write> nodes: array<PtBvhNode>;
@group(0) @binding(4) var<storage, read_write> parents: array<u32>;          // per node; root: 0xffffffff
@group(0) @binding(5) var<storage, read_write> counters: array<atomic<u32>>; // per internal node, then 6 scene centroid words, then SAH accumulator
@group(0) @binding(6) var<storage, read_write> bounds: array<atomic<u32>>;   // 6 ordered words per node

const LBVH_EMPTY_KEY: u32 = 0xffffffffu;
const LBVH_NO_PARENT: u32 = 0xffffffffu;

fn lbvhThread(id: vec3u) -> u32 {
  return id.y * params.dispatchWidth + id.x;
}

/** Float to a u32 whose unsigned order matches the float order (for atomicMin / atomicMax). */
fn lbvhOrdered(x: f32) -> u32 {
  let bits = bitcast<u32>(x);
  return select(bits ^ 0x80000000u, ~bits, (bits & 0x80000000u) != 0u);
}

fn lbvhUnordered(u: u32) -> f32 {
  return bitcast<f32>(select(~u, u ^ 0x80000000u, (u & 0x80000000u) != 0u));
}

fn lbvhInternalCount() -> u32 {
  return max(params.count, 1u) - 1u;
}

/** Index of the first centroid word in `counters`, after the per-node arrival counters. */
fn lbvhCentroidBase() -> u32 {
  return lbvhInternalCount();
}

fn lbvhEmpty(lo: vec3f, hi: vec3f) -> bool {
  return any(lo > hi);
}

@compute @workgroup_size(256)
fn resetCounters(@builtin(global_invocation_id) id: vec3u) {
  let i = lbvhThread(id);
  let internal = lbvhInternalCount();
  if (i < internal) {
    atomicStore(&counters[i], 0u);
  } else if (i < internal + 6u) {
    // Centroid bounds: three minima start at +inf, three maxima at -inf (ordered encoding).
    atomicStore(&counters[i], select(lbvhOrdered(-PT_INFINITY), lbvhOrdered(PT_INFINITY), i < internal + 3u));
  } else if (i == internal + 6u) {
    atomicStore(&counters[i], 0u);
  }
}

@compute @workgroup_size(256)
fn centroidBounds(@builtin(global_invocation_id) id: vec3u) {
  let i = lbvhThread(id);
  if (i >= params.count) {
    return;
  }
  let lo = aabbs[i * 2u].xyz;
  let hi = aabbs[i * 2u + 1u].xyz;
  if (lbvhEmpty(lo, hi)) {
    return;
  }
  let c = 0.5 * (lo + hi);
  let base = lbvhCentroidBase();
  for (var axis = 0u; axis < 3u; axis++) {
    atomicMin(&counters[base + axis], lbvhOrdered(c[axis]));
    atomicMax(&counters[base + 3u + axis], lbvhOrdered(c[axis]));
  }
}

fn lbvhExpandBits(v: u32) -> u32 {
  var x = v & 0x3ffu;
  x = (x | (x << 16u)) & 0x030000ffu;
  x = (x | (x << 8u)) & 0x0300f00fu;
  x = (x | (x << 4u)) & 0x030c30c3u;
  x = (x | (x << 2u)) & 0x09249249u;
  return x;
}

@compute @workgroup_size(256)
fn mortonCodes(@builtin(global_invocation_id) id: vec3u) {
  let i = lbvhThread(id);
  if (i >= params.count) {
    return;
  }
  let lo = aabbs[i * 2u].xyz;
  let hi = aabbs[i * 2u + 1u].xyz;
  if (lbvhEmpty(lo, hi)) {
    sorted[i] = vec2u(LBVH_EMPTY_KEY, i);
    return;
  }
  let base = lbvhCentroidBase();
  let sceneLo = vec3f(lbvhUnordered(atomicLoad(&counters[base])), lbvhUnordered(atomicLoad(&counters[base + 1u])),
    lbvhUnordered(atomicLoad(&counters[base + 2u])));
  let sceneHi = vec3f(lbvhUnordered(atomicLoad(&counters[base + 3u])), lbvhUnordered(atomicLoad(&counters[base + 4u])),
    lbvhUnordered(atomicLoad(&counters[base + 5u])));
  let extent = max(sceneHi - sceneLo, vec3f(1e-20));
  let q = vec3u(clamp((0.5 * (lo + hi) - sceneLo) / extent * 1023.0, vec3f(0.0), vec3f(1023.0)));
  // 30-bit codes; hidden primitives use the larger 0xffffffff.
  sorted[i] = vec2u((lbvhExpandBits(q.x) << 2u) | (lbvhExpandBits(q.y) << 1u) | lbvhExpandBits(q.z), i);
}

/** Common prefix length of sorted keys i and j; equal keys fall back to their indices. -1 out of range. */
fn lbvhDelta(i: i32, j: i32) -> i32 {
  if (j < 0 || j >= i32(params.count)) {
    return -1;
  }
  let ki = sorted[u32(i)].x;
  let kj = sorted[u32(j)].x;
  if (ki == kj) {
    return 32 + i32(countLeadingZeros(u32(i) ^ u32(j)));
  }
  return i32(countLeadingZeros(ki ^ kj));
}

@compute @workgroup_size(256)
fn hierarchy(@builtin(global_invocation_id) id: vec3u) {
  let index = lbvhThread(id);
  if (index >= lbvhInternalCount()) {
    return;
  }
  let i = i32(index);
  let d = select(-1, 1, lbvhDelta(i, i + 1) - lbvhDelta(i, i - 1) >= 0);
  let minimum = lbvhDelta(i, i - d);
  var lmax = 2;
  while (lbvhDelta(i, i + lmax * d) > minimum) {
    lmax *= 2;
  }
  var l = 0;
  var t = lmax / 2;
  while (t >= 1) {
    if (lbvhDelta(i, i + (l + t) * d) > minimum) {
      l += t;
    }
    t /= 2;
  }
  let j = i + l * d;
  let commonPrefix = lbvhDelta(i, j);
  var s = 0;
  var divisor = 2;
  var step = (l + divisor - 1) / divisor;
  loop {
    if (lbvhDelta(i, i + (s + step) * d) > commonPrefix) {
      s += step;
    }
    if (step <= 1) {
      break;
    }
    divisor *= 2;
    step = (l + divisor - 1) / divisor;
  }
  let gamma = i + s * d + min(d, 0);
  let leafBase = i32(lbvhInternalCount());
  let left = select(u32(gamma), u32(leafBase + gamma), min(i, j) == gamma);
  let right = select(u32(gamma + 1), u32(leafBase + gamma + 1), max(i, j) == gamma + 1);
  nodes[index].left = left;
  nodes[index].right = right;
  parents[left] = index;
  parents[right] = index;
  if (index == 0u) {
    parents[0] = LBVH_NO_PARENT;
  }
}

fn lbvhStoreBounds(node: u32, lo: vec3f, hi: vec3f) {
  for (var axis = 0u; axis < 3u; axis++) {
    atomicStore(&bounds[node * 6u + axis], lbvhOrdered(lo[axis]));
    atomicStore(&bounds[node * 6u + 3u + axis], lbvhOrdered(hi[axis]));
  }
}

fn lbvhLoadLo(node: u32) -> vec3f {
  return vec3f(lbvhUnordered(atomicLoad(&bounds[node * 6u])), lbvhUnordered(atomicLoad(&bounds[node * 6u + 1u])),
    lbvhUnordered(atomicLoad(&bounds[node * 6u + 2u])));
}

fn lbvhLoadHi(node: u32) -> vec3f {
  return vec3f(lbvhUnordered(atomicLoad(&bounds[node * 6u + 3u])), lbvhUnordered(atomicLoad(&bounds[node * 6u + 4u])),
    lbvhUnordered(atomicLoad(&bounds[node * 6u + 5u])));
}

/** Leaves, then the bottom-up walk: the second child to arrive at a node computes its bounds. */
@compute @workgroup_size(256)
fn bottomUp(@builtin(global_invocation_id) id: vec3u) {
  let leaf = lbvhThread(id);
  if (leaf >= params.count) {
    return;
  }
  let primitive = sorted[leaf].y;
  let node = lbvhInternalCount() + leaf;
  nodes[node].left = PT_LEAF_BIT | primitive;
  nodes[node].right = 1u;
  lbvhStoreBounds(node, aabbs[primitive * 2u].xyz, aabbs[primitive * 2u + 1u].xyz);
  if (params.count == 1u) {
    parents[0] = LBVH_NO_PARENT;
    return;
  }
  var current = node;
  // Depth is bounded by the 30 key bits plus the 32 index bits that break ties; the cap only
  // guards against a corrupt hierarchy turning into an endless loop (a device reset).
  for (var guard = 0u; guard < 160u; guard++) {
    let parent = parents[current];
    if (parent == LBVH_NO_PARENT) {
      break;
    }
    if (atomicAdd(&counters[parent], 1u) == 0u) {
      break;
    }
    let a = nodes[parent].left;
    let b = nodes[parent].right;
    lbvhStoreBounds(parent, min(lbvhLoadLo(a), lbvhLoadLo(b)), max(lbvhLoadHi(a), lbvhLoadHi(b)));
    current = parent;
  }
}

fn lbvhArea(lo: vec3f, hi: vec3f) -> f32 {
  if (lbvhEmpty(lo, hi)) {
    return 0.0;
  }
  let e = hi - lo;
  return 2.0 * (e.x * e.y + e.y * e.z + e.z * e.x);
}

/**
 * Copies the atomic bounds into the nodes and accumulates the SAH cost estimate (internal node area
 * + leaf area, relative to the root) in fixed point; the runtime rebuilds when it degrades.
 */
@compute @workgroup_size(256)
fn finalize(@builtin(global_invocation_id) id: vec3u) {
  let node = lbvhThread(id);
  let total = lbvhInternalCount() + params.count;
  if (node >= total) {
    return;
  }
  let lo = lbvhLoadLo(node);
  let hi = lbvhLoadHi(node);
  nodes[node].boundsMin = lo;
  nodes[node].boundsMax = hi;
  let rootArea = max(lbvhArea(lbvhLoadLo(0u), lbvhLoadHi(0u)), 1e-20);
  let isLeaf = node >= lbvhInternalCount();
  let cost = lbvhArea(lo, hi) / rootArea * select(1.2, 1.0, isLeaf);
  atomicAdd(&counters[lbvhInternalCount() + 6u], u32(min(cost * 256.0, 4.0e9)));
}
