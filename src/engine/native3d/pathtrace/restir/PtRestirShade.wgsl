// ReSTIR DI reuse and shading of the realtime primary hits (plan 3.2): the pixel's initial
// reservoir is merged with its reservoir of the last frame (found through the motion of the hit,
// accepted when material, depth and normal match) and with a few neighbors' initial reservoirs,
// then the chosen light sample is shaded with one visibility ray (pt_trace_transmittance). The
// direct light is added to the pixel's radiance; the merged reservoir becomes the next frame's history.
// Requires PtCommon, PtSceneBindings, PtSampler, PtFiberBsdf, PtBsdf, PtSurfaceTexture, PtTraverse,
// PtLights, PtShading, PtPathCommon and PtRestir. Buffer layouts: PtRealtimeIntegrator.wgsl.
//
// History, two halves (read: last frame, write: this frame), 2 vec4 per render pixel:
//   0: reservoir sample y, W (0 when the sample was occluded)
//   1: M, light (low 16 bits, 0xffff none) | material key << 16, view depth, normal (octahedral bits)

@group(3) @binding(0) var<storage, read> surfaces: array<vec4f>;
@group(3) @binding(1) var<storage, read_write> lighting: array<vec4f>;
@group(3) @binding(2) var<storage, read_write> history: array<vec4f>;
// x: first row, y: rows, z: first vec4 of the history read half (0xffffffff: no history), w: of the write half.
@group(3) @binding(3) var<uniform> band: vec4u;

const PT_RESTIR_SPATIAL: u32 = 2u;
const PT_RESTIR_RADIUS: f32 = 12.0;
const PT_RESTIR_HISTORY_CAP: f32 = 20.0;
const PT_RESTIR_NONE_BITS: u32 = 0xffffu;

struct PtRtPrimary {
  surface: PtSurface,
  wo: vec3f,
  valid: bool,
};

/** Rebuilds the primary surface of a render pixel from its stored hit and the frame's camera ray. */
fn ptRtPrimary(pixel: vec2u, index: u32) -> PtRtPrimary {
  var primary: PtRtPrimary;
  primary.valid = false;
  let s0 = surfaces[index * 4u];
  if (s0.x >= PT_INFINITY) {
    return primary;
  }
  let s1 = surfaces[index * 4u + 1u];
  var smp = ptSamplerStart(pixel, frame.scene.w, frame.counters.y);
  let camera = ptNext4(&smp);
  let ray = ptCameraRay(pixel, vec2f(0.5) + frame.jitterTime.xy, camera.zw);
  let hit = PtHit(s0.x, bitcast<u32>(s0.y), bitcast<u32>(s0.z), bitcast<u32>(s0.w), s1.xy, 0u);
  primary.surface = ptSurfaceAt(hit, ray);
  primary.wo = -ray.direction;
  primary.valid = true;
  return primary;
}

/** Whether a stored surface (material key, view depth, normal code) can share this pixel's light samples. */
fn ptRtSimilar(key: u32, depth: f32, normal: vec3f, fiber: bool, otherKey: u32, otherDepth: f32, otherNormal: u32) -> bool {
  if (otherKey != key || abs(otherDepth - depth) > 0.1 * depth) {
    return false;
  }
  // Fiber normals turn around the fiber within a pixel; material and depth decide there.
  return fiber || dot(ptOctDecode(otherNormal), normal) > 0.8;
}

@compute @workgroup_size(8, 8)
fn restirShade(@builtin(global_invocation_id) id: vec3u) {
  let size = ptRenderSize();
  let pixel = vec2u(id.x, id.y + band.x);
  if (id.y >= band.y || pixel.x >= size.x || pixel.y >= size.y) {
    return;
  }
  let index = pixel.y * size.x + pixel.x;
  let written = band.w + index * 2u;
  let primary = ptRtPrimary(pixel, index);
  if (!primary.valid) {
    history[written] = vec4f(0.0);
    history[written + 1u] = vec4f(0.0, bitcast<f32>(PT_RESTIR_NONE_BITS), PT_INFINITY, 0.0);
    return;
  }
  let surface = primary.surface;
  let wo = primary.wo;
  let s1 = surfaces[index * 4u + 1u];
  let s2 = surfaces[index * 4u + 2u];
  let s3 = surfaces[index * 4u + 3u];
  let key = bitcast<u32>(s1.z);
  let fiber = (bitcast<u32>(s1.w) & PT_GBUFFER_FIBER) != 0u;
  let depth = s2.y;
  let normal = ptOctDecode(bitcast<u32>(s2.w));
  var rng = ptHash3(pixel.x ^ 0x68bc21ebu, pixel.y, frame.counters.y);
  var r = ptRestirEmpty();
  let initial = ptReservoirUnpack(lighting[index * 3u], lighting[index * 3u + 1u]);
  rng = ptPcg(rng);
  ptReservoirMerge(&r, initial, surface, wo, ptToUnit(rng));
  r.M = max(r.M, initial.M);

  // Temporal reuse.
  if (band.z != 0xffffffffu) {
    let previous = vec2i(floor(s3.yz + 0.5));
    if (all(previous >= vec2i(0)) && all(previous < vec2i(size))) {
      let at = band.z + (u32(previous.y) * size.x + u32(previous.x)) * 2u;
      let h1 = history[at + 1u];
      let bits = bitcast<u32>(h1.y);
      if ((bits & 0xffffu) != PT_RESTIR_NONE_BITS && ptRtSimilar(key, depth, normal, fiber, bits >> 16u, h1.z, bitcast<u32>(h1.w))) {
        let h0 = history[at];
        let q = PtReservoirState(h0.xyz, h0.w, 0.0, min(h1.x, PT_RESTIR_HISTORY_CAP * max(initial.M, 1.0)), bits & 0xffffu, 0.0);
        rng = ptPcg(rng);
        ptReservoirMerge(&r, q, surface, wo, ptToUnit(rng));
      }
    }
  }

  // Spatial reuse of the neighbors' initial reservoirs.
  for (var k = 0u; k < PT_RESTIR_SPATIAL; k++) {
    rng = ptPcg(rng);
    let angle = ptToUnit(rng) * PT_TWO_PI;
    rng = ptPcg(rng);
    let radius = sqrt(ptToUnit(rng)) * PT_RESTIR_RADIUS;
    let neighbor = vec2i(pixel) + vec2i(round(vec2f(cos(angle), sin(angle)) * radius));
    if (any(neighbor < vec2i(0)) || any(neighbor >= vec2i(size)) || all(neighbor == vec2i(pixel))) {
      continue;
    }
    let n = u32(neighbor.y) * size.x + u32(neighbor.x);
    let ns1 = surfaces[n * 4u + 1u];
    let ns2 = surfaces[n * 4u + 2u];
    if (!ptRtSimilar(key, depth, normal, fiber, bitcast<u32>(ns1.z), ns2.y, bitcast<u32>(ns2.w))) {
      continue;
    }
    rng = ptPcg(rng);
    ptReservoirMerge(&r, ptReservoirUnpack(lighting[n * 3u], lighting[n * 3u + 1u]), surface, wo, ptToUnit(rng));
  }
  ptReservoirFinalize(&r);

  var direct = vec3f(0.0);
  if (r.light != PT_RESTIR_NO_LIGHT && r.W > 0.0) {
    let e = ptRestirEval(r.light, r.y, surface, wo);
    if (any(e.contribution > vec3f(0.0))) {
      let shadow = PtRay(ptOffsetOrigin(surface, e.wi), 0.0, e.wi, PT_INFINITY);
      let visibility = pt_trace_transmittance(shadow, select(e.distance * 0.999, PT_INFINITY, e.distance >= PT_INFINITY));
      direct = e.contribution * (r.W * visibility);
      // An occluded sample must not spread to the next frame.
      r.W = select(r.W, 0.0, visibility <= 0.0);
    }
  }
  let radiance = lighting[index * 3u + 2u];
  lighting[index * 3u + 2u] = vec4f(ptSanitize(radiance.rgb + ptSanitize(direct)), radiance.a);
  let lightBits = select(r.light & 0xffffu, PT_RESTIR_NONE_BITS, r.light == PT_RESTIR_NO_LIGHT);
  history[written] = vec4f(r.y, r.W);
  history[written + 1u] = vec4f(r.M, bitcast<f32>(lightBits | (key << 16u)), depth, s2.w);
}
