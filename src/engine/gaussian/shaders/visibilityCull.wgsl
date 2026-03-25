// Frustum culling compute shader for gaussian splats.
// Tests each splat against 6 frustum planes extracted from the view-projection matrix.
// Visible splat indices are written to an output buffer using an atomic counter.

// ── Bindings ──────────────────────────────────────────────────────────────────

// Group 0: splat data (14 floats per splat, read-only)
@group(0) @binding(0) var<storage, read> splatData: array<f32>;

// Group 1: camera + cull uniforms
struct CullUniforms {
  viewProj: mat4x4f,           // combined view * projection
  splatCount: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
}
@group(1) @binding(0) var<uniform> cull: CullUniforms;

// Group 2: output (visible indices + atomic counter)
@group(2) @binding(0) var<storage, read_write> visibleIndices: array<u32>;
@group(2) @binding(1) var<storage, read_write> counter: array<atomic<u32>>;

// ── Frustum plane extraction ──────────────────────────────────────────────────

// Extract 6 frustum planes from a column-major view-projection matrix.
// Each plane is vec4f (normal.xyz, distance) with inward-facing normal.
// Planes: left, right, bottom, top, near, far.
fn extractFrustumPlane(m: mat4x4f, row: u32, sign: f32) -> vec4f {
  // Rows of the matrix (transpose of columns)
  let r0 = vec4f(m[0][0], m[1][0], m[2][0], m[3][0]);
  let r1 = vec4f(m[0][1], m[1][1], m[2][1], m[3][1]);
  let r2 = vec4f(m[0][2], m[1][2], m[2][2], m[3][2]);
  let r3 = vec4f(m[0][3], m[1][3], m[2][3], m[3][3]);

  var plane: vec4f;
  if (row == 0u) {
    plane = r3 + sign * r0; // left (+) or right (-)
  } else if (row == 1u) {
    plane = r3 + sign * r1; // bottom (+) or top (-)
  } else {
    plane = r3 + sign * r2; // near (+) or far (-)
  }

  // Normalize the plane
  let len = length(plane.xyz);
  if (len > 0.0001) {
    return plane / len;
  }
  return plane;
}

// ── Main kernel ──────────────────────────────────────────────────────────────

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= cull.splatCount) {
    return;
  }

  // Read splat position and scale (14 floats per splat)
  let base = idx * 14u;
  let pos = vec3f(splatData[base + 0u], splatData[base + 1u], splatData[base + 2u]);
  let scale = vec3f(splatData[base + 3u], splatData[base + 4u], splatData[base + 5u]);

  // Compute bounding sphere radius: 3 sigma of the largest scale axis
  let radius = 3.0 * max(scale.x, max(scale.y, scale.z));

  // Extract 6 frustum planes from the view-projection matrix
  let m = cull.viewProj;
  let planeLeft   = extractFrustumPlane(m, 0u,  1.0);
  let planeRight  = extractFrustumPlane(m, 0u, -1.0);
  let planeBottom = extractFrustumPlane(m, 1u,  1.0);
  let planeTop    = extractFrustumPlane(m, 1u, -1.0);
  let planeNear   = extractFrustumPlane(m, 2u,  1.0);
  let planeFar    = extractFrustumPlane(m, 2u, -1.0);

  // Test splat bounding sphere against each plane
  let p = vec4f(pos, 1.0);
  if (dot(planeLeft.xyz, pos)   + planeLeft.w   < -radius) { return; }
  if (dot(planeRight.xyz, pos)  + planeRight.w  < -radius) { return; }
  if (dot(planeBottom.xyz, pos) + planeBottom.w < -radius) { return; }
  if (dot(planeTop.xyz, pos)    + planeTop.w    < -radius) { return; }
  if (dot(planeNear.xyz, pos)   + planeNear.w   < -radius) { return; }
  if (dot(planeFar.xyz, pos)    + planeFar.w    < -radius) { return; }

  // Splat is visible — append its index
  let slot = atomicAdd(&counter[0], 1u);
  visibleIndices[slot] = idx;
}
