import { QUAD_CORNERS, RENDER_COMMON } from './flockRenderCommonWgsl';

/** Render shaders for mesh, line and glyph flock branches (points live in flockPointsWgsl.ts). */

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
  @location(2) visibility: f32,
};

struct InstanceVertex {
  visible: bool,
  simPos: vec3f,
  simVertex: vec3f,
  worldNormal: vec3f,
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

fn instanceVertex(mesh: MeshIn, ii: u32) -> InstanceVertex {
  var out: InstanceVertex;
  let p = stateCur[particleSlot(ii)];
  out.visible = isVisibleParticle(ii, p);
  if (!out.visible) { return out; }
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
  out.simPos = simPos;
  out.simVertex = simPos + (right * local.x + up * local.y + forward * local.z) * size;
  let worldNormal = (rb.frame.world * vec4f(right * n.x + up * n.y + forward * n.z, 0.0)).xyz;
  out.worldNormal = normalize(worldNormal + vec3f(1e-6));
  return out;
}

@vertex
fn vsInstances(mesh: MeshIn, @builtin(instance_index) ii: u32) -> MeshOut {
  var out: MeshOut;
  let v = instanceVertex(mesh, ii);
  if (!v.visible) { out.clip = HIDDEN; return out; }
  out.clip = toClip(v.simVertex);
  out.normal = v.worldNormal;
  out.color = vec4f(branchColor(ii, stateCur[particleSlot(ii)], v.simPos), br.opacity * distanceFade(out.clip.w));
  out.visibility = shadowVisibility(v.simVertex);
  return out;
}

@vertex
fn vsInstancesShadow(mesh: MeshIn, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  let v = instanceVertex(mesh, ii);
  if (!v.visible) { return HIDDEN; }
  return lightClip(v.simVertex);
}

@fragment
fn fsInstances(in: MeshOut) -> @location(0) vec4f {
  let shading = u32(br.shading);
  var shade = 1.0;
  if (shading == 0u && rb.light.enabled > 0.5) {
    return premultiply(litColor(in.color.rgb, normalize(in.normal), in.visibility), in.color.a);
  }
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
  let pa = stateCur[particleSlot(i)];
  let pb = stateCur[particleSlot(j)];
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
  let p = stateCur[particleSlot(ii)];
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
  let color = branchColor(ii, p, a);
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
  let particle = stateCur[particleSlot(particleIndex)];
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
  let particle = stateCur[particleSlot(slots[slot])];
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
    let p = stateCur[particleSlot(instance)];
    if (p.age < 0.0 || flockHash01(instance, 131u) >= br.fraction) { return result; }
    result.pos = interpolatedPos(instance);
    result.particle = instance;
    result.valid = true;
    return result;
  }
  if (instance >= u32(br.slotCount) || flockHash01(instance, 137u) >= br.fraction) { return result; }
  let particleIndex = slots[instance];
  let p = stateCur[particleSlot(particleIndex)];
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
  let p = stateCur[particleSlot(anchor.particle)];
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
  let p = stateCur[particleSlot(anchor.particle)];
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
