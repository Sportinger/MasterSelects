// Primitive bounds for the LBVH builder, one entry point per primitive kind. Requires PtCommon.wgsl.
// Bounds are in the space the BLAS is built in: fibers in scene space (they are emitted there), mesh
// triangles, quads, spheres and boxes in object space, instances (TLAS) in scene space. Hidden or
// degenerate primitives get empty bounds (min > max), which the builder sorts last.

struct BoundsParams {
  count: u32,
  base: u32,           // first record: fiber index, or vec4 index in the object pool (instances: instance index)
  dispatchWidth: u32,
  nodePage1Start: u32, // instances: first node index of node page 1
};

@group(0) @binding(0) var<uniform> boundsParams: BoundsParams;
@group(0) @binding(1) var<storage, read> boundsFibers: array<PtFiberSegment>;
@group(0) @binding(2) var<storage, read> boundsObjects: array<vec4f>;
@group(0) @binding(3) var<storage, read> boundsNodes0: array<PtWideNode>;
@group(0) @binding(4) var<storage, read> boundsNodes1: array<PtWideNode>;
@group(0) @binding(5) var<storage, read_write> boundsOut: array<vec4f>;

const BOUNDS_EMPTY_LO: vec3f = vec3f(PT_INFINITY);
const BOUNDS_EMPTY_HI: vec3f = vec3f(-PT_INFINITY);

fn boundsThread(id: vec3u) -> u32 {
  return id.y * boundsParams.dispatchWidth + id.x;
}

fn boundsWrite(i: u32, lo: vec3f, hi: vec3f) {
  boundsOut[i * 2u] = vec4f(lo, 0.0);
  boundsOut[i * 2u + 1u] = vec4f(hi, 0.0);
}

@compute @workgroup_size(256)
fn fiberBounds(@builtin(global_invocation_id) id: vec3u) {
  let i = boundsThread(id);
  if (i >= boundsParams.count) {
    return;
  }
  let s = boundsFibers[boundsParams.base + i];
  if ((s.material & PT_FIBER_FLAG_HIDDEN) != 0u || max(s.a.w, s.b.w) <= 0.0) {
    boundsWrite(i, BOUNDS_EMPTY_LO, BOUNDS_EMPTY_HI);
    return;
  }
  boundsWrite(i, min(s.a.xyz - s.a.w, s.b.xyz - s.b.w), max(s.a.xyz + s.a.w, s.b.xyz + s.b.w));
}

@compute @workgroup_size(256)
fn triangleBounds(@builtin(global_invocation_id) id: vec3u) {
  let i = boundsThread(id);
  if (i >= boundsParams.count) {
    return;
  }
  let tri = bitcast<vec4u>(boundsObjects[boundsParams.base + i]);
  let a = boundsObjects[tri.x * 2u].xyz;
  let b = boundsObjects[tri.y * 2u].xyz;
  let c = boundsObjects[tri.z * 2u].xyz;
  boundsWrite(i, min(a, min(b, c)), max(a, max(b, c)));
}

@compute @workgroup_size(256)
fn quadBounds(@builtin(global_invocation_id) id: vec3u) {
  let i = boundsThread(id);
  if (i >= boundsParams.count) {
    return;
  }
  let at = boundsParams.base + i * 4u;
  let o = boundsObjects[at].xyz;
  let u = boundsObjects[at + 1u].xyz;
  let v = boundsObjects[at + 2u].xyz;
  let lo = min(min(o, o + u), min(o + v, o + u + v));
  let hi = max(max(o, o + u), max(o + v, o + u + v));
  // A quad is flat; pad the thin axis so the bounds have volume.
  boundsWrite(i, lo - 1e-6, hi + 1e-6);
}

@compute @workgroup_size(256)
fn sphereBounds(@builtin(global_invocation_id) id: vec3u) {
  let i = boundsThread(id);
  if (i >= boundsParams.count) {
    return;
  }
  let s = boundsObjects[boundsParams.base + i * 4u];
  if (s.w <= 0.0) {
    boundsWrite(i, BOUNDS_EMPTY_LO, BOUNDS_EMPTY_HI);
    return;
  }
  boundsWrite(i, s.xyz - s.w, s.xyz + s.w);
}

@compute @workgroup_size(256)
fn boxBounds(@builtin(global_invocation_id) id: vec3u) {
  let i = boundsThread(id);
  if (i >= boundsParams.count) {
    return;
  }
  let at = boundsParams.base + i * 4u;
  boundsWrite(i, boundsObjects[at].xyz, boundsObjects[at + 1u].xyz);
}

fn boundsNode(index: u32) -> PtWideNode {
  if (index < boundsParams.nodePage1Start) {
    return boundsNodes0[index];
  }
  return boundsNodes1[index - boundsParams.nodePage1Start];
}

/** TLAS leaves: the instance's BLAS root bounds, transformed to scene space (all eight corners). */
@compute @workgroup_size(256)
fn instanceBounds(@builtin(global_invocation_id) id: vec3u) {
  let i = boundsThread(id);
  if (i >= boundsParams.count) {
    return;
  }
  let b = (boundsParams.base + i) * 8u;
  let r0 = boundsObjects[b + 3u];
  let r1 = boundsObjects[b + 4u];
  let r2 = boundsObjects[b + 5u];
  let refs = bitcast<vec4u>(boundsObjects[b + 6u]);
  let info = bitcast<vec4u>(boundsObjects[b + 7u]);
  if (info.y == 0u) {
    boundsWrite(i, BOUNDS_EMPTY_LO, BOUNDS_EMPTY_HI);
    return;
  }
  let rootNode = boundsNode(refs.x);
  // The BLAS bounds: both children of its root traversal node (an empty child has min > max).
  let rootMin = min(rootNode.leftMin, rootNode.rightMin);
  let rootMax = max(rootNode.leftMax, rootNode.rightMax);
  if (any(rootMin > rootMax)) {
    boundsWrite(i, BOUNDS_EMPTY_LO, BOUNDS_EMPTY_HI);
    return;
  }
  var lo = BOUNDS_EMPTY_LO;
  var hi = BOUNDS_EMPTY_HI;
  for (var corner = 0u; corner < 8u; corner++) {
    let p = select(rootMin, rootMax, vec3<bool>((corner & 1u) != 0u, (corner & 2u) != 0u, (corner & 4u) != 0u));
    let w = ptTransformPoint(r0, r1, r2, p);
    lo = min(lo, w);
    hi = max(hi, w);
  }
  boundsWrite(i, lo, hi);
}
