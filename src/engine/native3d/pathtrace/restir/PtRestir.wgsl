// ReSTIR DI reservoirs (plan 3.2). A light sample y is a point on an area light (sphere, rect;
// reused in area measure, so a neighbor's sample needs no Jacobian) or a direction (environment,
// distant light). The target function is the luminance of the unshadowed contribution f · Le · G;
// visibility is tested once for the final sample. Requires PtCommon, PtSceneBindings, the BSDF
// modules and PtLights.wgsl.

const PT_RESTIR_NO_LIGHT: u32 = 0xffffffffu;

struct PtReservoirState {
  y: vec3f,
  W: f32,           // unbiased contribution weight wSum / (M · target(y))
  wSum: f32,
  M: f32,
  light: u32,       // PT_RESTIR_NO_LIGHT when empty
  targetPdf: f32,   // target function of y at the reservoir's own surface
};

struct PtRestirEval {
  wi: vec3f,
  distance: f32,     // PT_INFINITY for directions
  contribution: vec3f,
  geometry: f32,     // cos at the light / distance² (1 for directions)
};

fn ptRestirEmpty() -> PtReservoirState {
  return PtReservoirState(vec3f(0.0), 0.0, 0.0, 0.0, PT_RESTIR_NO_LIGHT, 0.0);
}

/** Unshadowed contribution f · Le · G of light sample y at surface s seen from wo. */
fn ptRestirEval(light: u32, y: vec3f, s: PtSurface, wo: vec3f) -> PtRestirEval {
  var e: PtRestirEval;
  e.contribution = vec3f(0.0);
  e.geometry = 0.0;
  e.distance = PT_INFINITY;
  e.wi = vec3f(0.0, 1.0, 0.0);
  if (light >= ptLightCount()) {
    return e;
  }
  let source = lights[light];
  let kind = u32(source.positionKind.w + 0.5);
  var radiance = source.radiance.rgb;
  if (kind == PT_LIGHT_SPHERE || kind == PT_LIGHT_RECT) {
    let toLight = y - s.position;
    let d2 = max(dot(toLight, toLight), 1e-12);
    e.distance = sqrt(d2);
    e.wi = toLight / e.distance;
    let normal = select(-normalize(cross(source.axisU.xyz, source.axisV.xyz)), normalize(y - source.positionKind.xyz),
      kind == PT_LIGHT_SPHERE);
    let cosLight = dot(-e.wi, normal);
    if (cosLight <= 0.0) {
      return e;
    }
    e.geometry = cosLight / d2;
  } else if (kind == PT_LIGHT_ENVIRONMENT) {
    e.wi = normalize(y);
    e.geometry = 1.0;
    radiance = ptEnvRadiance(light, e.wi);
  } else {
    e.wi = normalize(source.positionKind.xyz);
    e.geometry = 1.0;
  }
  e.contribution = pt_bsdf_eval(s, wo, e.wi) * radiance * e.geometry;
  return e;
}

/** Streams one weighted sample into the reservoir; u in [0, 1) decides the selection. */
fn ptReservoirUpdate(r: ptr<function, PtReservoirState>, light: u32, y: vec3f, weight: f32, targetPdf: f32, m: f32, u: f32) {
  (*r).M += m;
  if (!(weight > 0.0)) {
    return;
  }
  (*r).wSum += weight;
  if (u * (*r).wSum < weight) {
    (*r).y = y;
    (*r).light = light;
    (*r).targetPdf = targetPdf;
  }
}

fn ptReservoirFinalize(r: ptr<function, PtReservoirState>) {
  let w = (*r).wSum / max((*r).M * (*r).targetPdf, 1e-30);
  // A sample whose target is almost zero here would get an enormous weight: drop it.
  (*r).W = select(0.0, w, (*r).targetPdf > 1e-12 && (*r).M > 0.0 && w < 1e12 && w == w);
}

/** Merges reservoir q (from another pixel or the last frame) into r at surface s. */
fn ptReservoirMerge(r: ptr<function, PtReservoirState>, q: PtReservoirState, s: PtSurface, wo: vec3f, u: f32) {
  if (q.light == PT_RESTIR_NO_LIGHT || q.M <= 0.0) {
    return;
  }
  let targetPdf = ptLuminance(ptRestirEval(q.light, q.y, s, wo).contribution);
  ptReservoirUpdate(r, q.light, q.y, targetPdf * q.W * q.M, targetPdf, q.M, u);
}

/** Initial candidates from pt_sample_light (resampled importance sampling). */
fn ptRestirCandidates(s: PtSurface, wo: vec3f, count: u32, seed: u32) -> PtReservoirState {
  var r = ptRestirEmpty();
  var rng = seed;
  for (var c = 0u; c < count; c++) {
    rng = ptPcg(rng);
    let ua = ptToUnit(rng);
    rng = ptPcg(rng);
    let ub = ptToUnit(rng);
    rng = ptPcg(rng);
    let uc = ptToUnit(rng);
    rng = ptPcg(rng);
    let pick = ptToUnit(rng);
    let sample = pt_sample_light(s.position, s.normal, vec3f(ua, ub, uc));
    if (sample.pdf <= 0.0) {
      r.M += 1.0;
      continue;
    }
    let isPoint = sample.distance < PT_INFINITY;
    let y = select(sample.wi, s.position + sample.wi * sample.distance, isPoint);
    let e = ptRestirEval(sample.lightIndex, y, s, wo);
    let targetPdf = ptLuminance(e.contribution);
    // Source pdf in the reservoir's measure: area for points on lights, solid angle for directions.
    let source = sample.pdf * select(1.0, e.geometry, isPoint);
    ptReservoirUpdate(&r, sample.lightIndex, y, select(0.0, targetPdf / source, source > 0.0), targetPdf, 1.0, pick);
  }
  ptReservoirFinalize(&r);
  return r;
}

fn ptReservoirPack0(r: PtReservoirState) -> vec4f {
  return vec4f(r.y, r.W);
}

fn ptReservoirPack1(r: PtReservoirState) -> vec4f {
  return vec4f(r.wSum, r.M, bitcast<f32>(r.light), r.targetPdf);
}

fn ptReservoirUnpack(a: vec4f, b: vec4f) -> PtReservoirState {
  return PtReservoirState(a.xyz, a.w, b.x, b.y, bitcast<u32>(b.z), b.w);
}
