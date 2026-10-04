// Path tracing common declarations: the byte layouts of ptLayouts.ts (checked by ptLayouts.test.ts),
// shared types of the fixed interfaces and small helpers. No bindings: PtSceneBindings.wgsl adds the
// fixed groups 0-2, every pass declares its own group 3.
//
// Fixed interfaces (each pipeline composes the modules that implement the ones it calls):
//   pt_trace_closest(ray: PtRay) -> PtHit                      bvh/PtTraverse.wgsl
//   pt_trace_transmittance(ray: PtRay, tMax: f32) -> f32       bvh/PtTraverse.wgsl
//   pt_bsdf_eval(s: PtSurface, wo: vec3f, wi: vec3f) -> vec3f  materials/PtBsdf.wgsl
//   pt_bsdf_sample(s: PtSurface, wo: vec3f, u: vec3f) -> PtBsdfSample
//   pt_bsdf_pdf(s: PtSurface, wo: vec3f, wi: vec3f) -> f32
//   pt_sample_light(p: vec3f, n: vec3f, u: vec3f) -> PtLightSample   lights/PtLights.wgsl
//   pt_cache_query(p: vec3f, n: vec3f, spread: f32) -> vec4f    realtime/PtRadianceCache.wgsl
//   pt_cache_update(p: vec3f, n: vec3f, spread: f32, radiance: vec3f)

const PT_PI: f32 = 3.14159265358979;
const PT_TWO_PI: f32 = 6.28318530717959;
const PT_INV_PI: f32 = 0.318309886183791;
const PT_INFINITY: f32 = 3.0e38;
const PT_LEAF_BIT: u32 = 0x80000000u;

const PT_PRIMITIVE_FIBER: u32 = 0u;
const PT_PRIMITIVE_TRIANGLE: u32 = 1u;
const PT_PRIMITIVE_QUAD: u32 = 2u;
const PT_PRIMITIVE_SPHERE: u32 = 3u;
const PT_PRIMITIVE_BOX: u32 = 4u;

const PT_FIBER_FLAG_FLYAWAY: u32 = 0x10000u;
const PT_FIBER_FLAG_HIDDEN: u32 = 0x20000u;
const PT_MELANIN_RANGE: f32 = 8.0;
const PT_ROUGHNESS_SCALE_RANGE: f32 = 2.0;

const PT_INSTANCE_FLAG_CASTS_SHADOW: u32 = 1u;
const PT_INSTANCE_FLAG_VISIBLE_TO_CAMERA: u32 = 2u;
const PT_INSTANCE_FLAG_ALPHA: u32 = 4u;
const PT_INSTANCE_FLAG_DOUBLE_SIDED: u32 = 8u;

const PT_LIGHT_SPHERE: u32 = 1u;
const PT_LIGHT_RECT: u32 = 2u;
const PT_LIGHT_ENVIRONMENT: u32 = 3u;
const PT_LIGHT_DISTANT: u32 = 4u;
const PT_MAX_LIGHTS: u32 = 256u;

const PT_MATERIAL_FIBER: u32 = 1u;
const PT_MATERIAL_SURFACE: u32 = 2u;
const PT_MATERIAL_FLAG_COLOR_FIELD: u32 = 1u;
const PT_MATERIAL_FLAG_MELANIN_FIELD: u32 = 2u;
const PT_MATERIAL_FLAG_ROUGHNESS_FIELD: u32 = 4u;
const PT_MAX_MATERIALS: u32 = 512u;

const PT_GBUFFER_HIT: u32 = 1u;
const PT_GBUFFER_FIBER: u32 = 2u;
const PT_GBUFFER_EMISSIVE: u32 = 4u;
const PT_GBUFFER_ALPHA: u32 = 8u;

const PT_MODE_PREVIEW: u32 = 0u;
const PT_MODE_STILL: u32 = 1u;
const PT_MODE_EXPORT: u32 = 2u;

const PT_CACHE_RADIANCE_SCALE: f32 = 1024.0;

struct PtFiberSegment {
  a: vec4f,        // p0 (scene space), radius at p0
  b: vec4f,        // p1, radius at p1
  material: u32,   // bits 0-15 material index, 16-23 flags
  attr0: u32,      // unorm4x8 color (rgb) + roughness scale / 2 at p0
  attr1: u32,      // same at p1
  melanin: u32,    // unorm2x16 melanin / PT_MELANIN_RANGE at p0, p1
};

struct PtBvhNode {
  boundsMin: vec3f,
  left: u32,       // child node index, or PT_LEAF_BIT | primitive
  boundsMax: vec3f,
  right: u32,      // child node index, or primitive count of a leaf
};

struct PtInstance {
  worldToObject0: vec4f,
  worldToObject1: vec4f,
  worldToObject2: vec4f,
  objectToWorld0: vec4f,
  objectToWorld1: vec4f,
  objectToWorld2: vec4f,
  refs: vec4u,     // BLAS root node, primitive offset, primitive kind, material base
  info: vec4u,     // flags, primitive count, layer index, stable object id
};

struct PtMeshVertex {
  position: vec4f, // xyz object space, w texture u
  normal: vec4f,   // xyz object space, w texture v
};

struct PtTriangle {
  indices: vec4u,  // three vertex record indices, material index
};

struct PtShape {
  p0: vec4f,
  p1: vec4f,
  p2: vec4f,
  p3: vec4f,
};

struct PtLight {
  positionKind: vec4f,
  radiance: vec4f,
  axisU: vec4f,
  axisV: vec4f,
};

struct PtMaterial {
  header: vec4f,   // kind, flags, atlas layer (-1 none), opacity
  c0: vec4f,
  c1: vec4f,
  c2: vec4f,
  c3: vec4f,
};

struct PtFrame {
  viewProjection: mat4x4f,
  inverseViewProjection: mat4x4f,
  previousViewProjection: mat4x4f,
  cameraPosition: vec4f,   // xyz, w: 0 perspective, 1 orthographic
  cameraRight: vec4f,      // xyz, w: tan(fovY / 2) * aspect or orthographic half width
  cameraUp: vec4f,         // xyz, w: tan(fovY / 2) or orthographic half height
  cameraForward: vec4f,    // xyz, w: near plane
  lens: vec4f,             // lens radius, focus distance, exposure scale, tone mapping code
  size: vec4f,             // render width, height, output width, height
  jitterTime: vec4f,       // jitter (render pixels), shutter open, shutter close (seconds)
  counters: vec4u,         // frame index, first sample index, samples this dispatch, mode
  limits: vec4u,           // max bounces, light count, node page 1 start, fiber page 1 start
  scene: vec4u,            // TLAS root, instance count, debug view, flags
  environment: vec4f,      // environment light index (-1 none), map width, map height, indirect clamp
  region: vec4f,           // render region x0, y0, x1, y1 (normalized output coordinates)
  previousCamera: vec4f,   // previous camera position, w: 1 when valid
};

struct PtGBufferTexel {
  depth: f32,
  normal: u32,
  tangent: u32,
  albedo: u32,
  materialKey: u32,
  motion: u32,
  surface: u32,
  flags: u32,
};

struct PtHitRecord {
  t: f32,
  instance: u32,
  primitive: u32,
  kind: u32,
  uv: vec2f,
  pad: vec2f,
};

struct PtReservoir {
  sample: vec4f,   // point on the light (or direction for environment and distant lights), W
  state: vec4f,    // weight sum, M, light index, target pdf
};

struct PtCacheEntry {
  checksum: u32,
  frame: u32,
  red: u32,
  green: u32,
  blue: u32,
  count: u32,
  resolvedRG: u32,
  resolvedBA: u32,
};

// ---- Function-level types of the fixed interfaces ----

struct PtRay {
  origin: vec3f,
  tMin: f32,
  direction: vec3f,
  tMax: f32,
};

struct PtHit {
  t: f32,          // PT_INFINITY when nothing was hit
  instance: u32,
  primitive: u32,  // local primitive index inside the instance's BLAS
  kind: u32,
  uv: vec2f,       // triangle barycentrics, quad uv, fiber (v along, h across), box/sphere unused
  steps: u32,      // traversal steps, for the BVH heatmap
};

/** Everything a BSDF needs at a hit, in scene space. */
struct PtSurface {
  position: vec3f,
  materialIndex: u32,
  normal: vec3f,       // shading normal (fibers: the normal of the hit on the cylinder)
  kind: u32,           // PT_MATERIAL_FIBER or PT_MATERIAL_SURFACE
  geometricNormal: vec3f,
  h: f32,              // fiber: offset across the fiber in [-1, 1]
  tangent: vec3f,      // fiber direction (unit), zero for surfaces
  roughness: f32,      // surfaces: GGX roughness; fibers: scale of beta_m and beta_n
  baseColor: vec3f,    // surfaces: albedo; fibers: color the absorption derives from
  metallic: f32,
  emission: vec3f,
  opacity: f32,
  melanin: f32,        // fiber melanin (absolute)
  flags: u32,          // fiber segment flags (flyaway)
  coverage: f32,       // fraction of the pixel the primary hit covers (fibers below a pixel)
  objectId: u32,
};

struct PtBsdfSample {
  wi: vec3f,
  pdf: f32,            // 0: no sample
  value: vec3f,        // f(wo, wi), not divided by the pdf
  delta: u32,          // 1 when the lobe is specular (no MIS against lights)
};

struct PtLightSample {
  wi: vec3f,           // unit direction toward the light
  distance: f32,       // to the sampled point (PT_INFINITY for environment and distant lights)
  radiance: vec3f,     // emitted radiance toward p
  pdf: f32,            // solid angle pdf including light selection; 0: no sample
  lightIndex: u32,
  isDelta: u32,
};

// ---- Helpers ----

fn ptLuminance(color: vec3f) -> f32 {
  return dot(color, vec3f(0.2126, 0.7152, 0.0722));
}

fn ptSafeNormalize(v: vec3f, fallback: vec3f) -> vec3f {
  let l = dot(v, v);
  return select(fallback, v * inverseSqrt(l), l > 1e-20);
}

/** Orthonormal basis around a unit normal (Duff et al. 2017). */
fn ptBasis(n: vec3f) -> mat3x3f {
  let s = select(-1.0, 1.0, n.z >= 0.0);
  let a = -1.0 / (s + n.z);
  let b = n.x * n.y * a;
  let t = vec3f(1.0 + s * n.x * n.x * a, s * b, -s * n.x);
  let bt = vec3f(b, s + n.y * n.y * a, -n.y);
  return mat3x3f(t, bt, n);
}

fn ptOctWrap(v: vec2f) -> vec2f {
  return (1.0 - abs(v.yx)) * select(vec2f(-1.0), vec2f(1.0), v >= vec2f(0.0));
}

/** Unit vector to a 16:16 octahedral code (0 is reserved for "none"). */
fn ptOctEncode(n: vec3f) -> u32 {
  let p = n.xy / (abs(n.x) + abs(n.y) + abs(n.z));
  let q = select(ptOctWrap(p), p, n.z >= 0.0);
  return max(pack2x16unorm(q * 0.5 + 0.5), 1u);
}

fn ptOctDecode(code: u32) -> vec3f {
  let f = unpack2x16unorm(code) * 2.0 - 1.0;
  var n = vec3f(f, 1.0 - abs(f.x) - abs(f.y));
  let t = clamp(-n.z, 0.0, 1.0);
  n = vec3f(n.xy + select(vec2f(t), vec2f(-t), n.xy >= vec2f(0.0)), n.z);
  return normalize(n);
}

/** 32-bit integer hash (Jarzynski & Olano 2020, pcg). */
fn ptPcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn ptHash3(x: u32, y: u32, z: u32) -> u32 {
  return ptPcg(x ^ ptPcg(y ^ ptPcg(z)));
}

fn ptToUnit(v: u32) -> f32 {
  return f32(v >> 8u) * (1.0 / 16777216.0);
}

fn ptTransformPoint(r0: vec4f, r1: vec4f, r2: vec4f, p: vec3f) -> vec3f {
  let h = vec4f(p, 1.0);
  return vec3f(dot(r0, h), dot(r1, h), dot(r2, h));
}

fn ptTransformVector(r0: vec4f, r1: vec4f, r2: vec4f, v: vec3f) -> vec3f {
  return vec3f(dot(r0.xyz, v), dot(r1.xyz, v), dot(r2.xyz, v));
}

/** Normal from object to scene space: the transpose of the world-to-object rows. */
fn ptTransformNormal(w2o0: vec4f, w2o1: vec4f, w2o2: vec4f, n: vec3f) -> vec3f {
  return normalize(w2o0.xyz * n.x + w2o1.xyz * n.y + w2o2.xyz * n.z);
}
