#pragma once
#include "geometry.cuh"
struct LightSample {
  float3 wi, radiance;
  float distance, pdf;
  bool delta;
};
D float pmf(const Light *lights, uint32_t i) {
  return fmaxf(lights[i].axisV.w - (i ? lights[i - 1].axisV.w : 0), 0);
}
D float power(float a, float b) { return a * a / fmaxf(a * a + b * b, 1e-30f); }
D LightSample sampleLight(const Light *lights, uint32_t count, float3 p, float3 u) {
  LightSample s{};
  s.distance = INF;
  if (!count)
    return s;
  uint32_t i = 0;
  while (i + 1 < count && u.x >= lights[i].axisV.w)
    i++;
  Light l = lights[i];
  float probability = pmf(lights, i);
  if (probability <= 0)
    return s;
  int kind = int(l.positionKind.w + .5f);
  s.radiance = xyz(l.radiance);
  if (kind == 1) {
    float3 to = xyz(l.positionKind) - p;
    float d2 = dot(to, to), r = l.radiance.w;
    if (d2 <= r * r)
      return s;
    float3 w = to / sqrtf(d2);
    float cm = safeSqrt(1 - r * r / d2), ct = 1 - u.y * (1 - cm), st = safeSqrt(1 - ct * ct),
          phi = TWO_PI * u.z;
    s.wi = norm(world(basis(w), v3(st * cosf(phi), st * sinf(phi), ct)));
    float b = dot(s.wi, to);
    s.distance = b - safeSqrt(b * b - (d2 - r * r));
    s.pdf = 1 / (TWO_PI * fmaxf(1 - cm, 1e-7f));
  } else if (kind == 2) {
    float3 point = xyz(l.positionKind) + (2 * u.y - 1) * xyz(l.axisU) + (2 * u.z - 1) * xyz(l.axisV),
           to = point - p;
    float d2 = fmaxf(dot(to, to), 1e-12f);
    s.distance = sqrtf(d2);
    s.wi = to / s.distance;
    float cosine = dot(-s.wi, -norm(cross(xyz(l.axisU), xyz(l.axisV))));
    if (cosine <= 0)
      return s;
    s.pdf = d2 / (fmaxf(l.radiance.w, 1e-12f) * cosine);
  } else if (kind == 3) {
    float y = 1 - 2 * u.y, r = safeSqrt(1 - y * y), phi = TWO_PI * u.z;
    s.wi = v3(r * cosf(phi), y, r * sinf(phi));
    s.pdf = 1 / (4 * PI);
  } else {
    s.wi = norm(xyz(l.positionKind));
    s.pdf = 1;
    s.delta = true;
  }
  s.pdf *= probability;
  return s;
}
struct LightHit {
  float3 radiance;
  float pdf, t;
};
D LightHit lightHit(const Light *lights, uint32_t count, Ray r, float maximum) {
  LightHit best{v3(0), 0, maximum};
  for (uint32_t i = 0; i < count; i++) {
    Light l = lights[i];
    int kind = int(l.positionKind.w + .5f);
    if (kind == 1) {
      float t = sphereHit(r, xyz(l.positionKind), l.radiance.w);
      if (t < best.t) {
        float3 to = xyz(l.positionKind) - r.origin;
        float cm = safeSqrt(1 - l.radiance.w * l.radiance.w / fmaxf(dot(to, to), 1e-12f));
        best = {xyz(l.radiance), pmf(lights, i) / (TWO_PI * fmaxf(1 - cm, 1e-7f)), t};
      }
    } else if (kind == 2) {
      float t = quadHit(r, l), c = dot(-r.direction, -norm(cross(xyz(l.axisU), xyz(l.axisV))));
      if (t > 1e-5f && t < best.t && c > 0)
        best = {xyz(l.radiance), pmf(lights, i) * t * t / (fmaxf(l.radiance.w, 1e-12f) * c), t};
    }
  }
  return best;
}
D LightHit environmentHit(const Light *lights, uint32_t count) {
  LightHit h{v3(0), 0, INF};
  for (uint32_t i = 0; i < count; i++)
    if (int(lights[i].positionKind.w + .5f) == 3) {
      h.radiance += xyz(lights[i].radiance);
      h.pdf += pmf(lights, i) / (4 * PI);
    }
  return h;
}
