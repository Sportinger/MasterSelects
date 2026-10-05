#include "hair.cuh"
#include "lights.cuh"
#include "sampler.cuh"
extern "C" {
__constant__ LaunchParams params;
}

extern "C" __global__ void __intersection__fiber() {
  Fiber f = params.fibers[optixGetPrimitiveIndex()];
  float3 direction = optixGetObjectRayDirection();
  float magnitude = fmaxf(length(direction), 1e-20f);
  float t = roundCone(optixGetObjectRayOrigin(), direction / magnitude, f) / magnitude;
  if (t > optixGetRayTmin() && t < optixGetRayTmax())
    optixReportIntersection(t, 0);
}
extern "C" __global__ void __closesthit__fiber() {
  optixSetPayload_0(optixGetPrimitiveIndex());
  optixSetPayload_1(__float_as_uint(optixGetRayTmax()));
}
extern "C" __global__ void __miss__path() {}

struct Surface {
  float3 p, n;
  Basis frame;
  Hair hair;
};
D Surface surfaceAt(Hit hit, Ray ray) {
  Surface s{};
  s.p = ray.origin + ray.direction * hit.t;
  Fiber f = params.fibers[hit.primitive];
  Material m = params.materials[f.material & 0xffffu];
  float3 axis = xyz(f.b) - xyz(f.a), x = safeNorm(axis, v3(1, 0, 0));
  float along = clamp(dot(s.p - xyz(f.a), axis) / fmaxf(dot(axis, axis), 1e-20f), 0, 1);
  float3 outward = s.p - (xyz(f.a) + axis * along);
  s.n = safeNorm(outward - x * dot(outward, x), -ray.direction);
  float3 z = -ray.direction - x * dot(-ray.direction, x);
  z = dot(z, z) < 1e-12f ? basis(x).x : norm(z);
  s.frame = {x, cross(z, x), z};
  float4 a = unpack(f.attr0), b = unpack(f.attr1);
  uint32_t flags = uint32_t(m.header.y + .5f);
  float rough = mix(a.w, b.w, along) * 2, fuzz = (f.material & (1u << 16)) ? m.c3.z : 0;
  Hair &p = s.hair;
  p.h = clamp(dot(s.n, cross(z, x)), -.999f, .999f);
  p.eta = fmaxf(m.c1.z, 1.01f);
  p.bm = clamp(mix(m.c0.w * rough, 1, fuzz), .02f, 1);
  p.bn = clamp(mix(m.c1.x * rough, 1, fuzz), .02f, 1);
  p.alpha = m.c1.y;
  p.matte = clamp(m.c3.y, 0, 1);
  p.coat = xyz(m.c2);
  p.color = ((flags & 1) ? v3(1) : xyz(m.c0)) * mix(xyz(a), xyz(b), along);
  float melanin =
      (flags & 2) ? mix((f.melanin & 65535) / 65535.f, (f.melanin >> 16) / 65535.f, along) * 8 : m.c2.w;
  p.absorption = m.c1.w > .5f
                     ? melanin * ((1 - m.c3.x) * v3(.419f, .697f, 1.37f) + m.c3.x * v3(.187f, .4f, 1.05f))
                     : absorptionFromColor(p.color, p.bn);
  return s;
}
D float3 indirect(float3 v) {
  float l = luminance(v), limit = params.frame.environment.w;
  return limit > 0 && l > limit ? v * (limit / fmaxf(l, 1e-12f)) : v;
}
extern "C" __global__ void __raygen__path() {
  uint3 launch = optixGetLaunchIndex();
  uint32_t x = launch.x, y = launch.y + params.firstRow;
  Sampler sampler(x, y, params.frame.scene.w, params.sampleIndex);
  Ray ray = cameraRay(params.frame, x, y, sampler.next());
  float3 throughput = v3(1), radiance = v3(0);
  float coverage = 0, bsdfPdf = 0;
  bool specular = true;
  uint32_t bounces = max(params.frame.limits.x, 1u), count = params.frame.limits.y;
  for (uint32_t bounce = 0; bounce <= bounces; bounce++) {
    float4 u = sampler.next();
    Hit hit = trace(params.scene, ray);
    if (bounce) {
      auto light = lightHit(params.lights, count, ray, hit.t);
      if (light.pdf > 0) {
        radiance += indirect(throughput * light.radiance * (specular ? 1 : power(bsdfPdf, light.pdf)));
        if (light.t < hit.t)
          break;
      }
    }
    if (hit.primitive == 0xffffffffu) {
      if (bounce) {
        auto env = environmentHit(params.lights, count);
        if (env.pdf > 0)
          radiance += indirect(throughput * env.radiance * (specular ? 1 : power(bsdfPdf, env.pdf)));
      }
      break;
    }
    Surface s = surfaceAt(hit, ray);
    HairState hs = hairState(s.hair);
    float3 wo = local(s.frame, -ray.direction);
    if (!bounce) {
      coverage = 1;
      if (params.albedo) {
        radiance = s.hair.color;
        break;
      }
    }
    if (bounce == bounces)
      break;
    LightSample light = sampleLight(params.lights, count, s.p, xyz(u));
    if (light.pdf > 0) {
      float3 wi = local(s.frame, light.wi), f = hairF(s.hair, hs, wo, wi);
      if (maxComponent(f) > 0 && trace(params.scene, {offset(s.p, s.n, light.wi), light.wi},
                                       light.distance >= INF ? INF : light.distance * .999f, true)
                                         .primitive == 0xffffffffu) {
        float weight = light.delta ? 1 : power(light.pdf, hairPdf(s.hair, hs, wo, wi));
        float3 contribution = throughput * f * light.radiance * (weight / light.pdf);
        radiance += bounce ? indirect(contribution) : contribution;
      }
    }
    float4 v = sampler.next();
    float3 wi = hairSample(s.hair, hs, wo, xyz(v));
    float pdf = hairPdf(s.hair, hs, wo, wi);
    float3 value = hairF(s.hair, hs, wo, wi);
    if (pdf <= 1e-6f || maxComponent(value) <= 0)
      break;
    throughput *= value / pdf;
    bsdfPdf = pdf;
    specular = false;
    if (bounce >= 3) {
      float survive = fminf(maxComponent(throughput), .95f);
      if (v.w >= survive)
        break;
      throughput = throughput / survive;
    }
    float3 direction = norm(world(s.frame, wi));
    ray = {offset(s.p, s.n, direction), direction};
  }
  if (!(fabsf(radiance.x) < 1e20f && fabsf(radiance.y) < 1e20f && fabsf(radiance.z) < 1e20f))
    radiance = v3(0);
  radiance = max3(radiance, 0);
  uint32_t pixel = y * uint32_t(params.frame.size.x) + x;
  float4 old = params.pixels[pixel];
  params.pixels[pixel] =
      make_float4(old.x + radiance.x, old.y + radiance.y, old.z + radiance.z, old.w + coverage);
}
