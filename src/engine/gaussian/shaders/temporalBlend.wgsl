// Temporal blend compute shader — interpolates between two splat frames.
// Each splat has 14 floats: [x,y,z, sx,sy,sz, qw,qx,qy,qz, r,g,b, opacity]
// Positions, scales, colors, and opacity are linearly interpolated.
// Quaternions use normalized lerp (nlerp) for correctness.

struct BlendParams {
  alpha: f32,          // blend weight: 0.0 = frame A, 1.0 = frame B
  splat_count: u32,
  _pad0: u32,
  _pad1: u32,
}

@group(0) @binding(0) var<storage, read> frameA: array<f32>;
@group(0) @binding(1) var<storage, read> frameB: array<f32>;
@group(0) @binding(2) var<storage, read_write> output: array<f32>;
@group(1) @binding(0) var<uniform> params: BlendParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= params.splat_count) {
    return;
  }

  let stride = 14u;
  let base = idx * stride;
  let a = params.alpha;
  let oneMinusA = 1.0 - a;

  // Position (0..2): linear lerp
  output[base + 0u] = frameA[base + 0u] * oneMinusA + frameB[base + 0u] * a;
  output[base + 1u] = frameA[base + 1u] * oneMinusA + frameB[base + 1u] * a;
  output[base + 2u] = frameA[base + 2u] * oneMinusA + frameB[base + 2u] * a;

  // Scale (3..5): linear lerp
  output[base + 3u] = frameA[base + 3u] * oneMinusA + frameB[base + 3u] * a;
  output[base + 4u] = frameA[base + 4u] * oneMinusA + frameB[base + 4u] * a;
  output[base + 5u] = frameA[base + 5u] * oneMinusA + frameB[base + 5u] * a;

  // Quaternion (6..9): nlerp (normalize after lerp)
  var qw = frameA[base + 6u] * oneMinusA + frameB[base + 6u] * a;
  var qx = frameA[base + 7u] * oneMinusA + frameB[base + 7u] * a;
  var qy = frameA[base + 8u] * oneMinusA + frameB[base + 8u] * a;
  var qz = frameA[base + 9u] * oneMinusA + frameB[base + 9u] * a;

  // Normalize quaternion
  let qLen = sqrt(qw * qw + qx * qx + qy * qy + qz * qz);
  if (qLen > 0.0001) {
    let invLen = 1.0 / qLen;
    qw *= invLen;
    qx *= invLen;
    qy *= invLen;
    qz *= invLen;
  }

  output[base + 6u] = qw;
  output[base + 7u] = qx;
  output[base + 8u] = qy;
  output[base + 9u] = qz;

  // Color (10..12): linear lerp
  output[base + 10u] = frameA[base + 10u] * oneMinusA + frameB[base + 10u] * a;
  output[base + 11u] = frameA[base + 11u] * oneMinusA + frameB[base + 11u] * a;
  output[base + 12u] = frameA[base + 12u] * oneMinusA + frameB[base + 12u] * a;

  // Opacity (13): linear lerp
  output[base + 13u] = frameA[base + 13u] * oneMinusA + frameB[base + 13u] * a;
}
