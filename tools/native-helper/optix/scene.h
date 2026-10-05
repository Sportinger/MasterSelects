#pragma once
#include <cstdint>
#include <cuda_runtime.h>
#include <optix.h>

// Binary mirrors of the browser's path-tracing records; no browser or GPU handles on disk.
struct Fiber {
  float4 a, b;
  uint32_t material, attr0, attr1, melanin;
};
struct Material {
  float4 header, c0, c1, c2, c3;
};
struct Light {
  float4 positionKind, radiance, axisU, axisV;
};
struct Frame {
  float viewProjection[16], inverseViewProjection[16], previousViewProjection[16];
  float4 cameraPosition, cameraRight, cameraUp, cameraForward, lens, size, jitterTime;
  uint4 counters, limits, scene;
  float4 environment, region, previousCamera, sampling;
};
struct Instance {
  float4 transforms[6];
  uint4 refs, info;
};
struct LaunchParams {
  OptixTraversableHandle scene;
  const Fiber *fibers;
  const Material *materials;
  const Light *lights;
  float4 *pixels;
  Frame frame;
  uint32_t firstRow, sampleIndex, albedo;
};
static_assert(sizeof(Fiber) == 48 && sizeof(Material) == 80 && sizeof(Light) == 64);
static_assert(sizeof(Frame) == 416 && sizeof(Instance) == 128);

#ifdef __CUDACC__
#define D __device__ __forceinline__
constexpr float PI = 3.14159265358979f, TWO_PI = 6.28318530717959f, INV_PI = 0.318309886183791f,
                INF = 3.0e38f;
D float3 v3(float x) { return make_float3(x, x, x); }
D float3 v3(float x, float y, float z) { return make_float3(x, y, z); }
D float3 xyz(float4 v) { return v3(v.x, v.y, v.z); }
D float3 operator+(float3 a, float3 b) { return v3(a.x + b.x, a.y + b.y, a.z + b.z); }
D float3 operator-(float3 a, float3 b) { return v3(a.x - b.x, a.y - b.y, a.z - b.z); }
D float3 operator-(float3 a) { return v3(-a.x, -a.y, -a.z); }
D float3 operator*(float3 a, float3 b) { return v3(a.x * b.x, a.y * b.y, a.z * b.z); }
D float3 operator*(float3 a, float b) { return a * v3(b); }
D float3 operator*(float b, float3 a) { return a * b; }
D float3 operator/(float3 a, float3 b) { return v3(a.x / b.x, a.y / b.y, a.z / b.z); }
D float3 operator/(float3 a, float b) { return a / v3(b); }
D float3 operator-(float b, float3 a) { return v3(b) - a; }
D float3 &operator+=(float3 &a, float3 b) {
  a = a + b;
  return a;
}
D float3 &operator*=(float3 &a, float3 b) {
  a = a * b;
  return a;
}
D float dot(float3 a, float3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
D float3 cross(float3 a, float3 b) {
  return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}
D float clamp(float x, float a, float b) { return fminf(b, fmaxf(a, x)); }
D float length(float3 a) { return sqrtf(dot(a, a)); }
D float3 norm(float3 a) { return a * rsqrtf(dot(a, a)); }
D float3 safeNorm(float3 a, float3 fallback) { return dot(a, a) > 1e-20f ? norm(a) : fallback; }
D float3 max3(float3 a, float b) { return v3(fmaxf(a.x, b), fmaxf(a.y, b), fmaxf(a.z, b)); }
D float3 exp3(float3 a) { return v3(expf(a.x), expf(a.y), expf(a.z)); }
D float3 log3(float3 a) { return v3(logf(a.x), logf(a.y), logf(a.z)); }
D float mix(float a, float b, float t) { return a * (1 - t) + b * t; }
D float3 mix(float3 a, float3 b, float t) { return a * (1 - t) + b * t; }
D float luminance(float3 a) { return dot(a, v3(.2126f, .7152f, .0722f)); }
D float maxComponent(float3 a) { return fmaxf(a.x, fmaxf(a.y, a.z)); }
D float safeSqrt(float x) { return sqrtf(fmaxf(0, x)); }
struct Basis {
  float3 x, y, z;
};
D Basis basis(float3 n) {
  float sign = n.z >= 0 ? 1.f : -1.f, a = -1.f / (sign + n.z), b = n.x * n.y * a;
  return {v3(1 + sign * n.x * n.x * a, sign * b, -sign * n.x), v3(b, sign + n.y * n.y * a, -n.y), n};
}
D float3 world(Basis b, float3 v) { return b.x * v.x + b.y * v.y + b.z * v.z; }
D float3 local(Basis b, float3 v) { return v3(dot(v, b.x), dot(v, b.y), dot(v, b.z)); }
D float4 unpack(uint32_t x) {
  return make_float4((x & 255) / 255.f, ((x >> 8) & 255) / 255.f, ((x >> 16) & 255) / 255.f,
                     (x >> 24) / 255.f);
}
#endif
