// Realtime path tracer (plan 4.6): one sample per pixel and frame at render scale, jittered for the
// temporal upscaler. It writes the primary hit as a G-buffer, the initial ReSTIR DI reservoir of the
// primary hit (shaded with reuse by PtRestirShade.wgsl) and the indirect light. Indirect paths end in
// the radiance cache from their second bounce on; one 8x8 tile in PT_RT_TRAIN_STRIDE runs its paths to
// full depth and trains the cache with the radiance found behind each of their vertices.
// Requires PtCommon, PtSceneBindings, PtSampler, PtFiberBsdf, PtBsdf, PtSurfaceTexture, PtTraverse,
// PtLights, PtShading, PtPathCommon, PtSharc and PtRestir.
//
// Per render pixel, `surfaces` holds 4 vec4 (PT_RT_SURFACE_VEC4):
//   0: hit t (PT_INFINITY: none), instance, primitive, kind (u32 bits)
//   1: hit uv, material key, G-buffer flags (u32 bits)
//   2: demodulation albedo (unorm4x8 bits), view depth, NDC depth, normal (octahedral bits)
//   3: fiber tangent (octahedral bits, 0 for surfaces), position in the previous frame (render pixels), coverage
// and `lighting` 3 vec4: the reservoir (2) and (emitted + indirect radiance, coverage).

@group(3) @binding(0) var<storage, read_write> surfaces: array<vec4f>;
@group(3) @binding(1) var<storage, read_write> lighting: array<vec4f>;
@group(3) @binding(3) var<uniform> band: vec4u;

const PT_RT_CANDIDATES: u32 = 2u;
const PT_RT_TRAIN_STRIDE: u32 = 8u;
const PT_RT_TRAIN_VERTICES: u32 = 6u;
// Paths that do not train end here even when the cache has nothing yet (cells fill within frames).
const PT_RT_MAX_BOUNCES: u32 = 3u;

/** Cache cell edge at p: grows with the camera distance, about 16 pixels on screen. */
fn ptCacheSpread(p: vec3f) -> f32 {
  let pixelAngle = 2.0 * frame.cameraUp.w / frame.size.y;
  return max(length(p - frame.cameraPosition.xyz), frame.cameraForward.w) * pixelAngle * 16.0;
}

/** Albedo the denoiser divides lighting by (and multiplies back): texture detail stays sharp. */
fn ptDemodulationAlbedo(s: PtSurface) -> vec3f {
  return select(max(s.baseColor, vec3f(0.03)), vec3f(1.0), all(s.baseColor <= vec3f(0.0)));
}

/** Render pixel position of scene point p in the previous frame (the camera's motion). */
fn ptPreviousPixel(p: vec3f) -> vec2f {
  let clip = frame.previousViewProjection * vec4f(p, 1.0);
  let ndc = clip.xy / max(clip.w, 1e-6);
  return vec2f((ndc.x * 0.5 + 0.5) * frame.size.x, (0.5 - ndc.y * 0.5) * frame.size.y) - 0.5;
}

/** Indirect light toward the primary hit through BSDF-sampled paths; trains the cache on some paths. */
fn ptRealtimeIndirect(primary: PtSurface, wo: vec3f, smp: ptr<function, PtSampler>, training: bool) -> vec3f {
  var indirect = vec3f(0.0);
  let first = pt_bsdf_sample(primary, wo, ptNext4(smp).xyz);
  if (first.pdf <= PT_MIN_PDF || all(first.value <= vec3f(0.0))) {
    return indirect;
  }
  var throughput = first.value / first.pdf;
  var ray = PtRay(ptOffsetOrigin(primary, first.wi), 0.0, first.wi, PT_INFINITY);
  var bsdfPdf = first.pdf;
  var specularBounce = first.delta == 1u;
  var positions: array<vec3f, PT_RT_TRAIN_VERTICES>;
  var normals: array<vec3f, PT_RT_TRAIN_VERTICES>;
  var throughputs: array<vec3f, PT_RT_TRAIN_VERTICES>;
  var before: array<vec3f, PT_RT_TRAIN_VERTICES>;
  var vertices = 0u;
  let maxBounces = select(min(max(frame.limits.x, 1u), PT_RT_MAX_BOUNCES), max(frame.limits.x, 1u), training);
  for (var bounce = 1u; bounce <= maxBounces; bounce++) {
    let u = ptNext4(smp);
    let hit = ptTraceClosestAlpha(ray, max(u.w, 1e-3));
    let lightHit = ptLightHit(ray.origin, ray.direction, hit.t);
    if (lightHit.pdf > 0.0) {
      let weight = select(ptPowerHeuristic(bsdfPdf, lightHit.pdf), 1.0, specularBounce);
      indirect += ptClampIndirect(throughput * lightHit.radiance * weight);
      if (lightHit.t < hit.t) {
        break;
      }
    }
    if (hit.t >= PT_INFINITY) {
      let env = ptEnvironmentHit(ray.direction);
      if (env.pdf > 0.0) {
        let weight = select(ptPowerHeuristic(bsdfPdf, env.pdf), 1.0, specularBounce);
        indirect += ptClampIndirect(throughput * env.radiance * weight);
      }
      break;
    }
    let surface = ptSurfaceAt(hit, ray);
    let wo2 = -ray.direction;
    if (!training && bounce >= 2u) {
      let cached = pt_cache_query(surface.position, surface.normal, ptCacheSpread(surface.position));
      if (cached.w > 0.0) {
        indirect += ptClampIndirect(throughput * cached.rgb);
        break;
      }
    }
    if (training && vertices < PT_RT_TRAIN_VERTICES) {
      positions[vertices] = surface.position;
      normals[vertices] = surface.normal;
      throughputs[vertices] = throughput;
      before[vertices] = indirect;
      vertices++;
    }
    indirect += ptClampIndirect(throughput * surface.emission);
    if (bounce == maxBounces) {
      break;
    }
    let light = pt_sample_light(surface.position, surface.normal, u.xyz);
    if (light.pdf > 0.0) {
      let f = pt_bsdf_eval(surface, wo2, light.wi);
      if (any(f > vec3f(0.0))) {
        let shadow = PtRay(ptOffsetOrigin(surface, light.wi), 0.0, light.wi, PT_INFINITY);
        let visibility = pt_trace_transmittance(shadow, select(light.distance * 0.999, PT_INFINITY, light.distance >= PT_INFINITY));
        if (visibility > 0.0) {
          let weight = select(ptPowerHeuristic(light.pdf, pt_bsdf_pdf(surface, wo2, light.wi)), 1.0, light.isDelta == 1u);
          indirect += ptClampIndirect(throughput * f * light.radiance * (visibility * weight / light.pdf));
        }
      }
    }
    let v = ptNext4(smp);
    let next = pt_bsdf_sample(surface, wo2, v.xyz);
    if (next.pdf <= PT_MIN_PDF || all(next.value <= vec3f(0.0))) {
      break;
    }
    throughput *= next.value / next.pdf;
    bsdfPdf = next.pdf;
    specularBounce = next.delta == 1u;
    if (bounce >= 3u) {
      let survive = min(max(throughput.x, max(throughput.y, throughput.z)), 0.95);
      if (v.w >= survive) {
        break;
      }
      throughput /= survive;
    }
    ray = PtRay(ptOffsetOrigin(surface, next.wi), 0.0, next.wi, PT_INFINITY);
  }
  // Radiance leaving each training vertex: everything found after it, divided by the throughput that reached it.
  for (var i = 0u; i < vertices; i++) {
    if (all(throughputs[i] > vec3f(1e-4))) {
      pt_cache_update(positions[i], normals[i], ptCacheSpread(positions[i]), (indirect - before[i]) / throughputs[i]);
    }
  }
  return ptSanitize(indirect);
}

@compute @workgroup_size(8, 8)
fn integrateRealtime(@builtin(global_invocation_id) id: vec3u) {
  let size = ptRenderSize();
  let pixel = vec2u(id.x, id.y + band.x);
  if (id.y >= band.y || pixel.x >= size.x || pixel.y >= size.y) {
    return;
  }
  let index = pixel.y * size.x + pixel.x;
  let s = index * 4u;
  let l = index * 3u;
  var smp = ptSamplerStart(pixel, frame.scene.w, frame.counters.y);
  let camera = ptNext4(&smp);
  let ray = ptCameraRay(pixel, vec2f(0.5) + frame.jitterTime.xy, camera.zw);
  let u = ptNext4(&smp);
  let hit = ptTraceClosestAlpha(ray, max(u.w, 1e-3));
  if (hit.t >= PT_INFINITY) {
    surfaces[s] = vec4f(PT_INFINITY, 0.0, 0.0, 0.0);
    surfaces[s + 1u] = vec4f(0.0);
    surfaces[s + 2u] = vec4f(0.0, PT_INFINITY, 1.0, 0.0);
    surfaces[s + 3u] = vec4f(0.0, ptPreviousPixel(ray.origin + ray.direction * 1e6), 0.0);
    lighting[l] = vec4f(0.0);
    lighting[l + 1u] = ptReservoirPack1(ptRestirEmpty());
    lighting[l + 2u] = vec4f(0.0);
    return;
  }
  let surface = ptSurfaceAt(hit, ray);
  let wo = -ray.direction;
  let clip = frame.viewProjection * vec4f(surface.position, 1.0);
  var flags = PT_GBUFFER_HIT;
  flags |= select(0u, PT_GBUFFER_FIBER, surface.kind == PT_MATERIAL_FIBER);
  flags |= select(0u, PT_GBUFFER_EMISSIVE, any(surface.emission > vec3f(0.0)));
  surfaces[s] = vec4f(hit.t, bitcast<f32>(hit.instance), bitcast<f32>(hit.primitive), bitcast<f32>(hit.kind));
  surfaces[s + 1u] = vec4f(hit.uv, bitcast<f32>(surface.materialIndex + 1u), bitcast<f32>(flags));
  surfaces[s + 2u] = vec4f(bitcast<f32>(pack4x8unorm(vec4f(ptDemodulationAlbedo(surface), 0.0))),
    dot(surface.position - frame.cameraPosition.xyz, frame.cameraForward.xyz), clamp(clip.z / max(clip.w, 1e-6), 0.0, 1.0),
    bitcast<f32>(ptOctEncode(surface.normal)));
  let tangent = select(0u, ptOctEncode(surface.tangent), surface.kind == PT_MATERIAL_FIBER);
  surfaces[s + 3u] = vec4f(bitcast<f32>(tangent), ptPreviousPixel(surface.position), 1.0);
  let reservoir = ptRestirCandidates(surface, wo, PT_RT_CANDIDATES, ptHash3(pixel.x, pixel.y, frame.counters.y ^ 0x5bd1e995u));
  lighting[l] = ptReservoirPack0(reservoir);
  lighting[l + 1u] = ptReservoirPack1(reservoir);
  // Whole 8x8 tiles train together: a long training path in a warp would hold up all short cached ones.
  let tile = (pixel / 8u).y * 4099u + (pixel / 8u).x;
  let training = ptPcg(tile * 9781u + frame.counters.x * 6271u) % PT_RT_TRAIN_STRIDE == 0u;
  lighting[l + 2u] = vec4f(ptSanitize(surface.emission + ptRealtimeIndirect(surface, wo, &smp, training)), 1.0);
}
