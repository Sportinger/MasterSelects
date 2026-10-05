#pragma once
#include "scene.h"

// CUDA port of PtFiberBsdf.wgsl (Chiang 2016), including matte, coat and flyaway fuzz.
struct Hair {
  float h, eta, bm, bn, alpha, matte;
  float3 absorption, coat, color;
};
struct HairState {
  float gamma, s, v[4];
  float3 sa, ca;
};
struct HairGeometry {
  float so, co, phi, gamma;
  float3 transmission;
};
D HairState hairState(Hair p) {
  HairState s{};
  float m = p.bm, n = p.bn, v = powf(.726f * m + .812f * m * m + 3.7f * powf(m, 20), 2);
  s.v[0] = v;
  s.v[1] = v * .25f;
  s.v[2] = s.v[3] = v * 4;
  s.s = .626657069f * (.265f * n + 1.194f * n * n + 5.372f * powf(n, 22));
  s.sa.x = sinf(p.alpha);
  s.ca.x = safeSqrt(1 - s.sa.x * s.sa.x);
  s.sa.y = 2 * s.ca.x * s.sa.x;
  s.ca.y = s.ca.x * s.ca.x - s.sa.x * s.sa.x;
  s.sa.z = 2 * s.ca.y * s.sa.y;
  s.ca.z = s.ca.y * s.ca.y - s.sa.y * s.sa.y;
  s.gamma = asinf(clamp(p.h, -1, 1));
  return s;
}
D float3 absorptionFromColor(float3 c, float b) {
  float d =
      5.969f - .215f * b + 2.532f * b * b - 10.73f * powf(b, 3) + 5.574f * powf(b, 4) + .245f * powf(b, 5);
  float3 l = log3(max3(c, 1e-4f)) / d;
  return l * l;
}
D float i0(float x) {
  float value = 0, x2 = 1, fact = 1, i4 = 1;
  for (int i = 0; i < 10; i++) {
    if (i > 1)
      fact *= i;
    value += x2 / (i4 * fact * fact);
    x2 *= x * x;
    i4 *= 4;
  }
  return value;
}
D float logI0(float x) {
  return x > 12 ? x + .5f * (-logf(TWO_PI) + logf(1 / x) + 1 / (8 * x)) : logf(i0(x));
}
D float mp(float ci, float co, float si, float so, float v) {
  float a = ci * co / v, b = si * so / v;
  return v <= .1f ? expf(logI0(a) - b - 1 / v + .6931f + logf(1 / (2 * v)))
                  : expf(-b) * i0(a) / (sinhf(1 / v) * 2 * v);
}
D float fresnel(float c, float eta) {
  c = clamp(c, -1, 1);
  if (c < 0) {
    eta = 1 / eta;
    c = -c;
  }
  float t = (1 - c * c) / (eta * eta);
  if (t >= 1)
    return 1;
  float ct = safeSqrt(1 - t), a = (eta * c - ct) / (eta * c + ct), b = (c - eta * ct) / (c + eta * ct);
  return .5f * (a * a + b * b);
}
D void attenuations(Hair p, float co, float3 t, float3 *ap) {
  float f = fresnel(co * safeSqrt(1 - p.h * p.h), p.eta);
  ap[0] = p.coat * f;
  ap[1] = (1 - f) * (1 - f) * t;
  ap[2] = ap[1] * t * f;
  float3 denominator = 1 - t * f;
  ap[3] = ap[2] * f * t / max3(denominator, 1e-6f);
  if (denominator.x <= 1e-6f)
    ap[3].x = 0;
  if (denominator.y <= 1e-6f)
    ap[3].y = 0;
  if (denominator.z <= 1e-6f)
    ap[3].z = 0;
}
D float phiLobe(int p, float o, float t) { return 2 * p * t - 2 * o + p * PI; }
D float logistic(float x, float s) {
  float e = expf(-fabsf(x) / s);
  return e / (s * (1 + e) * (1 + e));
}
D float cdf(float x, float s) { return 1 / (1 + expf(-x / s)); }
D float np(float phi, int p, float s, float go, float gt) {
  float d = phi - phiLobe(p, go, gt);
  d -= TWO_PI * floorf((d + PI) / TWO_PI);
  return logistic(d, s) / (cdf(PI, s) - cdf(-PI, s));
}
D float sampleLogistic(float u, float s) {
  float lo = cdf(-PI, s), k = cdf(PI, s) - lo;
  return clamp(-s * logf(1 / (u * k + lo) - 1), -PI, PI);
}
D float2 tilt(HairState s, int p, float so, float co) {
  if (p == 0)
    return make_float2(so * s.ca.y - co * s.sa.y, fabsf(co * s.ca.y + so * s.sa.y));
  if (p == 1)
    return make_float2(so * s.ca.x + co * s.sa.x, fabsf(co * s.ca.x - so * s.sa.x));
  if (p == 2)
    return make_float2(so * s.ca.z + co * s.sa.z, fabsf(co * s.ca.z - so * s.sa.z));
  return make_float2(so, co);
}
D HairGeometry geometry(Hair p, float3 wo) {
  HairGeometry g{};
  g.so = wo.x;
  g.co = safeSqrt(1 - wo.x * wo.x);
  g.phi = atan2f(wo.z, wo.y);
  float st = g.so / p.eta, ct = safeSqrt(1 - st * st),
        etap = safeSqrt(p.eta * p.eta - g.so * g.so) / fmaxf(g.co, 1e-6f);
  float sg = p.h / etap, cg = safeSqrt(1 - sg * sg);
  g.gamma = asinf(clamp(sg, -1, 1));
  g.transmission = exp3(-p.absorption * (2 * cg / fmaxf(ct, 1e-6f)));
  return g;
}
D float3 matteNormal(float h) { return v3(0, h, safeSqrt(1 - h * h)); }
D float3 hairF(Hair p, HairState s, float3 wo, float3 wi) {
  auto g = geometry(p, wo);
  float si = wi.x, ci = safeSqrt(1 - si * si), phi = atan2f(wi.z, wi.y) - g.phi;
  float3 ap[4], sum = v3(0);
  attenuations(p, g.co, g.transmission, ap);
  for (int l = 0; l < 3; l++) {
    auto t = tilt(s, l, g.so, g.co);
    sum += mp(ci, t.y, si, t.x, s.v[l]) * np(phi, l, s.s, s.gamma, g.gamma) * ap[l];
  }
  sum += mp(ci, g.co, si, g.so, s.v[3]) / TWO_PI * ap[3];
  return p.matte <= 0
             ? sum
             : (1 - p.matte) * sum + p.matte * p.color * INV_PI * fmaxf(dot(matteNormal(p.h), wi), 0);
}
D void lobePdfs(Hair p, HairGeometry g, float *pdf) {
  float3 ap[4];
  attenuations(p, g.co, g.transmission, ap);
  float sum = 0;
  for (int i = 0; i < 4; i++) {
    pdf[i] = dot(ap[i], v3(1.f / 3));
    sum += pdf[i];
  }
  for (int i = 0; i < 4; i++)
    pdf[i] = sum > 0 ? pdf[i] / sum : float(i == 0);
}
D float hairPdf(Hair p, HairState s, float3 wo, float3 wi) {
  auto g = geometry(p, wo);
  float weights[4];
  lobePdfs(p, g, weights);
  float si = wi.x, ci = safeSqrt(1 - si * si), phi = atan2f(wi.z, wi.y) - g.phi, pdf = 0;
  for (int l = 0; l < 3; l++) {
    auto t = tilt(s, l, g.so, g.co);
    pdf += mp(ci, t.y, si, t.x, s.v[l]) * weights[l] * np(phi, l, s.s, s.gamma, g.gamma);
  }
  pdf += mp(ci, g.co, si, g.so, s.v[3]) * weights[3] / TWO_PI;
  return p.matte <= 0 ? pdf : (1 - p.matte) * pdf + p.matte * fmaxf(dot(matteNormal(p.h), wi), 0) * INV_PI;
}
D float3 hairSample(Hair p, HairState s, float3 wo, float3 u) {
  float u0 = u.x;
  if (p.matte > 0 && u0 < p.matte) {
    float um = u0 / p.matte, r = sqrtf(um), phi = TWO_PI * u.y;
    float3 n = matteNormal(p.h), b = v3(0, n.z, -n.y);
    return v3(1, 0, 0) * (r * cosf(phi)) + b * (r * sinf(phi)) + n * safeSqrt(1 - um);
  }
  if (p.matte > 0)
    u0 = (u0 - p.matte) / (1 - p.matte);
  auto g = geometry(p, wo);
  float pdfs[4];
  lobePdfs(p, g, pdfs);
  int l = 0;
  while (l < 3 && u0 >= pdfs[l]) {
    u0 -= pdfs[l];
    l++;
  }
  float remainder = clamp(u0 / fmaxf(pdfs[l], 1e-12f), 0, .99999994f);
  auto t = tilt(s, l, g.so, g.co);
  float um = fmaxf(u.z, 1e-5f), v = s.v[l], ct = 1 + v * logf(um + (1 - um) * expf(-2 / v));
  float si = -ct * t.x + safeSqrt(1 - ct * ct) * cosf(TWO_PI * remainder) * t.y, ci = safeSqrt(1 - si * si);
  float dp = l < 3 ? phiLobe(l, s.gamma, g.gamma) + sampleLogistic(u.y, s.s) : TWO_PI * u.y;
  float pi = g.phi + dp;
  return v3(si, ci * cosf(pi), ci * sinf(pi));
}
