/**
 * CPU reference of the fiber BSDF (Chiang, Bitterli, Tappan, Burley 2016, as in pbrt-v3/v4): lobes
 * R, TT, TRT plus the residual, longitudinal M_p with Chiang's roughness mapping, azimuthal N_p as a
 * trimmed logistic, attenuation from absorption σa, cuticle tilt α. Additions of the Fiber Material
 * node: a coat tint on R, a matte share (Lambert on the fiber surface) and fuzz for flyaways.
 * PtFiberBsdf.wgsl mirrors this function for function; the white furnace test checks it.
 *
 * Local frame: x along the fiber, y across it (h is the offset along y), z toward the viewer.
 * `f` returns f(wo, wi) · |cos θi| like every path tracing BSDF here, so integrators never divide.
 */

export type Rgb = [number, number, number];
export type Vec3 = [number, number, number];

export interface HairParams {
  /** Offset across the fiber in [-1, 1]. */
  h: number;
  eta: number;
  sigmaA: Rgb;
  /** Longitudinal and azimuthal roughness in [0, 1]. */
  betaM: number;
  betaN: number;
  /** Cuticle tilt in radians. */
  alpha: number;
  coatTint?: Rgb;
  /** Share of the matte (Lambertian) lobe, and its albedo. */
  matte?: number;
  matteAlbedo?: Rgb;
}

export const HAIR_P_MAX = 3;
const SQRT_PI_OVER_8 = 0.626657069;

export interface HairState {
  params: HairParams;
  gammaO: number;
  v: number[];
  s: number;
  sin2kAlpha: number[];
  cos2kAlpha: number[];
}

const sqr = (x: number) => x * x;
const safeSqrt = (x: number) => Math.sqrt(Math.max(0, x));
const safeAsin = (x: number) => Math.asin(Math.min(1, Math.max(-1, x)));

export function hairState(params: HairParams): HairState {
  const { betaM, betaN, alpha } = params;
  const v0 = sqr(0.726 * betaM + 0.812 * sqr(betaM) + 3.7 * betaM ** 20);
  const v = [v0, 0.25 * v0, 4 * v0, 4 * v0];
  const s = SQRT_PI_OVER_8 * (0.265 * betaN + 1.194 * sqr(betaN) + 5.372 * betaN ** 22);
  const sin2kAlpha = [Math.sin(alpha)], cos2kAlpha = [safeSqrt(1 - sqr(sin2kAlpha[0]))];
  for (let i = 1; i < 3; i++) {
    sin2kAlpha[i] = 2 * cos2kAlpha[i - 1] * sin2kAlpha[i - 1];
    cos2kAlpha[i] = sqr(cos2kAlpha[i - 1]) - sqr(sin2kAlpha[i - 1]);
  }
  return { params, gammaO: safeAsin(params.h), v, s, sin2kAlpha, cos2kAlpha };
}

/** Color to absorption (Chiang 2016, eq. 9) for a given azimuthal roughness. */
export function sigmaAFromColor(color: Rgb, betaN: number): Rgb {
  const d = 5.969 - 0.215 * betaN + 2.532 * sqr(betaN) - 10.73 * betaN ** 3 + 5.574 * betaN ** 4 + 0.245 * betaN ** 5;
  return color.map(c => sqr(Math.log(Math.max(c, 1e-4)) / d)) as Rgb;
}

/** Melanin concentration and redness (pheomelanin share) to absorption (d'Eon 2011 / pbrt-v4). */
export function sigmaAFromMelanin(melanin: number, redness: number): Rgb {
  const eumelanin: Rgb = [0.419, 0.697, 1.37], pheomelanin: Rgb = [0.187, 0.4, 1.05];
  const ce = melanin * (1 - redness), cp = melanin * redness;
  return [0, 1, 2].map(i => ce * eumelanin[i] + cp * pheomelanin[i]) as Rgb;
}

function besselI0(x: number): number {
  let value = 0, x2i = 1, ifact = 1, i4 = 1;
  for (let i = 0; i < 10; i++) {
    if (i > 1) ifact *= i;
    value += x2i / (i4 * sqr(ifact));
    x2i *= x * x;
    i4 *= 4;
  }
  return value;
}

function logI0(x: number): number {
  return x > 12 ? x + 0.5 * (-Math.log(2 * Math.PI) + Math.log(1 / x) + 1 / (8 * x)) : Math.log(besselI0(x));
}

export function hairMp(cosThetaI: number, cosThetaO: number, sinThetaI: number, sinThetaO: number, v: number): number {
  const a = cosThetaI * cosThetaO / v, b = sinThetaI * sinThetaO / v;
  return v <= 0.1
    ? Math.exp(logI0(a) - b - 1 / v + 0.6931 + Math.log(1 / (2 * v)))
    : Math.exp(-b) * besselI0(a) / (Math.sinh(1 / v) * 2 * v);
}

function frDielectric(cosThetaIIn: number, etaIn: number): number {
  let cosThetaI = Math.min(1, Math.max(-1, cosThetaIIn)), eta = etaIn;
  if (cosThetaI < 0) { eta = 1 / eta; cosThetaI = -cosThetaI; }
  const sin2ThetaI = 1 - sqr(cosThetaI), sin2ThetaT = sin2ThetaI / sqr(eta);
  if (sin2ThetaT >= 1) return 1;
  const cosThetaT = safeSqrt(1 - sin2ThetaT);
  const rParl = (eta * cosThetaI - cosThetaT) / (eta * cosThetaI + cosThetaT);
  const rPerp = (cosThetaI - eta * cosThetaT) / (cosThetaI + eta * cosThetaT);
  return (sqr(rParl) + sqr(rPerp)) / 2;
}

/** Attenuation per lobe (R, TT, TRT, residual). */
export function hairAp(cosThetaO: number, eta: number, h: number, transmittance: Rgb): Rgb[] {
  const cosGammaO = safeSqrt(1 - h * h), f = frDielectric(cosThetaO * cosGammaO, eta);
  const ap: Rgb[] = [[f, f, f]];
  ap[1] = transmittance.map(t => sqr(1 - f) * t) as Rgb;
  for (let p = 2; p < HAIR_P_MAX; p++) ap[p] = ap[p - 1].map((a, i) => a * transmittance[i] * f) as Rgb;
  ap[HAIR_P_MAX] = ap[HAIR_P_MAX - 1].map((a, i) => {
    const denominator = 1 - transmittance[i] * f;
    return denominator > 1e-6 ? a * f * transmittance[i] / denominator : 0;
  }) as Rgb;
  return ap;
}

const phiP = (p: number, gammaO: number, gammaT: number) => 2 * p * gammaT - 2 * gammaO + p * Math.PI;
const logistic = (x: number, s: number) => { const e = Math.exp(-Math.abs(x) / s); return e / (s * sqr(1 + e)); };
const logisticCdf = (x: number, s: number) => 1 / (1 + Math.exp(-x / s));
const trimmedLogistic = (x: number, s: number, a: number, b: number) => logistic(x, s) / (logisticCdf(b, s) - logisticCdf(a, s));

export function hairNp(phi: number, p: number, s: number, gammaO: number, gammaT: number): number {
  let dphi = phi - phiP(p, gammaO, gammaT);
  while (dphi > Math.PI) dphi -= 2 * Math.PI;
  while (dphi < -Math.PI) dphi += 2 * Math.PI;
  return trimmedLogistic(dphi, s, -Math.PI, Math.PI);
}

function sampleTrimmedLogistic(u: number, s: number, a: number, b: number): number {
  const k = logisticCdf(b, s) - logisticCdf(a, s);
  const x = -s * Math.log(1 / (u * k + logisticCdf(a, s)) - 1);
  return Math.min(b, Math.max(a, x));
}

/** sin/cos of θo tilted by the cuticle for lobe p (R tilts by -2α, TT by α, TRT by 4α). */
function tilt(state: HairState, p: number, sinThetaO: number, cosThetaO: number): [number, number] {
  const { sin2kAlpha: s, cos2kAlpha: c } = state;
  if (p === 0) return [sinThetaO * c[1] - cosThetaO * s[1], Math.abs(cosThetaO * c[1] + sinThetaO * s[1])];
  if (p === 1) return [sinThetaO * c[0] + cosThetaO * s[0], Math.abs(cosThetaO * c[0] - sinThetaO * s[0])];
  if (p === 2) return [sinThetaO * c[2] + cosThetaO * s[2], Math.abs(cosThetaO * c[2] - sinThetaO * s[2])];
  return [sinThetaO, cosThetaO];
}

interface Geometry { sinThetaO: number; cosThetaO: number; phiO: number; gammaT: number; transmittance: Rgb }
function geometry(state: HairState, wo: Vec3): Geometry {
  const { eta, h, sigmaA } = state.params;
  const sinThetaO = wo[0], cosThetaO = safeSqrt(1 - sqr(sinThetaO)), phiO = Math.atan2(wo[2], wo[1]);
  const sinThetaT = sinThetaO / eta, cosThetaT = safeSqrt(1 - sqr(sinThetaT));
  const etap = safeSqrt(sqr(eta) - sqr(sinThetaO)) / Math.max(cosThetaO, 1e-6);
  const sinGammaT = h / etap, cosGammaT = safeSqrt(1 - sqr(sinGammaT)), gammaT = safeAsin(sinGammaT);
  const transmittance = sigmaA.map(a => Math.exp(-a * (2 * cosGammaT / Math.max(cosThetaT, 1e-6)))) as Rgb;
  return { sinThetaO, cosThetaO, phiO, gammaT, transmittance };
}

/** Matte lobe normal: the fiber surface normal at offset h (y across, z toward the viewer). */
function matteNormal(h: number): Vec3 { return [0, h, safeSqrt(1 - h * h)]; }

export function hairF(state: HairState, wo: Vec3, wi: Vec3): Rgb {
  const g = geometry(state, wo);
  const sinThetaI = wi[0], cosThetaI = safeSqrt(1 - sqr(sinThetaI)), phiI = Math.atan2(wi[2], wi[1]);
  const phi = phiI - g.phiO, ap = hairAp(g.cosThetaO, state.params.eta, state.params.h, g.transmittance);
  if (state.params.coatTint) ap[0] = ap[0].map((a, i) => a * state.params.coatTint![i]) as Rgb;
  const sum: Rgb = [0, 0, 0];
  for (let p = 0; p < HAIR_P_MAX; p++) {
    const [sinThetaPO, cosThetaPO] = tilt(state, p, g.sinThetaO, g.cosThetaO);
    const weight = hairMp(cosThetaI, cosThetaPO, sinThetaI, sinThetaPO, state.v[p]) * hairNp(phi, p, state.s, state.gammaO, g.gammaT);
    for (let i = 0; i < 3; i++) sum[i] += weight * ap[p][i];
  }
  const residual = hairMp(cosThetaI, g.cosThetaO, sinThetaI, g.sinThetaO, state.v[HAIR_P_MAX]) / (2 * Math.PI);
  for (let i = 0; i < 3; i++) sum[i] += residual * ap[HAIR_P_MAX][i];
  const matte = state.params.matte ?? 0;
  if (matte <= 0) return sum;
  const n = matteNormal(state.params.h), cos = Math.max(0, n[0] * wi[0] + n[1] * wi[1] + n[2] * wi[2]);
  const albedo = state.params.matteAlbedo ?? [1, 1, 1];
  return sum.map((value, i) => (1 - matte) * value + matte * albedo[i] / Math.PI * cos) as Rgb;
}

/** Lobe selection probabilities from the attenuation luminance. */
function apPdf(state: HairState, g: Geometry): number[] {
  const ap = hairAp(g.cosThetaO, state.params.eta, state.params.h, g.transmittance);
  if (state.params.coatTint) ap[0] = ap[0].map((a, i) => a * state.params.coatTint![i]) as Rgb;
  const y = ap.map(a => (a[0] + a[1] + a[2]) / 3), sum = y.reduce((a, b) => a + b, 0);
  return sum > 0 ? y.map(value => value / sum) : [1, 0, 0, 0];
}

export function hairPdf(state: HairState, wo: Vec3, wi: Vec3): number {
  const g = geometry(state, wo), pdfs = apPdf(state, g);
  const sinThetaI = wi[0], cosThetaI = safeSqrt(1 - sqr(sinThetaI)), phi = Math.atan2(wi[2], wi[1]) - g.phiO;
  let pdf = 0;
  for (let p = 0; p < HAIR_P_MAX; p++) {
    const [sinThetaPO, cosThetaPO] = tilt(state, p, g.sinThetaO, g.cosThetaO);
    pdf += hairMp(cosThetaI, cosThetaPO, sinThetaI, sinThetaPO, state.v[p]) * pdfs[p] * hairNp(phi, p, state.s, state.gammaO, g.gammaT);
  }
  pdf += hairMp(cosThetaI, g.cosThetaO, sinThetaI, g.sinThetaO, state.v[HAIR_P_MAX]) * pdfs[HAIR_P_MAX] / (2 * Math.PI);
  const matte = state.params.matte ?? 0;
  if (matte <= 0) return pdf;
  const n = matteNormal(state.params.h), cos = Math.max(0, n[0] * wi[0] + n[1] * wi[1] + n[2] * wi[2]);
  return (1 - matte) * pdf + matte * cos / Math.PI;
}

/** Samples wi with three uniforms: u0 picks the lobe (its remainder drives the M_p azimuth), u1 N_p, u2 M_p. */
export function hairSample(state: HairState, wo: Vec3, u: [number, number, number]): { wi: Vec3; pdf: number; value: Rgb } {
  const matte = state.params.matte ?? 0;
  let u0 = u[0];
  if (matte > 0 && u0 < matte) {
    // Cosine-weighted direction around the fiber surface normal.
    u0 /= matte;
    const r = Math.sqrt(u0), phi = 2 * Math.PI * u[1];
    const local: Vec3 = [r * Math.cos(phi), r * Math.sin(phi), safeSqrt(1 - u0)];
    const n = matteNormal(state.params.h), t: Vec3 = [1, 0, 0], b: Vec3 = [0, n[2], -n[1]];
    const wi: Vec3 = [0, 1, 2].map(i => local[0] * t[i] + local[1] * b[i] + local[2] * n[i]) as Vec3;
    return { wi, pdf: hairPdf(state, wo, wi), value: hairF(state, wo, wi) };
  }
  if (matte > 0) u0 = (u0 - matte) / (1 - matte);
  const g = geometry(state, wo), pdfs = apPdf(state, g);
  let p = 0;
  for (; p < HAIR_P_MAX; p++) {
    if (u0 < pdfs[p]) break;
    u0 -= pdfs[p];
  }
  const remainder = Math.min(Math.max(u0 / Math.max(pdfs[p], 1e-12), 0), 0.99999994);
  const [sinThetaPO, cosThetaPO] = tilt(state, p, g.sinThetaO, g.cosThetaO);
  const um = Math.max(u[2], 1e-5);
  const cosTheta = 1 + state.v[p] * Math.log(um + (1 - um) * Math.exp(-2 / state.v[p]));
  const sinTheta = safeSqrt(1 - sqr(cosTheta)), cosPhi = Math.cos(2 * Math.PI * remainder);
  const sinThetaI = -cosTheta * sinThetaPO + sinTheta * cosPhi * cosThetaPO, cosThetaI = safeSqrt(1 - sqr(sinThetaI));
  const dphi = p < HAIR_P_MAX ? phiP(p, state.gammaO, g.gammaT) + sampleTrimmedLogistic(u[1], state.s, -Math.PI, Math.PI) : 2 * Math.PI * u[1];
  const phiI = g.phiO + dphi;
  const wi: Vec3 = [sinThetaI, cosThetaI * Math.cos(phiI), cosThetaI * Math.sin(phiI)];
  return { wi, pdf: hairPdf(state, wo, wi), value: hairF(state, wo, wi) };
}
