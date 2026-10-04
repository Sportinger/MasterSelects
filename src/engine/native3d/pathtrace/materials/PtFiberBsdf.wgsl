// Fiber BSDF (Chiang et al. 2016), the WGSL mirror of ptChiangHair.ts: R, TT, TRT and residual
// lobes, cuticle tilt, coat tint on R, a matte share and flyaway fuzz from the Fiber Material.
// Values are f · |cos θi| in the fiber frame x = tangent, z = toward wo, y = z × x.
// Requires PtCommon.wgsl.

const HAIR_P_MAX: u32 = 3u;
const HAIR_SQRT_PI_OVER_8: f32 = 0.626657069;

struct PtHairParams {
  h: f32,
  eta: f32,
  betaM: f32,
  betaN: f32,
  alpha: f32,
  matte: f32,
  sigmaA: vec3f,
  coatTint: vec3f,
  matteAlbedo: vec3f,
};

struct PtHairState {
  gammaO: f32,
  s: f32,
  v: vec4f,
  sin2kAlpha: vec3f,
  cos2kAlpha: vec3f,
};

struct PtHairGeometry {
  sinThetaO: f32,
  cosThetaO: f32,
  phiO: f32,
  gammaT: f32,
  transmittance: vec3f,
};

fn hairSafeSqrt(x: f32) -> f32 {
  return sqrt(max(x, 0.0));
}

fn hairSafeAsin(x: f32) -> f32 {
  return asin(clamp(x, -1.0, 1.0));
}

fn hairState(p: PtHairParams) -> PtHairState {
  var st: PtHairState;
  let bm = p.betaM;
  let v0 = pow(0.726 * bm + 0.812 * bm * bm + 3.7 * pow(bm, 20.0), 2.0);
  st.v = vec4f(v0, 0.25 * v0, 4.0 * v0, 4.0 * v0);
  let bn = p.betaN;
  st.s = HAIR_SQRT_PI_OVER_8 * (0.265 * bn + 1.194 * bn * bn + 5.372 * pow(bn, 22.0));
  st.sin2kAlpha.x = sin(p.alpha);
  st.cos2kAlpha.x = hairSafeSqrt(1.0 - st.sin2kAlpha.x * st.sin2kAlpha.x);
  st.sin2kAlpha.y = 2.0 * st.cos2kAlpha.x * st.sin2kAlpha.x;
  st.cos2kAlpha.y = st.cos2kAlpha.x * st.cos2kAlpha.x - st.sin2kAlpha.x * st.sin2kAlpha.x;
  st.sin2kAlpha.z = 2.0 * st.cos2kAlpha.y * st.sin2kAlpha.y;
  st.cos2kAlpha.z = st.cos2kAlpha.y * st.cos2kAlpha.y - st.sin2kAlpha.y * st.sin2kAlpha.y;
  st.gammaO = hairSafeAsin(p.h);
  return st;
}

/** Color to absorption (Chiang 2016, eq. 9). */
fn hairSigmaAFromColor(color: vec3f, betaN: f32) -> vec3f {
  let d = 5.969 - 0.215 * betaN + 2.532 * betaN * betaN - 10.73 * pow(betaN, 3.0) + 5.574 * pow(betaN, 4.0) + 0.245 * pow(betaN, 5.0);
  let l = log(max(color, vec3f(1e-4))) / d;
  return l * l;
}

fn hairSigmaAFromMelanin(melanin: f32, redness: f32) -> vec3f {
  return melanin * (1.0 - redness) * vec3f(0.419, 0.697, 1.37) + melanin * redness * vec3f(0.187, 0.4, 1.05);
}

fn hairI0(x: f32) -> f32 {
  var value = 0.0;
  var x2i = 1.0;
  var ifact = 1.0;
  var i4 = 1.0;
  for (var i = 0; i < 10; i++) {
    if (i > 1) {
      ifact *= f32(i);
    }
    value += x2i / (i4 * ifact * ifact);
    x2i *= x * x;
    i4 *= 4.0;
  }
  return value;
}

fn hairLogI0(x: f32) -> f32 {
  if (x > 12.0) {
    return x + 0.5 * (-log(PT_TWO_PI) + log(1.0 / x) + 1.0 / (8.0 * x));
  }
  return log(hairI0(x));
}

fn hairMp(cosThetaI: f32, cosThetaO: f32, sinThetaI: f32, sinThetaO: f32, v: f32) -> f32 {
  let a = cosThetaI * cosThetaO / v;
  let b = sinThetaI * sinThetaO / v;
  if (v <= 0.1) {
    return exp(hairLogI0(a) - b - 1.0 / v + 0.6931 + log(1.0 / (2.0 * v)));
  }
  return exp(-b) * hairI0(a) / (sinh(1.0 / v) * 2.0 * v);
}

fn hairFresnel(cosThetaIIn: f32, etaIn: f32) -> f32 {
  var cosThetaI = clamp(cosThetaIIn, -1.0, 1.0);
  var eta = etaIn;
  if (cosThetaI < 0.0) {
    eta = 1.0 / eta;
    cosThetaI = -cosThetaI;
  }
  let sin2ThetaT = (1.0 - cosThetaI * cosThetaI) / (eta * eta);
  if (sin2ThetaT >= 1.0) {
    return 1.0;
  }
  let cosThetaT = hairSafeSqrt(1.0 - sin2ThetaT);
  let rParl = (eta * cosThetaI - cosThetaT) / (eta * cosThetaI + cosThetaT);
  let rPerp = (cosThetaI - eta * cosThetaT) / (cosThetaI + eta * cosThetaT);
  return 0.5 * (rParl * rParl + rPerp * rPerp);
}

/** Attenuation per lobe: columns R, TT, TRT, residual. */
fn hairAp(cosThetaO: f32, p: PtHairParams, transmittance: vec3f) -> mat4x3f {
  let f = hairFresnel(cosThetaO * hairSafeSqrt(1.0 - p.h * p.h), p.eta);
  let r = vec3f(f) * p.coatTint;
  let tt = (1.0 - f) * (1.0 - f) * transmittance;
  let trt = tt * transmittance * f;
  let denominator = vec3f(1.0) - transmittance * f;
  let residual = select(vec3f(0.0), trt * f * transmittance / max(denominator, vec3f(1e-6)), denominator > vec3f(1e-6));
  return mat4x3f(r, tt, trt, residual);
}

fn hairPhi(p: f32, gammaO: f32, gammaT: f32) -> f32 {
  return 2.0 * p * gammaT - 2.0 * gammaO + p * PT_PI;
}

fn hairLogistic(x: f32, s: f32) -> f32 {
  let e = exp(-abs(x) / s);
  return e / (s * (1.0 + e) * (1.0 + e));
}

fn hairLogisticCdf(x: f32, s: f32) -> f32 {
  return 1.0 / (1.0 + exp(-x / s));
}

fn hairNp(phi: f32, p: u32, s: f32, gammaO: f32, gammaT: f32) -> f32 {
  var dphi = phi - hairPhi(f32(p), gammaO, gammaT);
  dphi = dphi - PT_TWO_PI * floor((dphi + PT_PI) / PT_TWO_PI);
  return hairLogistic(dphi, s) / (hairLogisticCdf(PT_PI, s) - hairLogisticCdf(-PT_PI, s));
}

fn hairSampleTrimmedLogistic(u: f32, s: f32) -> f32 {
  let low = hairLogisticCdf(-PT_PI, s);
  let k = hairLogisticCdf(PT_PI, s) - low;
  return clamp(-s * log(1.0 / (u * k + low) - 1.0), -PT_PI, PT_PI);
}

/** sin/cos of θo tilted by the cuticle for lobe p (R by -2α, TT by α, TRT by 4α). */
fn hairTilt(st: PtHairState, p: u32, sinThetaO: f32, cosThetaO: f32) -> vec2f {
  if (p == 0u) {
    return vec2f(sinThetaO * st.cos2kAlpha.y - cosThetaO * st.sin2kAlpha.y, abs(cosThetaO * st.cos2kAlpha.y + sinThetaO * st.sin2kAlpha.y));
  }
  if (p == 1u) {
    return vec2f(sinThetaO * st.cos2kAlpha.x + cosThetaO * st.sin2kAlpha.x, abs(cosThetaO * st.cos2kAlpha.x - sinThetaO * st.sin2kAlpha.x));
  }
  if (p == 2u) {
    return vec2f(sinThetaO * st.cos2kAlpha.z + cosThetaO * st.sin2kAlpha.z, abs(cosThetaO * st.cos2kAlpha.z - sinThetaO * st.sin2kAlpha.z));
  }
  return vec2f(sinThetaO, cosThetaO);
}

fn hairGeometry(p: PtHairParams, wo: vec3f) -> PtHairGeometry {
  var g: PtHairGeometry;
  g.sinThetaO = wo.x;
  g.cosThetaO = hairSafeSqrt(1.0 - wo.x * wo.x);
  g.phiO = atan2(wo.z, wo.y);
  let sinThetaT = g.sinThetaO / p.eta;
  let cosThetaT = hairSafeSqrt(1.0 - sinThetaT * sinThetaT);
  let etap = hairSafeSqrt(p.eta * p.eta - g.sinThetaO * g.sinThetaO) / max(g.cosThetaO, 1e-6);
  let sinGammaT = p.h / etap;
  let cosGammaT = hairSafeSqrt(1.0 - sinGammaT * sinGammaT);
  g.gammaT = hairSafeAsin(sinGammaT);
  g.transmittance = exp(-p.sigmaA * (2.0 * cosGammaT / max(cosThetaT, 1e-6)));
  return g;
}

fn hairMatteNormal(h: f32) -> vec3f {
  return vec3f(0.0, h, hairSafeSqrt(1.0 - h * h));
}

/** f · |cos θi| with wo, wi in the fiber frame. */
fn hairF(p: PtHairParams, st: PtHairState, wo: vec3f, wi: vec3f) -> vec3f {
  let g = hairGeometry(p, wo);
  let sinThetaI = wi.x;
  let cosThetaI = hairSafeSqrt(1.0 - sinThetaI * sinThetaI);
  let phi = atan2(wi.z, wi.y) - g.phiO;
  let ap = hairAp(g.cosThetaO, p, g.transmittance);
  var sum = vec3f(0.0);
  for (var lobe = 0u; lobe < HAIR_P_MAX; lobe++) {
    let t = hairTilt(st, lobe, g.sinThetaO, g.cosThetaO);
    sum += hairMp(cosThetaI, t.y, sinThetaI, t.x, st.v[lobe]) * hairNp(phi, lobe, st.s, st.gammaO, g.gammaT) * ap[lobe];
  }
  sum += hairMp(cosThetaI, g.cosThetaO, sinThetaI, g.sinThetaO, st.v[HAIR_P_MAX]) / PT_TWO_PI * ap[HAIR_P_MAX];
  if (p.matte <= 0.0) {
    return sum;
  }
  let cosMatte = max(dot(hairMatteNormal(p.h), wi), 0.0);
  return (1.0 - p.matte) * sum + p.matte * p.matteAlbedo * PT_INV_PI * cosMatte;
}

fn hairApPdf(p: PtHairParams, g: PtHairGeometry) -> vec4f {
  let ap = hairAp(g.cosThetaO, p, g.transmittance);
  let y = vec4f(dot(ap[0], vec3f(1.0 / 3.0)), dot(ap[1], vec3f(1.0 / 3.0)), dot(ap[2], vec3f(1.0 / 3.0)), dot(ap[3], vec3f(1.0 / 3.0)));
  let sum = y.x + y.y + y.z + y.w;
  return select(vec4f(1.0, 0.0, 0.0, 0.0), y / sum, sum > 0.0);
}

fn hairPdf(p: PtHairParams, st: PtHairState, wo: vec3f, wi: vec3f) -> f32 {
  let g = hairGeometry(p, wo);
  let pdfs = hairApPdf(p, g);
  let sinThetaI = wi.x;
  let cosThetaI = hairSafeSqrt(1.0 - sinThetaI * sinThetaI);
  let phi = atan2(wi.z, wi.y) - g.phiO;
  var pdf = 0.0;
  for (var lobe = 0u; lobe < HAIR_P_MAX; lobe++) {
    let t = hairTilt(st, lobe, g.sinThetaO, g.cosThetaO);
    pdf += hairMp(cosThetaI, t.y, sinThetaI, t.x, st.v[lobe]) * pdfs[lobe] * hairNp(phi, lobe, st.s, st.gammaO, g.gammaT);
  }
  pdf += hairMp(cosThetaI, g.cosThetaO, sinThetaI, g.sinThetaO, st.v[HAIR_P_MAX]) * pdfs[HAIR_P_MAX] / PT_TWO_PI;
  if (p.matte <= 0.0) {
    return pdf;
  }
  return (1.0 - p.matte) * pdf + p.matte * max(dot(hairMatteNormal(p.h), wi), 0.0) * PT_INV_PI;
}

/** Samples wi in the fiber frame: u.x picks the lobe (remainder: M_p azimuth), u.y N_p, u.z M_p. */
fn hairSampleWi(p: PtHairParams, st: PtHairState, wo: vec3f, u: vec3f) -> vec3f {
  var u0 = u.x;
  if (p.matte > 0.0 && u0 < p.matte) {
    let um = u0 / p.matte;
    let r = sqrt(um);
    let phi = PT_TWO_PI * u.y;
    let n = hairMatteNormal(p.h);
    let b = vec3f(0.0, n.z, -n.y);
    return vec3f(1.0, 0.0, 0.0) * (r * cos(phi)) + b * (r * sin(phi)) + n * hairSafeSqrt(1.0 - um);
  }
  if (p.matte > 0.0) {
    u0 = (u0 - p.matte) / (1.0 - p.matte);
  }
  let g = hairGeometry(p, wo);
  let pdfs = hairApPdf(p, g);
  var lobe = 0u;
  loop {
    if (lobe >= HAIR_P_MAX || u0 < pdfs[lobe]) {
      break;
    }
    u0 -= pdfs[lobe];
    lobe++;
  }
  let remainder = clamp(u0 / max(pdfs[lobe], 1e-12), 0.0, 0.99999994);
  let t = hairTilt(st, lobe, g.sinThetaO, g.cosThetaO);
  let um = max(u.z, 1e-5);
  let v = st.v[lobe];
  let cosTheta = 1.0 + v * log(um + (1.0 - um) * exp(-2.0 / v));
  let sinTheta = hairSafeSqrt(1.0 - cosTheta * cosTheta);
  let sinThetaI = -cosTheta * t.x + sinTheta * cos(PT_TWO_PI * remainder) * t.y;
  let cosThetaI = hairSafeSqrt(1.0 - sinThetaI * sinThetaI);
  var dphi = PT_TWO_PI * u.y;
  if (lobe < HAIR_P_MAX) {
    dphi = hairPhi(f32(lobe), st.gammaO, g.gammaT) + hairSampleTrimmedLogistic(u.y, st.s);
  }
  let phiI = g.phiO + dphi;
  return vec3f(sinThetaI, cosThetaI * cos(phiI), cosThetaI * sin(phiI));
}
