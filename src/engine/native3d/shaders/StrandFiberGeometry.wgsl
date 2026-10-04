// Shared yarn geometry of Weave strands: plies on a ring around the curve and fibers on a ring
// around each ply, both twisted along arc length, flyaway windows, and the Catmull-Rom spline
// through the fiber points. The raster passes (StrandScene.wgsl) and the path tracer's fiber
// emission (pathtrace/scene/PtFiberEmission.wgsl) both build fibers from these functions, so the
// two renderers draw the same yarn.
//
// The including module declares the curve points as
//   points: array<vec4f>  — three vec4 per point: (position, arc length),
//                           (rotation-minimizing normal, radius scale), (tangent, strand index).

const TAU: f32 = 6.28318530718;
const PI: f32 = 3.14159265359;
/** Flyaway windows keep this fraction of their cell free at both ends, so neighbouring cells never overlap. */
const FLYAWAY_MARGIN: f32 = 0.15;

/** The yarn of one strand layer, as StrandPass packs it into its uniforms. */
struct StrandFiberParams {
  world: mat4x4f,
  yarn: vec4f,   // x: plies, y: fibers per ply, z: yarn radius (local), w: ply twist (turns per unit length)
  twist: vec4f,  // x: fiber twist, y: flyaway seed
  fly: vec4f,    // x: flyaway cell length per channel, y: flyaway length, z: lift (yarn radii), w: free-end fraction
};

struct Flyaway {
  start: f32,   // arc length where the fiber leaves the yarn
  length: f32,  // arc length it spans; 0 marks a regular yarn fiber
  angle: f32,   // position around the yarn, in turns
  hair: bool,   // ends free at its peak instead of returning
};

fn hash3(x: u32, y: u32, z: u32) -> f32 {
  var h = (x * 0x8da6b343u) ^ (y * 0xd8163841u) ^ (z * 0xcb1ab31fu);
  h = (h ^ (h >> 16u)) * 0x7feb352du;
  h = (h ^ (h >> 15u)) * 0x846ca68bu;
  h = h ^ (h >> 16u);
  return f32(h) * (1.0 / 4294967296.0);
}

/** Yarn fibers of a layer; fiber instances past them are flyaway channels. */
fn strandYarnFibers(params: StrandFiberParams) -> u32 {
  return u32(max(params.yarn.x, 1.0)) * u32(max(params.yarn.y, 1.0));
}

/** The flyaway of `channel` in the curve cell holding arc length `s`: one per cell, at a hashed place. */
fn strandFlyawayAt(params: StrandFiberParams, strand: u32, channel: u32, s: f32) -> Flyaway {
  let cell = max(params.fly.x, 1e-6);
  let index = u32(max(floor(s / cell), 0.0));
  let usable = cell * (1.0 - 2.0 * FLYAWAY_MARGIN);
  let key = index * 16u + channel;
  let salt = u32(params.twist.y) * 0x51ed27u;
  var fly: Flyaway;
  fly.length = min(params.fly.y, usable);
  fly.start = f32(index) * cell + cell * FLYAWAY_MARGIN + (usable - fly.length) * hash3(strand, key, salt + 1u);
  fly.angle = hash3(strand, key, salt + 2u);
  fly.hair = hash3(strand, key, salt + 3u) < params.fly.w;
  return fly;
}

/**
 * World-space position of `fiber` at curve point `index`. Within one flyaway window it depends on
 * the index only, so every segment sharing a point computes the same position and pieces join
 * without gaps.
 */
fn strandFiberPoint(params: StrandFiberParams, index: u32, fiber: u32, fly: Flyaway) -> vec3f {
  let a = points[index * 3u];
  let b = points[index * 3u + 1u];
  let tangent = points[index * 3u + 2u].xyz;
  let radius = params.yarn.z * b.w;
  let plies = max(params.yarn.x, 1.0);
  let fibersPerPly = max(params.yarn.y, 1.0);
  var local = a.xyz;
  let side = cross(tangent, b.xyz);
  let binormal = select(vec3f(0.0, 0.0, 1.0), normalize(side), dot(side, side) > 1e-12);
  let normal = cross(binormal, tangent);
  let plyRing = select(0.0, radius * 0.5, plies > 1.0);
  let plyRadius = select(radius, radius * 0.5, plies > 1.0);
  let fiberRing = select(0.0, plyRadius * 0.6, fibersPerPly > 1.0);
  if (fly.length > 0.0) {
    // Leaves the outer fiber ring and rises Lift yarn radii above it: a loop returns, a free end stops at the peak.
    let t = clamp((a.w - fly.start) / fly.length, 0.0, 1.0);
    let rise = select(sin(PI * t), sin(0.5 * PI * t), fly.hair);
    let angle = TAU * (fly.angle + params.yarn.w * a.w);
    local = a.xyz + (normal * cos(angle) + binormal * sin(angle)) * ((plyRing + fiberRing) + radius * params.fly.z * rise);
  } else if (radius > 0.0 && (plies > 1.0 || fibersPerPly > 1.0)) {
    let ply = f32(fiber / u32(fibersPerPly));
    let strandInPly = f32(fiber % u32(fibersPerPly));
    let plyAngle = TAU * (ply / plies + params.yarn.w * a.w);
    let plyCenter = a.xyz + (normal * cos(plyAngle) + binormal * sin(plyAngle)) * plyRing;
    let fiberAngle = TAU * (strandInPly / fibersPerPly + params.twist.x * a.w);
    local = plyCenter + (normal * cos(fiberAngle) + binormal * sin(fiberAngle)) * fiberRing;
  }
  return (params.world * vec4f(local, 1.0)).xyz;
}

/** Catmull-Rom point between p1 and p2; neighbouring segments share tangents, so joints stay smooth. */
fn catmullRom(p0: vec3f, p1: vec3f, p2: vec3f, p3: vec3f, t: f32) -> vec3f {
  let t2 = t * t;
  return 0.5 * (2.0 * p1 + (p2 - p0) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (3.0 * (p1 - p2) + p3 - p0) * t2 * t);
}

fn catmullRomTangent(p0: vec3f, p1: vec3f, p2: vec3f, p3: vec3f, t: f32) -> vec3f {
  return 0.5 * ((p2 - p0) + 2.0 * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t + 3.0 * (3.0 * (p1 - p2) + p3 - p0) * t * t);
}
