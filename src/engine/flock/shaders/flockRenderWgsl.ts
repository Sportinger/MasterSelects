import { FLOCK_WGSL_MATH, FLOCK_WGSL_STRUCTS, flockSelectionWgsl } from './flockWgslShared';

/**
 * Render shaders for flock branches. Group 0 carries the per-layer render
 * block and both state samples (previous / current step); group 1 carries the
 * branch uniform plus branch-specific buffers.
 */

const RENDER_COMMON = /* wgsl */ `
${FLOCK_WGSL_STRUCTS}
${FLOCK_WGSL_MATH}

struct Palette {
  c0: vec3f, mode: f32,
  c1: vec3f, frequency: f32,
  c2: vec3f, range: f32,
  c3: vec3f, pad0: f32,
};

struct FrameParams {
  viewProj: mat4x4f,
  world: mat4x4f,
  cameraPos: vec3f, alpha: f32,
  cameraRight: vec3f, time: f32,
  cameraUp: vec3f, worldUnitsPerSim: f32,
  viewport: vec2f, capacity: f32, maxSpeed: f32,
  neighborLimit: f32, selectionCount: f32, teleport2: f32, focalPx: f32,
  pad0: vec4f,
  pad1: vec4f,
  pad2: vec4f,
};

struct RenderBlock {
  frame: FrameParams,
  selections: array<Selection, 16>,
  palettes: array<Palette, 8>,
};

struct Branch {
  color: vec3f, opacity: f32,
  color2: vec3f, size: f32,
  kind: f32, colorMode: f32, shape: f32, sizeMode: f32,
  sizeVariance: f32, distanceFade: f32, width: f32, taper: f32,
  selection: f32, palette: f32, fadeTail: f32, smoothing: f32,
  radius: f32, fadeBand: f32, perParticle: f32, fraction: f32,
  salt: f32, samples: f32, interval: f32, subdivisions: f32,
  swimAmp: f32, swimFreq: f32, phaseVar: f32, shading: f32,
  orientation: f32, anchor: f32, lineWidth: f32, mode: f32,
  scale: f32, headRing: f32, slotCount: f32, forwardAxis: f32,
  blend: f32, widthMode: f32, pad0: f32, pad1: f32,
};

@group(0) @binding(0) var<uniform> rb: RenderBlock;
@group(0) @binding(1) var<storage, read> stateCur: array<Particle>;
@group(0) @binding(2) var<storage, read> statePrev: array<Particle>;
@group(1) @binding(0) var<uniform> br: Branch;

${flockSelectionWgsl('rb.selections', 'evalRenderSelections')}

const HIDDEN = vec4f(2.0, 2.0, 2.0, 1.0);
const NEAR_W: f32 = 0.0005;

fn isVisibleParticle(index: u32, p: Particle) -> bool {
  if (p.age < 0.0) { return false; }
  if (br.selection < 0.0) { return true; }
  let mask = evalRenderSelections(index, p, u32(rb.frame.selectionCount));
  return ((mask >> u32(br.selection)) & 1u) == 1u;
}

fn interpolatedPos(index: u32) -> vec3f {
  let c = stateCur[index];
  let pr = statePrev[index];
  if (pr.age < 0.0 || pr.gen != c.gen) { return c.pos; }
  let d = c.pos - pr.pos;
  if (dot(d, d) > rb.frame.teleport2) { return c.pos; }
  return mix(pr.pos, c.pos, rb.frame.alpha);
}

fn interpolatedForward(index: u32) -> vec3f {
  let c = stateCur[index];
  let pr = statePrev[index];
  var f = c.fwd;
  if (pr.age >= 0.0 && pr.gen == c.gen) { f = mix(pr.fwd, c.fwd, rb.frame.alpha); }
  let l = length(f);
  if (l < 1e-5) { return vec3f(0.0, 0.0, 1.0); }
  return f / l;
}

fn toWorld(simPos: vec3f) -> vec3f {
  return (rb.frame.world * vec4f(simPos, 1.0)).xyz;
}

fn toClip(simPos: vec3f) -> vec4f {
  return rb.frame.viewProj * vec4f(toWorld(simPos), 1.0);
}

fn rampColor(c0: vec3f, c1: vec3f, c2: vec3f, c3: vec3f, tIn: f32) -> vec3f {
  let t = clamp(tIn, 0.0, 1.0) * 3.0;
  if (t < 1.0) { return mix(c0, c1, t); }
  if (t < 2.0) { return mix(c1, c2, t - 1.0); }
  return mix(c2, c3, t - 2.0);
}

fn paletteColor(index: u32, p: Particle, pos: vec3f) -> vec3f {
  let pal = rb.palettes[min(index, 7u)];
  let mode = u32(pal.mode);
  var stops = array<vec3f, 4>(pal.c0, pal.c1, pal.c2, pal.c3);
  if (mode == 0u) { return stops[u32(p.group) % 4u]; }
  if (mode == 1u) { return stops[min(3u, u32(p.rnd * 4.0))]; }
  if (mode == 2u) { return rampColor(pal.c0, pal.c1, pal.c2, pal.c3, valueNoise3(pos * pal.frequency, 21u)); }
  if (mode == 3u) { return rampColor(pal.c0, pal.c1, pal.c2, pal.c3, length(p.vel) / max(pal.range, 1e-3)); }
  return rampColor(pal.c0, pal.c1, pal.c2, pal.c3, p.age / max(pal.range, 1e-3));
}

fn groupTint(group: f32) -> vec3f {
  let g = u32(group) % 8u;
  var tints = array<vec3f, 8>(
    vec3f(1.0, 1.0, 1.0), vec3f(1.0, 0.72, 0.55), vec3f(0.6, 0.85, 1.0), vec3f(0.8, 1.0, 0.65),
    vec3f(1.0, 0.6, 0.9), vec3f(0.95, 0.95, 0.55), vec3f(0.7, 0.65, 1.0), vec3f(0.6, 1.0, 0.95),
  );
  return tints[g];
}

// colorMode: 0 constant, 1 palette, 2 speed, 3 age, 4 group, 5 density
fn particleColor(p: Particle, pos: vec3f) -> vec3f {
  let mode = u32(br.colorMode);
  if (mode == 1u && br.palette >= 0.0) { return paletteColor(u32(br.palette), p, pos); }
  if (mode == 2u) { return mix(br.color2, br.color, clamp(length(p.vel) / max(rb.frame.maxSpeed, 1e-3), 0.0, 1.0)); }
  if (mode == 3u) { return mix(br.color, br.color2, clamp(p.age / 6.0, 0.0, 1.0)); }
  if (mode == 4u) { return br.color * groupTint(p.group); }
  if (mode == 5u) { return mix(br.color2, br.color, clamp(p.neighbors / max(rb.frame.neighborLimit, 1.0), 0.0, 1.0)); }
  return br.color;
}

fn distanceFade(w: f32) -> f32 {
  return mix(1.0, clamp(2.5 / max(w, 1e-3), 0.12, 1.0), br.distanceFade);
}

struct LineVertex {
  clip: vec4f,
  side: f32,
  valid: bool,
};

// Screen-space expansion of a clipped world segment. corner: 0..5, end: which endpoint.
fn expandSegment(caIn: vec4f, cbIn: vec4f, corner: u32, widthA: f32, widthB: f32) -> LineVertex {
  var out: LineVertex;
  var ca = caIn;
  var cb = cbIn;
  if (ca.w < NEAR_W && cb.w < NEAR_W) { out.valid = false; out.clip = HIDDEN; return out; }
  if (ca.w < NEAR_W) { ca = mix(ca, cb, (NEAR_W - ca.w) / (cb.w - ca.w)); }
  if (cb.w < NEAR_W) { cb = mix(cb, ca, (NEAR_W - cb.w) / (ca.w - cb.w)); }
  let halfViewport = rb.frame.viewport * 0.5;
  let sa = ca.xy / ca.w * halfViewport;
  let sb = cb.xy / cb.w * halfViewport;
  var dir = sb - sa;
  let len = length(dir);
  if (len < 1e-4) { dir = vec2f(1.0, 0.0); } else { dir = dir / len; }
  let normal = vec2f(-dir.y, dir.x);
  var ends = array<u32, 6>(0u, 0u, 1u, 0u, 1u, 1u);
  var sides = array<f32, 6>(-1.0, 1.0, 1.0, -1.0, 1.0, -1.0);
  let useB = ends[corner] == 1u;
  let base = select(ca, cb, useB);
  let width = max(select(widthA, widthB, useB), 0.75);
  let offset = normal * sides[corner] * width * 0.5 / halfViewport;
  out.clip = vec4f(base.xy + offset * base.w, base.z, base.w);
  out.side = sides[corner];
  out.valid = true;
  return out;
}

fn premultiply(color: vec3f, alpha: f32) -> vec4f {
  let a = clamp(alpha, 0.0, 1.0);
  if (br.blend > 1.5) { return vec4f(color, 1.0); }
  return vec4f(color * a, a);
}
`;

const QUAD_CORNERS = /* wgsl */ `
fn quadCorner(index: u32) -> vec2f {
  var corners = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0),
  );
  return corners[index];
}
`;

export const FLOCK_POINTS_WGSL = /* wgsl */ `
${RENDER_COMMON}
${QUAD_CORNERS}

struct PointOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
};

@vertex
fn vsPoints(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> PointOut {
  var out: PointOut;
  let p = stateCur[ii];
  if (!isVisibleParticle(ii, p)) { out.clip = HIDDEN; return out; }
  let simPos = interpolatedPos(ii);
  let clip = toClip(simPos);
  let corner = quadCorner(vi);
  let size = max(0.0, br.size * (1.0 + br.sizeVariance * (p.rnd * 2.0 - 1.0)));
  var coverage = 1.0;
  if (br.sizeMode < 0.5) {
    let px = max(size, 1.0);
    coverage = min(1.0, size * size);
    out.clip = clip + vec4f(corner * px / rb.frame.viewport * clip.w, 0.0, 0.0);
  } else {
    let radius = size * 0.5 * rb.frame.worldUnitsPerSim;
    let world = toWorld(simPos) + (rb.frame.cameraRight * corner.x + rb.frame.cameraUp * corner.y) * radius;
    out.clip = rb.frame.viewProj * vec4f(world, 1.0);
    let projectedPx = radius * 2.0 * rb.frame.focalPx / max(clip.w, 1e-3);
    coverage = clamp(projectedPx * projectedPx, 0.02, 1.0);
  }
  out.uv = corner;
  out.color = vec4f(particleColor(p, simPos), br.opacity * distanceFade(clip.w) * coverage);
  return out;
}

@fragment
fn fsPoints(in: PointOut) -> @location(0) vec4f {
  let d = length(in.uv);
  let shape = u32(br.shape);
  var a = 0.0;
  if (shape == 0u) { a = 1.0 - smoothstep(0.75, 1.0, d); }
  else if (shape == 1u) { a = min(1.0, 1.35 * exp(-2.4 * d * d)) * (1.0 - smoothstep(0.85, 1.0, d)); }
  else if (shape == 2u) { a = 1.0 - smoothstep(0.85, 1.0, max(abs(in.uv.x), abs(in.uv.y))); }
  else if (shape == 3u) { a = 1.0 - smoothstep(0.1, 0.22, abs(d - 0.72)); }
  else { let s = abs(in.uv.x * in.uv.y); a = (1.0 - smoothstep(0.02, 0.09, s)) * (1.0 - smoothstep(0.7, 1.0, d)); }
  let alpha = in.color.a * a;
  if (br.blend > 1.5) { if (a < 0.5) { discard; } return vec4f(in.color.rgb, 1.0); }
  if (alpha <= 0.002) { discard; }
  return vec4f(in.color.rgb * alpha, alpha);
}
`;

export const FLOCK_INSTANCES_WGSL = /* wgsl */ `
${RENDER_COMMON}

struct MeshIn {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
};

struct MeshOut {
  @builtin(position) clip: vec4f,
  @location(0) color: vec4f,
  @location(1) normal: vec3f,
};

fn remapAxis(v: vec3f, axis: u32) -> vec3f {
  // Maps asset forward axis to +Z (0:+z 1:-z 2:+x 3:-x 4:+y 5:-y).
  if (axis == 1u) { return vec3f(-v.x, v.y, -v.z); }
  if (axis == 2u) { return vec3f(-v.z, v.y, v.x); }
  if (axis == 3u) { return vec3f(v.z, v.y, -v.x); }
  if (axis == 4u) { return vec3f(v.x, -v.z, v.y); }
  if (axis == 5u) { return vec3f(v.x, v.z, -v.y); }
  return v;
}

@vertex
fn vsInstances(mesh: MeshIn, @builtin(instance_index) ii: u32) -> MeshOut {
  var out: MeshOut;
  let p = stateCur[ii];
  if (!isVisibleParticle(ii, p)) { out.clip = HIDDEN; return out; }
  let simPos = interpolatedPos(ii);
  let forward = interpolatedForward(ii);
  var up0 = vec3f(0.0, 1.0, 0.0);
  if (abs(dot(forward, up0)) > 0.98) { up0 = vec3f(1.0, 0.0, 0.0); }
  let right = normalize(cross(up0, forward));
  let up = cross(forward, right);
  let axis = u32(br.forwardAxis);
  var local = remapAxis(mesh.position, axis);
  let n = remapAxis(mesh.normal, axis);
  let phase = p.rnd * TAU * br.phaseVar;
  let bendWeight = clamp(0.5 - local.z * 0.5, 0.0, 1.5);
  local.x += sin(phase + rb.frame.time * br.swimFreq * TAU - local.z * 3.0) * br.swimAmp * bendWeight * 0.5;
  let size = max(0.0, br.size * (1.0 + br.sizeVariance * (p.rnd * 2.0 - 1.0)));
  let simVertex = simPos + (right * local.x + up * local.y + forward * local.z) * size;
  out.clip = toClip(simVertex);
  let worldNormal = (rb.frame.world * vec4f(right * n.x + up * n.y + forward * n.z, 0.0)).xyz;
  out.normal = normalize(worldNormal + vec3f(1e-6));
  out.color = vec4f(particleColor(p, simPos), br.opacity * distanceFade(out.clip.w));
  return out;
}

@fragment
fn fsInstances(in: MeshOut) -> @location(0) vec4f {
  let shading = u32(br.shading);
  var shade = 1.0;
  if (shading == 0u) {
    let lightDir = normalize(vec3f(0.35, 0.8, 0.45));
    let n = normalize(in.normal);
    shade = 0.32 + 0.68 * abs(dot(n, lightDir));
  } else if (shading == 2u) {
    shade = 1.35;
  }
  return premultiply(in.color.rgb * shade, in.color.a);
}
`;

const LINE_FRAGMENT = /* wgsl */ `
struct LineOut {
  @builtin(position) clip: vec4f,
  @location(0) color: vec4f,
  @location(1) side: f32,
};

@fragment
fn fsLines(in: LineOut) -> @location(0) vec4f {
  let edge = 1.0 - smoothstep(0.55, 1.0, abs(in.side));
  let alpha = in.color.a * edge;
  if (br.blend > 1.5) { if (alpha < 0.3) { discard; } return vec4f(in.color.rgb, 1.0); }
  if (alpha <= 0.002) { discard; }
  return vec4f(in.color.rgb * alpha, alpha);
}
`;

export const FLOCK_LINKS_RENDER_WGSL = /* wgsl */ `
${RENDER_COMMON}
${LINE_FRAGMENT}

@group(1) @binding(1) var<storage, read> links: array<u32>;

@vertex
fn vsLinks(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LineOut {
  var out: LineOut;
  let perParticle = max(1u, u32(br.perParticle));
  let linkTarget = links[ii];
  if (linkTarget == 0u) { out.clip = HIDDEN; return out; }
  let i = ii / perParticle;
  let j = linkTarget - 1u;
  let pa = stateCur[i];
  let pb = stateCur[j];
  if (!isVisibleParticle(i, pa) || pb.age < 0.0) { out.clip = HIDDEN; return out; }
  let a = interpolatedPos(i);
  let b = interpolatedPos(j);
  let dist = length(b - a);
  let fade = 1.0 - smoothstep(br.radius * (1.0 - br.fadeBand), br.radius, dist);
  if (fade <= 0.0) { out.clip = HIDDEN; return out; }
  let line = expandSegment(toClip(a), toClip(b), vi % 6u, br.width, br.width);
  if (!line.valid) { out.clip = HIDDEN; return out; }
  var color = br.color;
  let mode = u32(br.colorMode);
  if (mode == 6u) { color = mix(br.color, br.color2, clamp(dist / max(br.radius, 1e-3), 0.0, 1.0)); }
  else if (mode == 1u && br.palette >= 0.0) { color = paletteColor(u32(br.palette), pa, a); }
  else if (mode == 4u) { color = br.color * groupTint(pa.group); }
  out.clip = line.clip;
  out.side = line.side;
  out.color = vec4f(color, br.opacity * fade * distanceFade(line.clip.w));
  return out;
}
`;

export const FLOCK_VECTORS_WGSL = /* wgsl */ `
${RENDER_COMMON}
${LINE_FRAGMENT}

@vertex
fn vsVectors(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LineOut {
  var out: LineOut;
  let p = stateCur[ii];
  if (!isVisibleParticle(ii, p) || flockHash01(ii, u32(br.salt)) >= br.fraction) { out.clip = HIDDEN; return out; }
  let a = interpolatedPos(ii);
  var delta = p.vel * br.scale;
  if (br.mode > 0.5) { delta = interpolatedForward(ii) * br.scale * 20.0; }
  let b = a + delta;
  let corner = vi % 6u;
  let line = expandSegment(toClip(a), toClip(b), corner, br.width, br.width);
  if (!line.valid) { out.clip = HIDDEN; return out; }
  var ends = array<f32, 6>(0.0, 0.0, 1.0, 0.0, 1.0, 1.0);
  let t = ends[corner];
  out.clip = line.clip;
  out.side = line.side;
  let color = particleColor(p, a);
  out.color = vec4f(mix(color * 0.35, color, t), br.opacity * mix(0.2, 1.0, t) * distanceFade(line.clip.w));
  return out;
}
`;

const TRAIL_ACCESS = /* wgsl */ `
@group(1) @binding(1) var<storage, read> ring: array<vec4f>;
@group(1) @binding(2) var<storage, read> slots: array<u32>;

// k = 0: live interpolated particle; k >= 1: ring sample of age k - 1.
fn trailPoint(slot: u32, kIn: i32) -> vec4f {
  let particleIndex = slots[slot];
  let particle = stateCur[particleIndex];
  if (kIn <= 0) {
    var tag = 0.0;
    if (particle.age >= 0.0) { tag = particle.gen; }
    return vec4f(interpolatedPos(particleIndex), tag);
  }
  let samples = max(1u, u32(br.samples));
  let age = min(u32(kIn - 1), samples - 1u);
  let head = u32(br.headRing) % samples;
  let idx = (head + samples - age) % samples;
  return ring[slot * samples + idx];
}
`;

export const FLOCK_CURVES_WGSL = /* wgsl */ `
${RENDER_COMMON}
${LINE_FRAGMENT}
${TRAIL_ACCESS}

fn curvePos(slot: u32, u: f32) -> vec4f {
  let samples = i32(max(1u, u32(br.samples)));
  let k = i32(floor(u));
  let f = u - f32(k);
  let p1 = trailPoint(slot, k);
  let p2 = trailPoint(slot, min(k + 1, samples));
  if (br.smoothing < 0.5) { return vec4f(mix(p1.xyz, p2.xyz, f), min(p1.w, p2.w)); }
  let p0 = trailPoint(slot, max(k - 1, 0));
  let p3 = trailPoint(slot, min(k + 2, samples));
  return vec4f(catmull(p0.xyz, p1.xyz, p2.xyz, p3.xyz, f), min(p1.w, p2.w));
}

@vertex
fn vsCurves(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LineOut {
  var out: LineOut;
  let slot = ii;
  let particle = stateCur[slots[slot]];
  if (!isVisibleParticle(slots[slot], particle)) { out.clip = HIDDEN; return out; }
  let subdivisions = max(1u, u32(br.subdivisions));
  let samples = max(1u, u32(br.samples));
  let segment = vi / 6u;
  let corner = vi % 6u;
  let u0 = f32(segment) / f32(subdivisions);
  let u1 = f32(segment + 1u) / f32(subdivisions);
  let kA = i32(floor(u0));
  let tag = particle.gen;
  let rawA = trailPoint(slot, kA);
  let rawB = trailPoint(slot, kA + 1);
  if (rawA.w != tag || rawB.w != tag || tag <= 0.0) { out.clip = HIDDEN; return out; }
  let jump = rawB.xyz - rawA.xyz;
  let breakDistance = sqrt(rb.frame.teleport2) * max(br.interval, 1.0);
  if (dot(jump, jump) > breakDistance * breakDistance) { out.clip = HIDDEN; return out; }
  let a = curvePos(slot, u0);
  let b = curvePos(slot, u1);
  let span = f32(samples);
  let tA = u0 / span;
  let tB = u1 / span;
  let line = expandSegment(toClip(a.xyz), toClip(b.xyz), corner, br.width * mix(1.0, br.taper, tA), br.width * mix(1.0, br.taper, tB));
  if (!line.valid) { out.clip = HIDDEN; return out; }
  var ends = array<f32, 6>(0.0, 0.0, 1.0, 0.0, 1.0, 1.0);
  let t = mix(tA, tB, ends[corner]);
  var color = br.color;
  let mode = u32(br.colorMode);
  if (mode == 1u && br.palette >= 0.0) { color = paletteColor(u32(br.palette), particle, a.xyz); }
  else if (mode == 4u) { color = br.color * groupTint(particle.group); }
  else if (mode == 7u) { color = mix(br.color, br.color2, t); }
  out.clip = line.clip;
  out.side = line.side;
  out.color = vec4f(color, br.opacity * mix(1.0, 1.0 - br.fadeTail, t) * distanceFade(line.clip.w));
  return out;
}
`;

const GLYPH_ANCHOR = /* wgsl */ `
${TRAIL_ACCESS}

struct GlyphAnchor { pos: vec3f, valid: bool, particle: u32, };

// anchor: 0 particles, 1 trail head, 2 trail tail
fn glyphAnchor(instance: u32) -> GlyphAnchor {
  var result: GlyphAnchor;
  result.valid = false;
  let anchor = u32(br.anchor);
  if (anchor == 0u) {
    let p = stateCur[instance];
    if (p.age < 0.0 || flockHash01(instance, 131u) >= br.fraction) { return result; }
    result.pos = interpolatedPos(instance);
    result.particle = instance;
    result.valid = true;
    return result;
  }
  if (instance >= u32(br.slotCount) || flockHash01(instance, 137u) >= br.fraction) { return result; }
  let particleIndex = slots[instance];
  let p = stateCur[particleIndex];
  if (p.age < 0.0) { return result; }
  result.particle = particleIndex;
  if (anchor == 1u) {
    result.pos = interpolatedPos(particleIndex);
    result.valid = true;
    return result;
  }
  let samples = max(1u, u32(br.samples));
  for (var k = i32(samples); k >= 1; k--) {
    let ringSample = trailPoint(instance, k);
    if (ringSample.w == p.gen) {
      result.pos = ringSample.xyz;
      result.valid = true;
      return result;
    }
  }
  return result;
}

fn glyphBasis(particle: u32) -> mat3x3f {
  if (br.orientation < 0.5) {
    let forward = normalize(cross(rb.frame.cameraRight, rb.frame.cameraUp));
    return mat3x3f(rb.frame.cameraRight, rb.frame.cameraUp, forward);
  }
  let forward = interpolatedForward(particle);
  var up0 = vec3f(0.0, 1.0, 0.0);
  if (abs(dot(forward, up0)) > 0.98) { up0 = vec3f(1.0, 0.0, 0.0); }
  let right = normalize(cross(up0, forward));
  return mat3x3f(right, cross(forward, right), forward);
}
`;

export const FLOCK_GLYPHS_WGSL = /* wgsl */ `
${RENDER_COMMON}
${QUAD_CORNERS}
${GLYPH_ANCHOR}

struct GlyphOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
};

@vertex
fn vsGlyphs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GlyphOut {
  var out: GlyphOut;
  let anchor = glyphAnchor(ii);
  if (!anchor.valid) { out.clip = HIDDEN; return out; }
  let p = stateCur[anchor.particle];
  let clip = toClip(anchor.pos);
  let corner = quadCorner(vi);
  if (br.sizeMode < 0.5 && br.orientation < 0.5) {
    out.clip = clip + vec4f(corner * br.size / rb.frame.viewport * clip.w, 0.0, 0.0);
  } else {
    let basis = glyphBasis(anchor.particle);
    var radius = br.size * 0.5 * rb.frame.worldUnitsPerSim;
    if (br.sizeMode < 0.5) { radius = br.size * 0.5 * clip.w / max(rb.frame.focalPx, 1.0); }
    let world = toWorld(anchor.pos) + (basis[0] * corner.x + basis[1] * corner.y) * radius;
    out.clip = rb.frame.viewProj * vec4f(world, 1.0);
  }
  out.uv = corner;
  var color = br.color;
  if (u32(br.colorMode) == 1u && br.palette >= 0.0) { color = paletteColor(u32(br.palette), p, anchor.pos); }
  else if (u32(br.colorMode) == 4u) { color = br.color * groupTint(p.group); }
  out.color = vec4f(color, br.opacity * distanceFade(clip.w));
  return out;
}

@fragment
fn fsGlyphs(in: GlyphOut) -> @location(0) vec4f {
  let glyph = u32(br.shape);
  let d = length(in.uv);
  let box = max(abs(in.uv.x), abs(in.uv.y));
  let thickness = 0.16 * max(br.lineWidth, 0.5);
  var a = 0.0;
  if (glyph == 0u) { a = 1.0 - smoothstep(0.7, 1.0, d); }
  else if (glyph == 1u) { a = 1.0 - smoothstep(thickness * 0.5, thickness, abs(d - 0.8)); }
  else if (glyph == 2u) { a = (1.0 - smoothstep(thickness * 0.5, thickness, abs(box - 0.85))); }
  else if (glyph == 4u) { a = max(1.0 - smoothstep(thickness * 0.4, thickness * 0.8, abs(in.uv.x)), 1.0 - smoothstep(thickness * 0.4, thickness * 0.8, abs(in.uv.y))) * step(box, 1.0); }
  else { a = 1.0 - smoothstep(thickness * 0.5, thickness, abs(abs(in.uv.x) + abs(in.uv.y) - 0.85)); }
  let alpha = in.color.a * a;
  if (br.blend > 1.5) { if (a < 0.5) { discard; } return vec4f(in.color.rgb, 1.0); }
  if (alpha <= 0.002) { discard; }
  return vec4f(in.color.rgb * alpha, alpha);
}
`;

export const FLOCK_GLYPH_CUBES_WGSL = /* wgsl */ `
${RENDER_COMMON}
${LINE_FRAGMENT}
${GLYPH_ANCHOR}

fn cubeEdge(index: u32) -> vec2u {
  var edges = array<vec2u, 12>(
  vec2u(0u, 1u), vec2u(1u, 3u), vec2u(3u, 2u), vec2u(2u, 0u),
  vec2u(4u, 5u), vec2u(5u, 7u), vec2u(7u, 6u), vec2u(6u, 4u),
  vec2u(0u, 4u), vec2u(1u, 5u), vec2u(2u, 6u), vec2u(3u, 7u),
  );
  return edges[index];
}

fn cubeCorner(index: u32) -> vec3f {
  return vec3f(select(-1.0, 1.0, (index & 1u) != 0u), select(-1.0, 1.0, (index & 2u) != 0u), select(-1.0, 1.0, (index & 4u) != 0u));
}

@vertex
fn vsGlyphCubes(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LineOut {
  var out: LineOut;
  let anchor = glyphAnchor(ii);
  if (!anchor.valid) { out.clip = HIDDEN; return out; }
  let p = stateCur[anchor.particle];
  let edge = cubeEdge((vi / 6u) % 12u);
  var basis = mat3x3f(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0));
  if (br.orientation > 0.5) { basis = glyphBasis(anchor.particle); }
  var halfSize = br.size * 0.5;
  if (br.sizeMode < 0.5) { halfSize = br.size * 0.5 * toClip(anchor.pos).w / max(rb.frame.focalPx * rb.frame.worldUnitsPerSim, 1e-6); }
  let a = anchor.pos + basis * cubeCorner(edge.x) * halfSize;
  let b = anchor.pos + basis * cubeCorner(edge.y) * halfSize;
  let line = expandSegment(toClip(a), toClip(b), vi % 6u, br.lineWidth, br.lineWidth);
  if (!line.valid) { out.clip = HIDDEN; return out; }
  var color = br.color;
  if (u32(br.colorMode) == 1u && br.palette >= 0.0) { color = paletteColor(u32(br.palette), p, anchor.pos); }
  out.clip = line.clip;
  out.side = line.side;
  out.color = vec4f(color, br.opacity * distanceFade(line.clip.w));
  return out;
}
`;
