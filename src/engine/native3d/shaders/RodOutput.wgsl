// Rod Simulation output on the GPU (CPU reference: rodRest.ts rodCurvePositions and the Yarn
// Profile stages after it): every curve point follows its place on its rod (uniform Catmull-Rom on
// the simulated nodes, blended between two steps) plus its rest detail, and its radius scale is
// multiplied by the Yarn Profile radius fields (strandRadiusScale, generated in place of the
// field marker below). StrandFrames.wgsl then writes frames.

struct OutputParams {
  points: u32,
  strands: u32,
  alpha: f32,         // blend from the earlier step to the current state
  dispatchWidth: u32,
};

@group(0) @binding(0) var<uniform> output: OutputParams;
// Simulated node positions (xyz, inverse mass) at the later step, and at the earlier one.
@group(0) @binding(1) var<storage, read> nodes: array<vec4f>;
@group(0) @binding(2) var<storage, read> earlier: array<vec4f>;
// Per point: (node, first node of its rod, rod node count, ring) and
// (detail xyz, fraction), (rest radius scale, strand, point in strand, points in strand).
@group(0) @binding(3) var<storage, read> pointRods: array<vec4u>;
@group(0) @binding(4) var<storage, read> pointGeometry: array<vec4f>;
// Three vec4 per point: (position, arc length), (frame normal, radius scale), (tangent, strand index).
@group(0) @binding(5) var<storage, read_write> packed: array<vec4f>;
// Values of the constants in the radius fields.
@group(0) @binding(6) var<storage, read> fieldConstants: array<f32>;

/** Curve context a radius field reads (curveFieldColumns.ts): Position, Curve Param, indices, counts. */
struct FieldContext {
  position: vec3f,
  curveU: f32,
  point: f32,
  strand: f32,
  points: f32,
  strands: f32,
};

//@strand-fields

fn node(start: u32, count: u32, ring: bool, index: i32) -> vec3f {
  var local = index;
  if (ring) {
    local = (index + i32(count)) % i32(count);
  } else {
    local = clamp(index, 0, i32(count) - 1);
  }
  let i = start + u32(local);
  return mix(earlier[i].xyz, nodes[i].xyz, output.alpha);
}

@compute @workgroup_size(256)
fn rodOutput(@builtin(global_invocation_id) gid: vec3u) {
  let index = gid.x + gid.y * output.dispatchWidth * 256u;
  if (index >= output.points) {
    return;
  }
  let rodInfo = pointRods[index];
  let geometry = pointGeometry[index * 2u];
  let info = pointGeometry[index * 2u + 1u];
  var point = geometry.xyz;
  if (rodInfo.z > 0u) {
    let ring = rodInfo.w == 1u;
    let k = i32(rodInfo.x);
    let a = node(rodInfo.y, rodInfo.z, ring, k - 1);
    let b = node(rodInfo.y, rodInfo.z, ring, k);
    let c = node(rodInfo.y, rodInfo.z, ring, k + 1);
    let d = node(rodInfo.y, rodInfo.z, ring, k + 2);
    let t = geometry.w;
    let t2 = t * t;
    let t3 = t2 * t;
    point += 0.5 * (2.0 * b + (c - a) * t + (2.0 * a - 5.0 * b + 4.0 * c - d) * t2 + (3.0 * (b - c) + d - a) * t3);
  }
  let curveU = select(0.0, info.z / (info.w - 1.0), info.w > 1.0);
  let radius = info.x * strandRadiusScale(FieldContext(point, curveU, info.z, info.y, info.w, f32(output.strands)));
  packed[index * 3u] = vec4f(point, 0.0);
  packed[index * 3u + 1u] = vec4f(0.0, 0.0, 0.0, radius);
}
