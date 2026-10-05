#pragma once
#include "scene.h"
#include <optix_device.h>

// Exact round-cone primitive used by PtTraverse.wgsl. OptiX supplies the RTX BVH traversal.
D float roundCone(float3 ro, float3 rd, Fiber f) {
  float3 ba = xyz(f.b) - xyz(f.a), relative = ro - xyz(f.a);
  // Move the ray origin near the segment before forming the quadratic. Otherwise
  // distant, subpixel fibers lose their radius in the subtraction of large squares.
  float shift = -dot(rd, relative);
  float3 oa = relative + rd * shift, ob = oa - ba;
  float ra = f.a.w, rb = f.b.w, rr = ra - rb, m0 = dot(ba, ba), m1 = dot(ba, oa), m2 = dot(ba, rd);
  float m3 = dot(rd, oa), m5 = dot(oa, oa), m6 = dot(ob, rd), m7 = dot(ob, ob), d2 = m0 - rr * rr;
  float k2 = d2 - m2 * m2, k1 = d2 * m3 - m1 * m2 + m2 * rr * ra,
        k0 = d2 * m5 - m1 * m1 + m1 * rr * ra * 2 - m0 * ra * ra;
  float h = k1 * k1 - k0 * k2;
  if (h < 0)
    return -1;
  if (fabsf(k2) > 1e-20f) {
    float t = (-sqrtf(h) - k1) / k2, y = m1 - ra * rr + t * m2;
    if (y > 0 && y < d2)
      return t + shift;
  }
  float h1 = m3 * m3 - m5 + ra * ra, h2 = m6 * m6 - m7 + rb * rb;
  if (fmaxf(h1, h2) < 0)
    return -1;
  float t = INF;
  if (h1 > 0)
    t = -m3 - sqrtf(h1);
  if (h2 > 0)
    t = fminf(t, -m6 - sqrtf(h2));
  return t + shift;
}
struct Ray {
  float3 origin, direction;
};
struct Hit {
  uint32_t primitive;
  float t;
};
D Hit trace(OptixTraversableHandle scene, Ray ray, float distance = INF, bool shadow = false) {
  uint32_t id = 0xffffffffu, t = __float_as_uint(INF);
  optixTrace(scene, ray.origin, ray.direction, 1e-4f, distance, 0, 255,
             shadow ? OPTIX_RAY_FLAG_TERMINATE_ON_FIRST_HIT : OPTIX_RAY_FLAG_NONE, 0, 1, 0, id, t);
  return {id, __uint_as_float(t)};
}
D Ray cameraRay(Frame f, uint32_t x, uint32_t y, float4 u) {
  float nx = (x + u.x) / f.size.x * 2 - 1, ny = 1 - (y + u.y) / f.size.y * 2;
  float3 right = xyz(f.cameraRight), up = xyz(f.cameraUp), forward = xyz(f.cameraForward);
  Ray r{xyz(f.cameraPosition), forward};
  if (f.cameraPosition.w > .5f) {
    r.origin += right * nx * f.cameraRight.w + up * ny * f.cameraUp.w;
    return r;
  }
  r.direction = norm(forward + right * nx * f.cameraRight.w + up * ny * f.cameraUp.w);
  if (f.lens.x > 0) {
    float3 focus = r.origin + r.direction * (f.lens.y / fmaxf(dot(r.direction, forward), 1e-4f));
    float radius = f.lens.x * sqrtf(u.z), phi = TWO_PI * u.w;
    r.origin += right * (radius * cosf(phi)) + up * (radius * sinf(phi));
    r.direction = norm(focus - r.origin);
  }
  return r;
}
D float3 offset(float3 position, float3 normal, float3 direction) {
  return position +
         normal * ((dot(normal, direction) >= 0 ? 1.f : -1.f) * 1e-4f * fmaxf(1, length(position)));
}
D float sphereHit(Ray r, float3 center, float radius) {
  float3 oc = r.origin - center;
  float a = dot(r.direction, r.direction), b = dot(oc, r.direction), c = dot(oc, oc) - radius * radius,
        h = b * b - a * c;
  if (h < 0)
    return INF;
  float t0 = (-b - sqrtf(h)) / a, t1 = (-b + sqrtf(h)) / a;
  return t0 > 1e-5f ? t0 : t1 > 1e-5f ? t1 : INF;
}
D float quadHit(Ray r, Light l) {
  float3 u = xyz(l.axisU) * 2, v = xyz(l.axisV) * 2, n = cross(u, v),
         o = xyz(l.positionKind) - xyz(l.axisU) - xyz(l.axisV);
  float d = dot(n, r.direction);
  if (fabsf(d) < 1e-14f)
    return INF;
  float t = dot(n, o - r.origin) / d;
  float3 p = r.origin + r.direction * t - o;
  float uu = dot(u, u), uv = dot(u, v), vv = dot(v, v), pu = dot(p, u), pv = dot(p, v),
        det = uu * vv - uv * uv;
  float s = (pu * vv - pv * uv) / det, w = (pv * uu - pu * uv) / det;
  return s < 0 || s > 1 || w < 0 || w > 1 ? INF : t;
}
