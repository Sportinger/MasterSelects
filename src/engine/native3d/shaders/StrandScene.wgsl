// Weave strands: every curve segment is expanded into camera-facing ribbons by vertex pulling,
// one instance per fiber. A Yarn Profile places plies on a ring around the curve and fibers on
// a ring around each ply; both angles follow arc length, so radius changes never spin the twist.
// The world-space width decides the projected pixel width; fibers thinner than one pixel keep one
// pixel of geometry and a deterministic hashed coverage instead, so dense yarns need no sorting,
// export reproduces the preview and zero-width strands draw nothing.
// Flyaway channels are extra instances per yarn: in a hashed window per curve cell one stray fiber
// arcs off the yarn surface and returns (loop) or ends at its peak (free end); elsewhere it is hidden.

const TAU: f32 = 6.28318530718;
const PI: f32 = 3.14159265359;
/** Flyaway windows keep this fraction of their cell free at both ends, so neighbouring cells never overlap. */
const FLYAWAY_MARGIN: f32 = 0.15;

struct StrandUniforms {
  world: mat4x4f,
  view: mat4x4f,
  projection: mat4x4f,
  camera: vec4f,  // xyz: camera position (world)
  color: vec4f,   // rgb: strand color
  params: vec4f,  // x: world fiber width, yz: viewport pixels, w: layer opacity
  light: vec4f,   // xyz: key light direction (world, toward the light), w: ambient
  yarn: vec4f,    // x: plies, y: fibers per ply, z: yarn radius (local), w: ply twist (turns per unit length)
  twist: vec4f,   // x: fiber twist (turns per unit length), y: flyaway seed
  fly: vec4f,     // x: flyaway cell length per channel, y: flyaway length, z: lift (yarn radii), w: free-end fraction
};

struct Flyaway {
  start: f32,   // arc length where the fiber leaves the yarn
  length: f32,  // arc length it spans; 0 marks a regular yarn fiber
  angle: f32,   // position around the yarn, in turns
  hair: bool,   // ends free at its peak instead of returning
};

@group(0) @binding(0) var<uniform> u: StrandUniforms;
// Three vec4 per point: (position, arc length), (rotation-minimizing normal, radius scale), (tangent, strand index).
@group(0) @binding(1) var<storage, read> points: array<vec4f>;
// First point index per segment; bit 31/30: the strand continues before/after the segment.
@group(0) @binding(2) var<storage, read> segments: array<u32>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) tangent: vec3f,
  @location(1) toCamera: vec3f,
  @location(2) across: f32,
  @location(3) coverage: f32,
  @location(4) @interpolate(flat) segment: u32,
};

fn hash3(x: u32, y: u32, z: u32) -> f32 {
  var h = (x * 0x8da6b343u) ^ (y * 0xd8163841u) ^ (z * 0xcb1ab31fu);
  h = (h ^ (h >> 16u)) * 0x7feb352du;
  h = (h ^ (h >> 15u)) * 0x846ca68bu;
  h = h ^ (h >> 16u);
  return f32(h) * (1.0 / 4294967296.0);
}

/** The flyaway of `channel` in the curve cell holding arc length `s`: one per cell, at a hashed place. */
fn flyawayAt(strand: u32, channel: u32, s: f32) -> Flyaway {
  let cell = max(u.fly.x, 1e-6);
  let index = u32(max(floor(s / cell), 0.0));
  let usable = cell * (1.0 - 2.0 * FLYAWAY_MARGIN);
  let key = index * 16u + channel;
  let salt = u32(u.twist.y) * 0x51ed27u;
  var fly: Flyaway;
  fly.length = min(u.fly.y, usable);
  fly.start = f32(index) * cell + cell * FLYAWAY_MARGIN + (usable - fly.length) * hash3(strand, key, salt + 1u);
  fly.angle = hash3(strand, key, salt + 2u);
  fly.hair = hash3(strand, key, salt + 3u) < u.fly.w;
  return fly;
}

/**
 * World-space position of `fiber` at curve point `index`. Within one flyaway window it depends on
 * the index only, so every segment sharing a point computes the same position and ribbons join
 * without gaps.
 */
fn fiberPoint(index: u32, fiber: u32, fly: Flyaway) -> vec3f {
  let a = points[index * 3u];
  let b = points[index * 3u + 1u];
  let tangent = points[index * 3u + 2u].xyz;
  let radius = u.yarn.z * b.w;
  let plies = max(u.yarn.x, 1.0);
  let fibersPerPly = max(u.yarn.y, 1.0);
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
    let angle = TAU * (fly.angle + u.yarn.w * a.w);
    local = a.xyz + (normal * cos(angle) + binormal * sin(angle)) * ((plyRing + fiberRing) + radius * u.fly.z * rise);
  } else if (radius > 0.0 && (plies > 1.0 || fibersPerPly > 1.0)) {
    let ply = f32(fiber / u32(fibersPerPly));
    let strandInPly = f32(fiber % u32(fibersPerPly));
    let plyAngle = TAU * (ply / plies + u.yarn.w * a.w);
    let plyCenter = a.xyz + (normal * cos(plyAngle) + binormal * sin(plyAngle)) * plyRing;
    let fiberAngle = TAU * (strandInPly / fibersPerPly + u.twist.x * a.w);
    local = plyCenter + (normal * cos(fiberAngle) + binormal * sin(fiberAngle)) * fiberRing;
  }
  return (u.world * vec4f(local, 1.0)).xyz;
}

fn toPixels(clip: vec4f) -> vec2f {
  return clip.xy / clip.w * 0.5 * u.params.yz;
}

@vertex
fn strandVertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) fiber: u32) -> VertexOutput {
  var out: VertexOutput;
  let segment = vertexIndex / 6u;
  let corner = vertexIndex % 6u;
  let packed = segments[segment];
  let first = packed & 0x3fffffffu;
  out.coverage = 0.0;
  out.position = vec4f(2.0, 2.0, 2.0, 1.0);
  // Instances past the yarn fibers are flyaway channels, drawn only where their window overlaps the segment.
  let yarnFibers = u32(max(u.yarn.x, 1.0)) * u32(max(u.yarn.y, 1.0));
  var fly: Flyaway;
  if (fiber >= yarnFibers) {
    let startArc = points[first * 3u].w;
    let endArc = points[(first + 1u) * 3u].w;
    fly = flyawayAt(u32(points[first * 3u + 2u].w), fiber - yarnFibers, 0.5 * (startArc + endArc));
    if (endArc <= fly.start || startArc >= fly.start + fly.length) {
      return out;
    }
  }
  let a = fiberPoint(first, fiber, fly);
  let b = fiberPoint(first + 1u, fiber, fly);
  // Joint direction between the neighbours of each end, identical for both segments at a joint.
  let before = select(a, fiberPoint(first - 1u, fiber, fly), (packed & 0x80000000u) != 0u);
  let after = select(b, fiberPoint(first + 2u, fiber, fly), (packed & 0x40000000u) != 0u);
  // Two triangles per segment: (a-, b-, a+) and (a+, b-, b+).
  let atB = corner == 1u || corner == 4u || corner == 5u;
  let side = select(-1.0, 1.0, corner == 2u || corner == 3u || corner == 5u);
  let p = select(a, b, atB);
  // A yarn radius scale of zero hides the strand: fibers thin out with the radius they grow from.
  let widthScale = clamp(points[select(first, first + 1u, atB) * 3u + 1u].w, 0.0, 1.0);
  let span = b - a;
  let spanTangent = select(vec3f(1.0, 0.0, 0.0), normalize(span), dot(span, span) > 1e-18);
  let joint = select(b - before, after - a, atB);
  let tangent = select(spanTangent, normalize(joint), dot(joint, joint) > 1e-18);
  out.segment = segment ^ (fiber * 0x9e3779b9u);
  out.across = side;
  out.tangent = tangent;
  out.toCamera = u.camera.xyz - p;
  let viewProjection = u.projection * u.view;
  let clip = viewProjection * vec4f(p, 1.0);
  let ahead = viewProjection * vec4f(p + tangent * 1e-3, 1.0);
  // Points behind the near plane are skipped rather than clipped.
  if (clip.w <= 1e-5 || ahead.w <= 1e-5) {
    return out;
  }
  let toCamera = normalize(u.camera.xyz - p);
  let widthAxis = cross(tangent, toCamera);
  let widthDirection = select(vec3f(0.0, 1.0, 0.0), normalize(widthAxis), dot(widthAxis, widthAxis) > 1e-12);
  let edge = viewProjection * vec4f(p + widthDirection * u.params.x * widthScale, 1.0);
  let pixels = select(0.0, length(toPixels(edge) - toPixels(clip)), edge.w > 1e-5);
  out.coverage = clamp(pixels, 0.0, 1.0) * u.params.w;
  if (out.coverage <= 1e-3) {
    return out;
  }
  let screen = toPixels(ahead) - toPixels(clip);
  let direction = select(vec2f(1.0, 0.0), normalize(screen), dot(screen, screen) > 1e-12);
  let normal = vec2f(-direction.y, direction.x);
  let offset = normal * side * max(pixels, 1.0) * 0.5 / (0.5 * u.params.yz);
  out.position = vec4f(clip.xy + offset * clip.w, clip.zw);
  return out;
}

@fragment
fn strandFragment(in: VertexOutput) -> @location(0) vec4f {
  if (in.coverage < 1.0 && hash3(u32(in.position.x), u32(in.position.y), in.segment) >= in.coverage) {
    discard;
  }
  // Kajiya-Kay: diffuse and specular depend on the fiber tangent, not a surface normal.
  let tangent = normalize(in.tangent);
  let view = normalize(in.toCamera);
  let light = normalize(u.light.xyz);
  let tl = dot(tangent, light);
  let diffuse = sqrt(max(0.0, 1.0 - tl * tl));
  let halfway = normalize(light + view);
  let th = dot(tangent, halfway);
  let specular = pow(sqrt(max(0.0, 1.0 - th * th)), 48.0);
  let profile = sqrt(max(0.0, 1.0 - in.across * in.across));
  let shade = u.light.w + (1.0 - u.light.w) * diffuse;
  let rgb = u.color.rgb * shade * mix(0.55, 1.0, profile) + vec3f(0.25 * specular * profile);
  return vec4f(rgb, 1.0);
}
