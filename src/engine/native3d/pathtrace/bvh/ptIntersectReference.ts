/**
 * CPU mirrors of the WGSL intersections (PtTraverse.wgsl) and light sampling (PtLights.wgsl):
 * tested against brute force in Vitest and compared with the GPU in pathtrace-kernels-check.
 */
export type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const normalize = (a: V3): V3 => scale(a, 1 / Math.hypot(...a));

/** Round cone (ptIntersectRoundCone): [t, normal] or null; rd must be a unit vector. */
export function intersectRoundCone(ro: V3, rd: V3, a: V3, b: V3, ra: number, rb: number): { t: number; normal: V3 } | null {
  const ba = sub(b, a), oa = sub(ro, a), ob = sub(ro, b), rr = ra - rb;
  const m0 = dot(ba, ba), m1 = dot(ba, oa), m2 = dot(ba, rd), m3 = dot(rd, oa), m5 = dot(oa, oa), m6 = dot(ob, rd), m7 = dot(ob, ob);
  const d2 = m0 - rr * rr, k2 = d2 - m2 * m2, k1 = d2 * m3 - m1 * m2 + m2 * rr * ra, k0 = d2 * m5 - m1 * m1 + m1 * rr * ra * 2 - m0 * ra * ra;
  const h = k1 * k1 - k0 * k2;
  if (h < 0) return null;
  if (Math.abs(k2) > 1e-20) {
    const t = (-Math.sqrt(h) - k1) / k2, y = m1 - ra * rr + t * m2;
    if (y > 0 && y < d2) return { t, normal: normalize(sub(scale(add(oa, scale(rd, t)), d2), scale(ba, y))) };
  }
  const h1 = m3 * m3 - m5 + ra * ra, h2 = m6 * m6 - m7 + rb * rb;
  if (Math.max(h1, h2) < 0) return null;
  let best: { t: number; normal: V3 } | null = null;
  if (h1 > 0) { const t = -m3 - Math.sqrt(h1); best = { t, normal: scale(add(oa, scale(rd, t)), 1 / ra) }; }
  if (h2 > 0) { const t = -m6 - Math.sqrt(h2); if (!best || t < best.t) best = { t, normal: scale(add(ob, scale(rd, t)), 1 / rb) }; }
  return best;
}

/** Signed distance to the round cone (the union of spheres along the segment with linear radius). */
export function roundConeDistance(p: V3, a: V3, b: V3, ra: number, rb: number): number {
  // Exact for the sphere-swept cone: minimize |p - c(s)| - r(s) over the axis.
  let best = Infinity;
  for (let i = 0; i <= 2000; i++) {
    const s = i / 2000, c = add(a, scale(sub(b, a), s)), r = ra + (rb - ra) * s;
    best = Math.min(best, Math.hypot(...sub(p, c)) - r);
  }
  return best;
}

/** Möller-Trumbore (ptIntersectTriangle): [t, u, v] or null. */
export function intersectTriangle(ro: V3, rd: V3, p0: V3, p1: V3, p2: V3): [number, number, number] | null {
  const e1 = sub(p1, p0), e2 = sub(p2, p0), pv = cross(rd, e2), det = dot(e1, pv);
  if (Math.abs(det) < 1e-14) return null;
  const inv = 1 / det, tv = sub(ro, p0), u = dot(tv, pv) * inv;
  if (u < 0 || u > 1) return null;
  const qv = cross(tv, e1), v = dot(rd, qv) * inv;
  if (v < 0 || u + v > 1) return null;
  return [dot(e2, qv) * inv, u, v];
}

/** Parallelogram (ptIntersectQuad): [t, s, w] or null. */
export function intersectQuad(ro: V3, rd: V3, origin: V3, u: V3, v: V3): [number, number, number] | null {
  const n = cross(u, v), denom = dot(n, rd);
  if (Math.abs(denom) < 1e-14) return null;
  const t = dot(n, sub(origin, ro)) / denom, p = sub(add(ro, scale(rd, t)), origin);
  const uu = dot(u, u), uv = dot(u, v), vv = dot(v, v), pu = dot(p, u), pv = dot(p, v), det = uu * vv - uv * uv;
  const s = (pu * vv - pv * uv) / det, w = (pv * uu - pu * uv) / det;
  return s < 0 || s > 1 || w < 0 || w > 1 ? null : [t, s, w];
}

/** Cone sampling of a sphere light (ptSampleSphereLight): direction and solid angle pdf. */
export function sampleSphereLight(p: V3, center: V3, radius: number, u: [number, number]): { wi: V3; pdf: number } | null {
  const toCenter = sub(center, p), d2 = dot(toCenter, toCenter);
  if (d2 <= radius * radius) return null;
  const w = normalize(toCenter), cosMax = Math.sqrt(Math.max(0, 1 - radius * radius / d2));
  const cosTheta = 1 - u[0] * (1 - cosMax), sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta)), phi = 2 * Math.PI * u[1];
  const helper: V3 = Math.abs(w[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const t = normalize(cross(helper, w)), bt = cross(w, t);
  const wi = normalize(add(add(scale(t, sinTheta * Math.cos(phi)), scale(bt, sinTheta * Math.sin(phi))), scale(w, cosTheta)));
  return { wi, pdf: 1 / (2 * Math.PI * Math.max(1 - cosMax, 1e-7)) };
}

/** Power heuristic (ptPowerHeuristic). */
export const powerHeuristic = (a: number, b: number) => (a * a) / Math.max(a * a + b * b, 1e-30);
