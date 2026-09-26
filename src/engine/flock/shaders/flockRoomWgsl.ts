import { RENDER_COMMON } from './flockRenderCommonWgsl';

/**
 * Open-front gallery box for data-sculpture scenes: back wall, floor, ceiling
 * and side walls facing inward, plus a flat frame ring around the opening.
 * Walls are lit by the key light, receive particle shadows and darken softly
 * where walls meet. Geometry is generated from the branch uniform
 * (ext0 = center.xyz + frame width, ext1 = size.xyz + corner darkening).
 */

export const ROOM_VERTEX_COUNT = 54;

export const FLOCK_ROOM_WGSL = /* wgsl */ `
${RENDER_COMMON}

struct RoomOut {
  @builtin(position) clip: vec4f,
  @location(0) sim: vec3f,
  @location(1) normal: vec3f,
  @location(2) @interpolate(flat) face: u32,
};

struct RoomFace { origin: vec3f, axisU: vec3f, axisV: vec3f, normal: vec3f, };

fn roomFace(face: u32, lo: vec3f, hi: vec3f, frame: f32) -> RoomFace {
  let s = hi - lo;
  var f: RoomFace;
  switch face {
    case 0u: { f = RoomFace(lo, vec3f(s.x, 0.0, 0.0), vec3f(0.0, s.y, 0.0), vec3f(0.0, 0.0, 1.0)); }
    case 1u: { f = RoomFace(lo, vec3f(0.0, 0.0, s.z), vec3f(s.x, 0.0, 0.0), vec3f(0.0, 1.0, 0.0)); }
    case 2u: { f = RoomFace(vec3f(lo.x, hi.y, lo.z), vec3f(s.x, 0.0, 0.0), vec3f(0.0, 0.0, s.z), vec3f(0.0, -1.0, 0.0)); }
    case 3u: { f = RoomFace(lo, vec3f(0.0, s.y, 0.0), vec3f(0.0, 0.0, s.z), vec3f(1.0, 0.0, 0.0)); }
    case 4u: { f = RoomFace(vec3f(hi.x, lo.y, lo.z), vec3f(0.0, 0.0, s.z), vec3f(0.0, s.y, 0.0), vec3f(-1.0, 0.0, 0.0)); }
    // Frame ring in the front plane: bottom, top, left, right strips.
    case 5u: { f = RoomFace(vec3f(lo.x - frame, lo.y - frame, hi.z), vec3f(s.x + frame * 2.0, 0.0, 0.0), vec3f(0.0, frame, 0.0), vec3f(0.0, 0.0, 1.0)); }
    case 6u: { f = RoomFace(vec3f(lo.x - frame, hi.y, hi.z), vec3f(s.x + frame * 2.0, 0.0, 0.0), vec3f(0.0, frame, 0.0), vec3f(0.0, 0.0, 1.0)); }
    case 7u: { f = RoomFace(vec3f(lo.x - frame, lo.y, hi.z), vec3f(frame, 0.0, 0.0), vec3f(0.0, s.y, 0.0), vec3f(0.0, 0.0, 1.0)); }
    default: { f = RoomFace(vec3f(hi.x, lo.y, hi.z), vec3f(frame, 0.0, 0.0), vec3f(0.0, s.y, 0.0), vec3f(0.0, 0.0, 1.0)); }
  }
  return f;
}

@vertex
fn vsRoom(@builtin(vertex_index) vi: u32) -> RoomOut {
  var out: RoomOut;
  let face = vi / 6u;
  var corners = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0),
  );
  let c = corners[vi % 6u];
  let half = br.ext1.xyz * 0.5;
  let lo = br.ext0.xyz - half;
  let hi = br.ext0.xyz + half;
  let frame = max(br.ext0.w, 0.0);
  if (face >= 5u && frame <= 0.0) { out.clip = HIDDEN; return out; }
  let f = roomFace(face, lo, hi, frame);
  let sim = f.origin + f.axisU * c.x + f.axisV * c.y;
  out.sim = sim;
  out.clip = toClip(sim);
  out.normal = normalize((rb.frame.world * vec4f(f.normal, 0.0)).xyz);
  out.face = face;
  return out;
}

@fragment
fn fsRoom(in: RoomOut) -> @location(0) vec4f {
  var visibility = 1.0;
  if (rb.light.enabled > 0.5) { visibility = shadowVisibility(in.sim); }
  var color = litColor(br.color, in.normal, visibility);
  if (in.face < 5u) {
    // Soft darkening toward the walls that meet this one (the open front excluded).
    let half = br.ext1.xyz * 0.5;
    let lo = br.ext0.xyz - half;
    let hi = br.ext0.xyz + half;
    let radius = max(min(min(br.ext1.x, br.ext1.y), br.ext1.z) * 0.18, 1e-3);
    var distances = array<f32, 5>(in.sim.z - lo.z, in.sim.y - lo.y, hi.y - in.sim.y, in.sim.x - lo.x, hi.x - in.sim.x);
    var ao = 1.0;
    for (var wall = 0u; wall < 5u; wall++) {
      if (wall == in.face) { continue; }
      ao *= 1.0 - br.ext1.w * exp(-max(distances[wall], 0.0) / radius);
    }
    color *= ao;
  }
  return vec4f(color, 1.0);
}
`;
