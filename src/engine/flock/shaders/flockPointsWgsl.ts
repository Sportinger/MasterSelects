import { QUAD_CORNERS, RENDER_COMMON } from './flockRenderCommonWgsl';

/**
 * Point sprites, optionally lit as sphere impostors that receive the key
 * light's shadow map, plus the depth-only entry points that render points into
 * that shadow map. Sub-particles and pigment relief apply to both.
 *
 * Two render variants exist: the direct one evaluates each point in the
 * vertex shader (six times per sprite), the cached one reads a per-point
 * record (position, color, shadow visibility) that a compute prepass wrote
 * once per frame. Dense sub-particle canvases use the cached variant.
 */

export const POINT_BASE = /* wgsl */ `
struct PointOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
  @location(2) viewDir: vec3f,
  @location(3) visibility: f32,
};

struct PointSample {
  visible: bool,
  simPos: vec3f,
  uv: vec2f,
  parent: u32,
  sizeRnd: f32,
};

fn pointSample(instIdx: u32) -> PointSample {
  var out: PointSample;
  let childCount = max(1u, u32(br.children));
  let ii = instIdx / childCount;
  let p = stateCur[ii];
  out.visible = isVisibleParticle(ii, p);
  if (!out.visible) { return out; }
  let child = childSample(ii, instIdx % childCount, p, interpolatedPos(ii));
  out.simPos = child.pos + reliefOffset(child.uv);
  out.uv = child.uv;
  out.parent = ii;
  out.sizeRnd = select(p.rnd, flockHash01(instIdx, 911u), childCount > 1u);
  return out;
}

fn pointsLit() -> bool {
  return br.shading < 0.5;
}
`;

const POINT_VERTEX = /* wgsl */ `
// Small screen-space points draw one triangle circumscribing the unit disc
// (half the triangles of a quad); larger sprites keep the quad (ext0.y flag).
fn spriteCorner(vi: u32) -> vec2f {
  if (br.ext0.y > 0.5) {
    var tri = array<vec2f, 3>(vec2f(-1.7320508, -1.0), vec2f(1.7320508, -1.0), vec2f(0.0, 2.0));
    return tri[vi % 3u];
  }
  return quadCorner(vi);
}

fn pointVertex(vi: u32, simPos: vec3f, color: vec3f, sizeRnd: f32, visibility: f32) -> PointOut {
  var out: PointOut;
  let clip = toClip(simPos);
  let corner = spriteCorner(vi);
  let size = max(0.0, br.size * (1.0 + br.sizeVariance * (sizeRnd * 2.0 - 1.0)));
  var coverage = 1.0;
  if (br.sizeMode < 0.5) {
    let referenceSize = size * rb.frame.viewport.y / 1080.0;
    let px = max(referenceSize, 1.0);
    coverage = min(1.0, referenceSize * referenceSize);
    out.clip = clip + vec4f(corner * px / rb.frame.viewport * clip.w, 0.0, 0.0);
  } else {
    let radius = size * 0.5 * rb.frame.worldUnitsPerSim;
    let world = toWorld(simPos) + (rb.frame.cameraRight * corner.x + rb.frame.cameraUp * corner.y) * radius;
    out.clip = rb.frame.viewProj * vec4f(world, 1.0);
    let projectedPx = radius * 2.0 * rb.frame.focalPx / max(clip.w, 1e-3);
    coverage = clamp(projectedPx * projectedPx, 0.02, 1.0);
  }
  out.uv = corner;
  out.color = vec4f(color, br.opacity * distanceFade(clip.w) * coverage);
  out.viewDir = normalize(rb.frame.cameraPos - toWorld(simPos));
  out.visibility = visibility;
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
  var rgb = in.color.rgb;
  if (pointsLit()) {
    // Sphere impostor normal from the sprite coordinate.
    let nz = sqrt(max(0.0, 1.0 - min(d * d, 1.0)));
    let normal = normalize(rb.frame.cameraRight * in.uv.x + rb.frame.cameraUp * in.uv.y + in.viewDir * nz);
    rgb = litColor(rgb, normal, in.visibility);
  }
  let alpha = in.color.a * a;
  if (br.blend > 1.5) { if (a < 0.5) { discard; } return vec4f(rgb, 1.0); }
  if (alpha <= 0.002) { discard; }
  return vec4f(rgb * alpha, alpha);
}

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
};

fn shadowVertex(vi: u32, simPos: vec3f) -> ShadowOut {
  var out: ShadowOut;
  let clip = lightClip(simPos);
  let corner = spriteCorner(vi);
  // Footprint in shadow-map texels, wide enough to close gaps between neighbors.
  let radius = (1.0 + br.size * 0.35) * max(1.0, br.ext0.z);
  out.clip = clip + vec4f(corner * radius * 2.0 * rb.light.texel * clip.w, 0.0, 0.0);
  out.uv = corner;
  return out;
}

@fragment
fn fsPointsShadow(in: ShadowOut) {
  if (dot(in.uv, in.uv) > 1.0) { discard; }
}
`;

export const FLOCK_POINTS_WGSL = /* wgsl */ `
${RENDER_COMMON}
${QUAD_CORNERS}
${POINT_BASE}
${POINT_VERTEX}

@vertex
fn vsPoints(@builtin(vertex_index) vi: u32, @builtin(instance_index) instIdx: u32) -> PointOut {
  let s = pointSample(instIdx);
  if (!s.visible) { var hidden: PointOut; hidden.clip = HIDDEN; return hidden; }
  let color = branchColorAt(stateCur[s.parent], s.simPos, s.uv);
  var visibility = 1.0;
  if (pointsLit()) { visibility = shadowVisibility(s.simPos); }
  return pointVertex(vi, s.simPos, color, s.sizeRnd, visibility);
}

@vertex
fn vsPointsShadow(@builtin(vertex_index) vi: u32, @builtin(instance_index) instIdx: u32) -> ShadowOut {
  let s = pointSample(instIdx);
  if (!s.visible) { var hidden: ShadowOut; hidden.clip = HIDDEN; return hidden; }
  return shadowVertex(vi, s.simPos);
}
`;

/** One cached point: simulation position and rgb + shadow visibility packed as unorm8 (0 = hidden). */
export const POINT_RECORD = /* wgsl */ `
struct PointRecord { pos: vec3f, packed: u32, };
const VISIBILITY_FLOOR: f32 = 1.0 / 255.0;

fn recordVisibility(packed: u32) -> f32 {
  return clamp((unpack4x8unorm(packed).a - VISIBILITY_FLOOR) * (255.0 / 254.0), 0.0, 1.0);
}
`;

export const FLOCK_POINTS_CACHED_WGSL = /* wgsl */ `
${RENDER_COMMON}
${QUAD_CORNERS}
${POINT_BASE}
${POINT_VERTEX}
${POINT_RECORD}

@group(2) @binding(0) var<storage, read> pointCache: array<PointRecord>;

@vertex
fn vsPointsCached(@builtin(vertex_index) vi: u32, @builtin(instance_index) instIdx: u32) -> PointOut {
  let record = pointCache[instIdx];
  if (record.packed == 0u) { var hidden: PointOut; hidden.clip = HIDDEN; return hidden; }
  var visibility = 1.0;
  if (pointsLit()) { visibility = recordVisibility(record.packed); }
  let sizeRnd = select(stateCur[instIdx / max(1u, u32(br.children))].rnd, flockHash01(instIdx, 911u), br.children > 1.0);
  return pointVertex(vi, record.pos, unpack4x8unorm(record.packed).rgb, sizeRnd, visibility);
}

@vertex
fn vsPointsShadowCached(@builtin(vertex_index) vi: u32, @builtin(instance_index) instIdx: u32) -> ShadowOut {
  let record = pointCache[instIdx];
  if (record.packed == 0u) { var hidden: ShadowOut; hidden.clip = HIDDEN; return hidden; }
  return shadowVertex(vi, record.pos);
}
`;

export const FLOCK_POINT_CACHE_WORKGROUP = 256;

export const FLOCK_POINTS_CACHE_COMPUTE_WGSL = /* wgsl */ `
${RENDER_COMMON}
${POINT_BASE}
${POINT_RECORD}

struct CacheParams { total: u32, dispatchWidth: u32, pad1: u32, pad2: u32, };

@group(2) @binding(0) var<storage, read_write> pointCache: array<PointRecord>;
@group(2) @binding(1) var<uniform> cacheParams: CacheParams;

@compute @workgroup_size(${FLOCK_POINT_CACHE_WORKGROUP})
fn cachePoints(@builtin(global_invocation_id) gid: vec3u) {
  let index = gid.x + gid.y * cacheParams.dispatchWidth;
  if (index >= cacheParams.total) { return; }
  let s = pointSample(index);
  if (!s.visible) { pointCache[index] = PointRecord(vec3f(0.0), 0u); return; }
  let color = branchColorAt(stateCur[s.parent], s.simPos, s.uv);
  pointCache[index] = PointRecord(s.simPos, pack4x8unorm(vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0)));
}

@compute @workgroup_size(${FLOCK_POINT_CACHE_WORKGROUP})
fn cacheVisibility(@builtin(global_invocation_id) gid: vec3u) {
  let index = gid.x + gid.y * cacheParams.dispatchWidth;
  if (index >= cacheParams.total) { return; }
  let record = pointCache[index];
  if (record.packed == 0u) { return; }
  let visibility = shadowVisibility(record.pos);
  let color = unpack4x8unorm(record.packed);
  pointCache[index].packed = pack4x8unorm(vec4f(color.rgb, VISIBILITY_FLOOR + visibility * (254.0 / 255.0)));
}
`;
