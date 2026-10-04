// Reference path tracer (megakernel): one thread per pixel of the current region, `samplesThisFrame`
// samples per dispatch, summed into the accumulation buffers. Used for export, still convergence
// and (Phase 2) the preview. Next event estimation and BSDF sampling are combined with the power
// heuristic; lights are virtual, so BSDF rays test them separately (ptLightHit). Camera rays that
// miss leave the pixel transparent (alpha 0), like the raster; the environment lights bounces.
// Requires PtCommon, PtSceneBindings, PtSampler, PtFiberBsdf, PtBsdf, PtSurfaceTexture, PtTraverse,
// PtLights, PtShading and PtPathCommon.

// Per pixel: (radiance rgb, coverage) sums.
@group(3) @binding(0) var<storage, read_write> accumulation: array<vec4f>;
// Per pixel, two vec4: (albedo rgb, linear depth) and (normal xyz, BVH steps) sums of the primary hit.
@group(3) @binding(1) var<storage, read_write> auxiliary: array<vec4f>;
// Per pixel: NDC depth of the nearest primary hit (1 = none, for compositing splats), luminance sum and
// sum of squares (adaptive sampling), and the pixel's own sample count (adaptive pixels stop early).
@group(3) @binding(2) var<storage, read_write> pixelState: array<vec4f>;
// The rows of the region this dispatch covers: x first row, y rows (short dispatches, see ptDispatchBudget.ts).
@group(3) @binding(3) var<uniform> band: vec4u;

struct PtSampleResult {
  radiance: vec3f,
  coverage: f32,
  albedo: vec3f,
  depth: f32,
  normal: vec3f,
  steps: f32,
  ndcDepth: f32,
};

fn ptTracePath(pixel: vec2u, sampleIndex: u32) -> PtSampleResult {
  var result: PtSampleResult;
  result.ndcDepth = 1.0;
  // The scramble seed depends on the pixel and frame.scene.w only (0 in export), so every exported frame
  // uses the same per-pixel sequence: deterministic and without frame-to-frame flicker of the pattern.
  var smp = ptSamplerStart(pixel, frame.scene.w, sampleIndex);
  let camera = ptNext4(&smp);
  var ray = ptCameraRay(pixel, camera.xy, camera.zw);
  var throughput = vec3f(1.0);
  var radiance = vec3f(0.0);
  var bsdfPdf = 0.0;
  var specularBounce = true;
  let maxBounces = max(frame.limits.x, 1u);
  for (var bounce = 0u; bounce <= maxBounces; bounce++) {
    let u = ptNext4(&smp);
    let hit = ptTraceClosestAlpha(ray, max(u.w, 1e-3));
    if (bounce == 0u) {
      result.steps = f32(hit.steps);
    }
    // Area lights met by this ray before the next surface (never by camera rays: lights are invisible like in the raster).
    if (bounce > 0u) {
      let lightHit = ptLightHit(ray.origin, ray.direction, hit.t);
      if (lightHit.pdf > 0.0) {
        let weight = select(ptPowerHeuristic(bsdfPdf, lightHit.pdf), 1.0, specularBounce);
        radiance += ptClampIndirect(throughput * lightHit.radiance * weight);
        if (lightHit.t < hit.t) {
          break;
        }
      }
    }
    if (hit.t >= PT_INFINITY) {
      if (bounce > 0u) {
        let env = ptEnvironmentHit(ray.direction);
        if (env.pdf > 0.0) {
          let weight = select(ptPowerHeuristic(bsdfPdf, env.pdf), 1.0, specularBounce);
          radiance += ptClampIndirect(throughput * env.radiance * weight);
        }
      }
      break;
    }
    var surface = ptSurfaceAt(hit, ray);
    let wo = -ray.direction;
    if (bounce == 0u) {
      result.coverage = 1.0;
      result.albedo = select(surface.baseColor + surface.emission, surface.baseColor, surface.kind == PT_MATERIAL_FIBER);
      result.normal = surface.normal;
      result.depth = dot(surface.position - frame.cameraPosition.xyz, frame.cameraForward.xyz);
      let clip = frame.viewProjection * vec4f(surface.position, 1.0);
      result.ndcDepth = clamp(clip.z / max(clip.w, 1e-6), 0.0, 1.0);
    }
    let emitted = throughput * surface.emission;
    radiance += select(ptClampIndirect(emitted), emitted, bounce == 0u);
    if (bounce == maxBounces) {
      break;
    }
    // Next event estimation.
    let light = pt_sample_light(surface.position, surface.normal, vec3f(u.x, u.y, u.z));
    if (light.pdf > 0.0) {
      let f = pt_bsdf_eval(surface, wo, light.wi);
      if (any(f > vec3f(0.0))) {
        let shadow = PtRay(ptOffsetOrigin(surface, light.wi), 0.0, light.wi, PT_INFINITY);
        let visibility = pt_trace_transmittance(shadow, select(light.distance * 0.999, PT_INFINITY, light.distance >= PT_INFINITY));
        if (visibility > 0.0) {
          let weight = select(ptPowerHeuristic(light.pdf, pt_bsdf_pdf(surface, wo, light.wi)), 1.0, light.isDelta == 1u);
          let contribution = throughput * f * light.radiance * (visibility * weight / light.pdf);
          radiance += select(ptClampIndirect(contribution), contribution, bounce == 0u);
        }
      }
    }
    // Continue the path.
    let v = ptNext4(&smp);
    let sample = pt_bsdf_sample(surface, wo, v.xyz);
    if (sample.pdf <= PT_MIN_PDF || all(sample.value <= vec3f(0.0))) {
      break;
    }
    throughput *= sample.value / sample.pdf;
    bsdfPdf = sample.pdf;
    specularBounce = sample.delta == 1u;
    if (bounce >= 3u) {
      let survive = min(max(throughput.x, max(throughput.y, throughput.z)), 0.95);
      if (v.w >= survive) {
        break;
      }
      throughput /= survive;
    }
    ray = PtRay(ptOffsetOrigin(surface, sample.wi), 0.0, sample.wi, PT_INFINITY);
  }
  result.radiance = ptSanitize(radiance);
  return result;
}

@compute @workgroup_size(8, 8)
fn integrate(@builtin(global_invocation_id) id: vec3u) {
  let size = ptRenderSize();
  let region = vec4u(frame.region * vec4f(frame.size.xy, frame.size.xy));
  let pixel = id.xy + region.xy + vec2u(0u, band.x);
  if (id.y >= band.y || pixel.x >= min(region.z, size.x) || pixel.y >= min(region.w, size.y)) {
    return;
  }
  let index = pixel.y * size.x + pixel.x;
  var color = vec4f(0.0);
  var albedoDepth = vec4f(0.0);
  var normalSteps = vec4f(0.0);
  var state = select(pixelState[index], vec4f(1.0, 0.0, 0.0, 0.0), frame.counters.y == 0u);
  // Adaptive sampling: a pixel whose mean luminance is known well enough keeps its sums and stops.
  if (frame.sampling.x > 0.0 && state.w >= frame.sampling.y) {
    let mean = state.y / state.w;
    let variance = max(state.z / state.w - mean * mean, 0.0);
    if (sqrt(variance / state.w) < frame.sampling.x * max(mean, 1e-3)) {
      return;
    }
  }
  for (var s = 0u; s < frame.counters.z; s++) {
    let result = ptTracePath(pixel, frame.counters.y + s);
    color += vec4f(result.radiance, result.coverage);
    albedoDepth += vec4f(result.albedo, result.depth);
    normalSteps += vec4f(result.normal, result.steps);
    let luminance = ptLuminance(result.radiance);
    state = vec4f(min(state.x, result.ndcDepth), state.y + luminance, state.z + luminance * luminance, state.w + 1.0);
  }
  if (frame.counters.y == 0u) {
    accumulation[index] = color;
    auxiliary[index * 2u] = albedoDepth;
    auxiliary[index * 2u + 1u] = normalSteps;
  } else {
    accumulation[index] += color;
    auxiliary[index * 2u] += albedoDepth;
    auxiliary[index * 2u + 1u] += normalSteps;
  }
  pixelState[index] = state;
}
