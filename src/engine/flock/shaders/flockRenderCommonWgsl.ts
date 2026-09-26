import { FLOCK_WGSL_MATH, FLOCK_WGSL_STRUCTS, flockSelectionWgsl } from './flockWgslShared';

/**
 * Shared render prelude for flock branches. Group 0 carries the per-layer render
 * block, both state samples (previous / current step) and the shadow map; group 1
 * carries the branch uniform, branch-specific buffers and the pigment image.
 */

export const RENDER_COMMON = /* wgsl */ `
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

// Directional key light. viewProj maps simulation space to the shadow map;
// dir points toward the light in world space.
struct LightParams {
  viewProj: mat4x4f,
  dir: vec3f, enabled: f32,
  ambient: f32, shadowStrength: f32, texel: f32, bias: f32,
};

struct RenderBlock {
  frame: FrameParams,
  selections: array<Selection, 16>,
  palettes: array<Palette, 8>,
  // Per emitter: offset, count, grid columns (0 = not a grid), grid rows.
  grids: array<vec4f, 8>,
  light: LightParams,
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
  blend: f32, widthMode: f32, children: f32, childSpread: f32,
  // Kind-specific extras: points (relief, -, -, -); room (center.xyz, frame) and (size.xyz, ao).
  ext0: vec4f,
  ext1: vec4f,
};

@group(0) @binding(0) var<uniform> rb: RenderBlock;
@group(0) @binding(1) var<storage, read> stateCur: array<Particle>;
@group(0) @binding(2) var<storage, read> statePrev: array<Particle>;
@group(0) @binding(3) var shadowMap: texture_depth_2d;
@group(0) @binding(4) var shadowSampler: sampler_comparison;
@group(1) @binding(0) var<uniform> br: Branch;
@group(1) @binding(8) var pigmentTex: texture_2d<f32>;
@group(1) @binding(9) var pigmentSampler: sampler;

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

/** Source-image coordinate a particle was born on: its grid cell, or a stable random pixel. */
fn pigmentUv(index: u32, p: Particle) -> vec2f {
  let g = rb.grids[min(u32(p.emitter), 7u)];
  if (g.z >= 1.0) {
    let local = f32(index) - g.x;
    let row = floor(local / g.z);
    let col = local - row * g.z;
    return vec2f((col + 0.5) / g.z, (row + 0.5) / max(g.w, 1.0));
  }
  return vec2f(p.rnd, fract(p.rnd * 97.31 + 0.13));
}

// colorMode 8 samples the branch image at the particle's pigment coordinate.
fn branchColorAt(p: Particle, pos: vec3f, uv: vec2f) -> vec3f {
  if (u32(br.colorMode) == 8u) {
    return textureSampleLevel(pigmentTex, pigmentSampler, uv, 0.0).rgb;
  }
  return particleColor(p, pos);
}

fn branchColor(index: u32, p: Particle, pos: vec3f) -> vec3f {
  return branchColorAt(p, pos, pigmentUv(index, p));
}

struct ChildSample { pos: vec3f, uv: vec2f, };

fn neighborPos(index: u32, fallback: vec3f, maxGap2: f32) -> vec3f {
  let q = stateCur[index];
  if (q.age < 0.0) { return fallback; }
  let pos = interpolatedPos(index);
  let d = pos - fallback;
  if (dot(d, d) > maxGap2) { return fallback; }
  return pos;
}

/**
 * Render-only sub-particle: grid emitters fill the surface bilinearly between a
 * particle and its right/down neighbors (so folds stay sharp); other emitters
 * scatter children inside childSpread. Child 0 is the simulated particle.
 */
fn childSample(parent: u32, child: u32, p: Particle, parentPos: vec3f) -> ChildSample {
  var out: ChildSample;
  out.pos = parentPos;
  out.uv = pigmentUv(parent, p);
  if (child == 0u) { return out; }
  let salt = child * 7919u + 17u;
  let u = flockHash01(parent, salt);
  let v = flockHash01(parent, salt + 1u);
  let g = rb.grids[min(u32(p.emitter), 7u)];
  if (g.z >= 1.0) {
    let local = f32(parent) - g.x;
    let row = floor(local / g.z);
    let col = local - row * g.z;
    if (col + 1.0 < g.z && row + 1.0 < g.w) {
      let cols = u32(g.z);
      let maxGap2 = br.childSpread * br.childSpread * 64.0 + 1e-3;
      let right = neighborPos(parent + 1u, parentPos, maxGap2);
      let down = neighborPos(parent + cols, parentPos, maxGap2);
      let diag = neighborPos(parent + cols + 1u, parentPos, maxGap2);
      out.pos = mix(mix(parentPos, right, u), mix(down, diag, u), v);
      out.uv = out.uv + vec2f(u / g.z, v / max(g.w, 1.0));
      return out;
    }
  }
  let w = flockHash01(parent, salt + 2u);
  out.pos = parentPos + (vec3f(u, v, w) - vec3f(0.5)) * br.childSpread;
  return out;
}

fn lightClip(simPos: vec3f) -> vec4f {
  return rb.light.viewProj * vec4f(simPos, 1.0);
}

/** 3x3 PCF visibility of a simulation-space point in the key light's shadow map (1 = lit). */
fn shadowVisibility(simPos: vec3f) -> f32 {
  if (rb.light.enabled < 0.5) { return 1.0; }
  let lc = lightClip(simPos);
  let ndc = lc.xyz / lc.w;
  let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || ndc.z > 1.0) { return 1.0; }
  var sum = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let offset = vec2f(f32(x), f32(y)) * rb.light.texel;
      sum += textureSampleCompareLevel(shadowMap, shadowSampler, uv + offset, ndc.z - rb.light.bias);
    }
  }
  return mix(1.0, sum / 9.0, rb.light.shadowStrength);
}

fn litColor(albedo: vec3f, normal: vec3f, visibility: f32) -> vec3f {
  let diffuse = max(dot(normal, rb.light.dir), 0.0);
  return albedo * (rb.light.ambient + (1.0 - rb.light.ambient) * diffuse * visibility);
}

/** Pigment-luminance relief along the emitter normal (+z), in simulation units. */
fn reliefOffset(uv: vec2f) -> vec3f {
  if (br.ext0.x == 0.0) { return vec3f(0.0); }
  let rgb = textureSampleLevel(pigmentTex, pigmentSampler, uv, 0.0).rgb;
  return vec3f(0.0, 0.0, dot(rgb, vec3f(0.2126, 0.7152, 0.0722)) * br.ext0.x);
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

export const QUAD_CORNERS = /* wgsl */ `
fn quadCorner(index: u32) -> vec2f {
  var corners = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0),
  );
  return corners[index];
}
`;
