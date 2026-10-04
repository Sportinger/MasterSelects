// The fixed BSDF interfaces pt_bsdf_eval / pt_bsdf_sample / pt_bsdf_pdf for fibers (PtFiberBsdf.wgsl)
// and surfaces (diffuse + GGX, an OpenPBR subset: base color, roughness, metallic). Every value is
// f(wo, wi) · |cos θi|; directions are unit vectors in scene space pointing away from the surface.
// Requires PtCommon.wgsl, PtSceneBindings.wgsl (materials) and PtFiberBsdf.wgsl.

// ---- Fibers ----

struct PtFiberFrame {
  x: vec3f,
  y: vec3f,
  z: vec3f,
};

/** x along the fiber, z toward wo (perpendicular to the fiber), y = z × x; h is measured along y. */
fn ptFiberFrame(tangent: vec3f, wo: vec3f) -> PtFiberFrame {
  let x = ptSafeNormalize(tangent, vec3f(1.0, 0.0, 0.0));
  var z = wo - x * dot(wo, x);
  if (dot(z, z) < 1e-12) {
    z = ptBasis(x)[0];
  }
  z = normalize(z);
  return PtFiberFrame(x, cross(z, x), z);
}

fn ptFiberLocal(f: PtFiberFrame, v: vec3f) -> vec3f {
  return vec3f(dot(v, f.x), dot(v, f.y), dot(v, f.z));
}

/** Hair parameters of a fiber hit from its material and per-point attributes. */
fn ptFiberHairParams(s: PtSurface) -> PtHairParams {
  let m = materials[s.materialIndex];
  var p: PtHairParams;
  p.h = clamp(s.h, -0.999, 0.999);
  p.eta = max(m.c1.z, 1.01);
  let fuzz = select(0.0, m.c3.z, (s.flags & PT_FIBER_FLAG_FLYAWAY) != 0u);
  p.betaM = clamp(mix(m.c0.w * s.roughness, 1.0, fuzz), 0.02, 1.0);
  p.betaN = clamp(mix(m.c1.x * s.roughness, 1.0, fuzz), 0.02, 1.0);
  p.alpha = m.c1.y;
  p.matte = clamp(m.c3.y, 0.0, 1.0);
  p.coatTint = m.c2.rgb;
  p.matteAlbedo = s.baseColor;
  p.sigmaA = select(hairSigmaAFromColor(s.baseColor, p.betaN), hairSigmaAFromMelanin(s.melanin, m.c3.x), m.c1.w > 0.5);
  return p;
}

// ---- Surfaces ----

fn ptGgxAlpha(roughness: f32) -> f32 {
  return max(roughness * roughness, 0.002);
}

fn ptGgxD(nh: f32, a: f32) -> f32 {
  let a2 = a * a;
  let d = nh * nh * (a2 - 1.0) + 1.0;
  return a2 / (PT_PI * d * d);
}

fn ptGgxLambda(cosTheta: f32, a: f32) -> f32 {
  let c2 = max(cosTheta * cosTheta, 1e-8);
  return 0.5 * (sqrt(1.0 + a * a * (1.0 - c2) / c2) - 1.0);
}

fn ptSchlick(f0: vec3f, cosTheta: f32) -> vec3f {
  return f0 + (1.0 - f0) * pow(1.0 - clamp(cosTheta, 0.0, 1.0), 5.0);
}

/** Shading normal facing wo (surfaces are two-sided). */
fn ptFacingNormal(s: PtSurface, wo: vec3f) -> vec3f {
  return select(-s.normal, s.normal, dot(s.normal, wo) >= 0.0);
}

fn ptSurfaceF0(s: PtSurface) -> vec3f {
  return mix(vec3f(0.04), s.baseColor, s.metallic);
}

/** Probability of sampling the specular lobe. */
fn ptSpecularChance(s: PtSurface, nv: f32) -> f32 {
  let spec = ptLuminance(ptSchlick(ptSurfaceF0(s), nv));
  let diffuse = ptLuminance(s.baseColor) * (1.0 - s.metallic);
  return clamp(spec / max(spec + diffuse, 1e-6), 0.05, 0.95);
}

fn ptSurfaceEval(s: PtSurface, wo: vec3f, wi: vec3f) -> vec3f {
  let n = ptFacingNormal(s, wo);
  let nl = dot(n, wi);
  let nv = max(dot(n, wo), 1e-5);
  if (nl <= 0.0) {
    return vec3f(0.0);
  }
  let h = normalize(wo + wi);
  let a = ptGgxAlpha(s.roughness);
  let f = ptSchlick(ptSurfaceF0(s), dot(wo, h));
  let g = 1.0 / (1.0 + ptGgxLambda(nv, a) + ptGgxLambda(nl, a));
  let specular = f * ptGgxD(max(dot(n, h), 0.0), a) * g / (4.0 * nv);
  let diffuse = (1.0 - s.metallic) * (1.0 - f) * s.baseColor * PT_INV_PI * nl;
  return specular + diffuse;
}

fn ptSurfacePdf(s: PtSurface, wo: vec3f, wi: vec3f) -> f32 {
  let n = ptFacingNormal(s, wo);
  let nl = dot(n, wi);
  let nv = max(dot(n, wo), 1e-5);
  if (nl <= 0.0) {
    return 0.0;
  }
  let h = normalize(wo + wi);
  let a = ptGgxAlpha(s.roughness);
  // Visible normal pdf (Heitz 2018) mapped to wi.
  let g1 = 1.0 / (1.0 + ptGgxLambda(nv, a));
  let specularPdf = g1 * ptGgxD(max(dot(n, h), 0.0), a) / (4.0 * nv);
  let chance = ptSpecularChance(s, nv);
  return chance * specularPdf + (1.0 - chance) * nl * PT_INV_PI;
}

/** GGX visible normal sample (Dupuy & Benyoub 2023, spherical caps) in the local frame (z = normal). */
fn ptSampleVndf(v: vec3f, a: f32, u: vec2f) -> vec3f {
  let vh = normalize(vec3f(a * v.x, a * v.y, v.z));
  let phi = PT_TWO_PI * u.x;
  let z = fma(1.0 - u.y, 1.0 + vh.z, -vh.z);
  let sinTheta = sqrt(clamp(1.0 - z * z, 0.0, 1.0));
  let c = vec3f(sinTheta * cos(phi), sinTheta * sin(phi), z) + vh;
  return normalize(vec3f(a * c.x, a * c.y, max(c.z, 1e-6)));
}

fn ptSurfaceSampleWi(s: PtSurface, wo: vec3f, u: vec3f) -> vec3f {
  let n = ptFacingNormal(s, wo);
  let basis = ptBasis(n);
  let nv = max(dot(n, wo), 1e-5);
  if (u.x < ptSpecularChance(s, nv)) {
    let local = vec3f(dot(wo, basis[0]), dot(wo, basis[1]), dot(wo, basis[2]));
    let h = ptSampleVndf(local, ptGgxAlpha(s.roughness), u.yz);
    let l = reflect(-local, h);
    return basis * l;
  }
  let r = sqrt(u.y);
  let phi = PT_TWO_PI * u.z;
  return basis * vec3f(r * cos(phi), r * sin(phi), sqrt(max(0.0, 1.0 - u.y)));
}

// ---- Fixed interfaces ----

fn pt_bsdf_eval(s: PtSurface, wo: vec3f, wi: vec3f) -> vec3f {
  if (s.kind == PT_MATERIAL_FIBER) {
    let frame = ptFiberFrame(s.tangent, wo);
    let p = ptFiberHairParams(s);
    return hairF(p, hairState(p), ptFiberLocal(frame, wo), ptFiberLocal(frame, wi));
  }
  return ptSurfaceEval(s, wo, wi);
}

fn pt_bsdf_pdf(s: PtSurface, wo: vec3f, wi: vec3f) -> f32 {
  if (s.kind == PT_MATERIAL_FIBER) {
    let frame = ptFiberFrame(s.tangent, wo);
    let p = ptFiberHairParams(s);
    return hairPdf(p, hairState(p), ptFiberLocal(frame, wo), ptFiberLocal(frame, wi));
  }
  return ptSurfacePdf(s, wo, wi);
}

fn pt_bsdf_sample(s: PtSurface, wo: vec3f, u: vec3f) -> PtBsdfSample {
  var result: PtBsdfSample;
  result.delta = 0u;
  if (s.kind == PT_MATERIAL_FIBER) {
    let frame = ptFiberFrame(s.tangent, wo);
    let p = ptFiberHairParams(s);
    let st = hairState(p);
    let woLocal = ptFiberLocal(frame, wo);
    let local = hairSampleWi(p, st, woLocal, u);
    result.wi = normalize(frame.x * local.x + frame.y * local.y + frame.z * local.z);
    result.pdf = hairPdf(p, st, woLocal, local);
    result.value = hairF(p, st, woLocal, local);
    return result;
  }
  result.wi = ptSurfaceSampleWi(s, wo, u);
  result.pdf = ptSurfacePdf(s, wo, result.wi);
  result.value = ptSurfaceEval(s, wo, result.wi);
  return result;
}
