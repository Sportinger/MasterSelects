// Light sampling (fixed interface pt_sample_light) and light evaluation for MIS. Lights are virtual:
// they are not in the BVH, so BSDF-sampled rays test them with ptLightHit. Packing (ptLights.ts):
// - sphere: positionKind (center, 1), radiance (L, radius)
// - rect: positionKind (center, 2), radiance (L, area), axisU/axisV half extents; emits toward -cross(U, V)
// - environment: positionKind (0, 3), radiance (scale, 1 when a map is bound); map is equirectangular,
//   u = atan2(z, x) / 2π, v = acos(y) / π; the alias texture holds (threshold, alias, texel pmf)
// - distant: positionKind (direction toward the light, 4), radiance (irradiance, cone cosine)
// axisU.w: casts shadows; axisV.w: inclusive selection CDF (proportional to estimated power).
// Requires PtCommon.wgsl and PtSceneBindings.wgsl.

fn ptLightCount() -> u32 {
  return min(frame.limits.y, PT_MAX_LIGHTS);
}

fn ptLightPmf(index: u32) -> f32 {
  let cdf = lights[index].axisV.w;
  let previous = select(0.0, lights[index - 1u].axisV.w, index > 0u);
  return max(cdf - previous, 0.0);
}

fn ptPickLight(u: f32) -> u32 {
  let count = ptLightCount();
  for (var i = 0u; i < count; i++) {
    if (u < lights[i].axisV.w) {
      return i;
    }
  }
  return max(count, 1u) - 1u;
}

fn ptEnvDirection(uv: vec2f) -> vec3f {
  let phi = PT_TWO_PI * uv.x;
  let theta = PT_PI * uv.y;
  let s = sin(theta);
  return vec3f(s * cos(phi), cos(theta), s * sin(phi));
}

fn ptEnvUv(direction: vec3f) -> vec2f {
  return vec2f(fract(atan2(direction.z, direction.x) / PT_TWO_PI + 1.0), acos(clamp(direction.y, -1.0, 1.0)) / PT_PI);
}

/** Environment radiance toward `direction` (light `index` is the environment light). */
fn ptEnvRadiance(index: u32, direction: vec3f) -> vec3f {
  let light = lights[index];
  if (light.radiance.w < 0.5) {
    return light.radiance.rgb;
  }
  let size = vec2f(textureDimensions(environmentMap));
  let texel = min(vec2u(ptEnvUv(direction) * size), vec2u(size) - 1u);
  return light.radiance.rgb * textureLoad(environmentMap, texel, 0).rgb;
}

/** Solid angle pdf of sampling `direction` from the environment light (without the selection pmf). */
fn ptEnvPdf(index: u32, direction: vec3f) -> f32 {
  if (lights[index].radiance.w < 0.5) {
    return 1.0 / (4.0 * PT_PI);
  }
  let size = textureDimensions(environmentAlias);
  let uv = ptEnvUv(direction);
  let texel = min(vec2u(uv * vec2f(size)), size - 1u);
  let pmf = textureLoad(environmentAlias, texel, 0).b;
  let sinTheta = max(sin(PT_PI * uv.y), 1e-6);
  return pmf * f32(size.x * size.y) / (2.0 * PT_PI * PT_PI * sinTheta);
}

fn ptSampleEnvironment(index: u32, u: vec2f) -> vec3f {
  if (lights[index].radiance.w < 0.5) {
    let z = 1.0 - 2.0 * u.x;
    let r = sqrt(max(0.0, 1.0 - z * z));
    let phi = PT_TWO_PI * u.y;
    return vec3f(r * cos(phi), z, r * sin(phi));
  }
  let size = textureDimensions(environmentAlias);
  let count = size.x * size.y;
  let scaled = u.x * f32(count);
  let slot = min(u32(scaled), count - 1u);
  let fraction = scaled - f32(slot);
  let entry = textureLoad(environmentAlias, vec2u(slot % size.x, slot / size.x), 0);
  let texel = select(u32(entry.g), slot, fraction < entry.r);
  let jitter = vec2f(u.y, fract(fraction * 7.37 + u.y * 3.11));
  return ptEnvDirection((vec2f(f32(texel % size.x), f32(texel / size.x)) + jitter) / vec2f(size));
}

/** Uniform cone toward a sphere light; returns direction and fills distance / pdf. */
fn ptSampleSphereLight(light: PtLight, p: vec3f, u: vec2f, sample: ptr<function, PtLightSample>) {
  let center = light.positionKind.xyz;
  let radius = light.radiance.w;
  let toCenter = center - p;
  let d2 = dot(toCenter, toCenter);
  if (d2 <= radius * radius) {
    (*sample).pdf = 0.0;
    return;
  }
  let distance = sqrt(d2);
  let w = toCenter / distance;
  let sinMax2 = radius * radius / d2;
  let cosMax = sqrt(max(0.0, 1.0 - sinMax2));
  let cosTheta = 1.0 - u.x * (1.0 - cosMax);
  let sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));
  let phi = PT_TWO_PI * u.y;
  let basis = ptBasis(w);
  let wi = normalize(basis * vec3f(sinTheta * cos(phi), sinTheta * sin(phi), cosTheta));
  // Distance to the sphere surface along wi.
  let b = dot(wi, toCenter);
  let t = b - sqrt(max(0.0, b * b - (d2 - radius * radius)));
  (*sample).wi = wi;
  (*sample).distance = t;
  (*sample).radiance = light.radiance.rgb;
  (*sample).pdf = 1.0 / (PT_TWO_PI * max(1.0 - cosMax, 1e-7));
}

fn ptSampleRectLight(light: PtLight, p: vec3f, u: vec2f, sample: ptr<function, PtLightSample>) {
  let point = light.positionKind.xyz + (2.0 * u.x - 1.0) * light.axisU.xyz + (2.0 * u.y - 1.0) * light.axisV.xyz;
  let normal = -normalize(cross(light.axisU.xyz, light.axisV.xyz));
  let toLight = point - p;
  let d2 = max(dot(toLight, toLight), 1e-12);
  let distance = sqrt(d2);
  let wi = toLight / distance;
  let cosLight = dot(-wi, normal);
  if (cosLight <= 0.0) {
    (*sample).pdf = 0.0;
    return;
  }
  (*sample).wi = wi;
  (*sample).distance = distance;
  (*sample).radiance = light.radiance.rgb;
  (*sample).pdf = d2 / (max(light.radiance.w, 1e-12) * cosLight);
}

/** Samples a light for shading point p (normal n is unused by these lights; reserved for many-light trees). */
fn pt_sample_light(p: vec3f, n: vec3f, u: vec3f) -> PtLightSample {
  var sample: PtLightSample;
  sample.pdf = 0.0;
  sample.isDelta = 0u;
  let count = ptLightCount();
  if (count == 0u) {
    return sample;
  }
  let index = ptPickLight(u.x);
  let pmf = ptLightPmf(index);
  if (pmf <= 0.0) {
    return sample;
  }
  let light = lights[index];
  let kind = u32(light.positionKind.w + 0.5);
  sample.lightIndex = index;
  if (kind == PT_LIGHT_SPHERE) {
    ptSampleSphereLight(light, p, u.yz, &sample);
  } else if (kind == PT_LIGHT_RECT) {
    ptSampleRectLight(light, p, u.yz, &sample);
  } else if (kind == PT_LIGHT_ENVIRONMENT) {
    sample.wi = ptSampleEnvironment(index, u.yz);
    sample.distance = PT_INFINITY;
    sample.radiance = ptEnvRadiance(index, sample.wi);
    sample.pdf = ptEnvPdf(index, sample.wi);
  } else {
    sample.wi = normalize(light.positionKind.xyz);
    sample.distance = PT_INFINITY;
    sample.radiance = light.radiance.rgb;
    sample.pdf = 1.0;
    sample.isDelta = 1u;
  }
  sample.pdf *= pmf;
  return sample;
}

/** Radiance and selection-weighted solid angle pdf of the nearest sphere or rect light along a ray within tMax. */
struct PtLightHit {
  radiance: vec3f,
  pdf: f32,
  t: f32,
};

fn ptLightHit(origin: vec3f, direction: vec3f, tMax: f32) -> PtLightHit {
  var best: PtLightHit;
  best.t = tMax;
  best.pdf = 0.0;
  best.radiance = vec3f(0.0);
  let count = ptLightCount();
  for (var i = 0u; i < count; i++) {
    let light = lights[i];
    let kind = u32(light.positionKind.w + 0.5);
    if (kind == PT_LIGHT_SPHERE) {
      let t = ptIntersectSphere(origin, direction, light.positionKind.xyz, light.radiance.w, 1e-5);
      if (t < best.t) {
        let toCenter = light.positionKind.xyz - origin;
        let d2 = dot(toCenter, toCenter);
        let cosMax = sqrt(max(0.0, 1.0 - light.radiance.w * light.radiance.w / max(d2, 1e-12)));
        best.t = t;
        best.radiance = light.radiance.rgb;
        best.pdf = ptLightPmf(i) / (PT_TWO_PI * max(1.0 - cosMax, 1e-7));
      }
    } else if (kind == PT_LIGHT_RECT) {
      let corner = light.positionKind.xyz - light.axisU.xyz - light.axisV.xyz;
      let hit = ptIntersectQuad(origin, direction, corner, 2.0 * light.axisU.xyz, 2.0 * light.axisV.xyz);
      let normal = -normalize(cross(light.axisU.xyz, light.axisV.xyz));
      let cosLight = dot(-direction, normal);
      if (hit.x > 1e-5 && hit.x < best.t && cosLight > 0.0) {
        best.t = hit.x;
        best.radiance = light.radiance.rgb;
        best.pdf = ptLightPmf(i) * hit.x * hit.x / (max(light.radiance.w, 1e-12) * cosLight);
      }
    }
  }
  return best;
}

/** Radiance from environment lights toward `direction` and their combined selection-weighted pdf. */
fn ptEnvironmentHit(direction: vec3f) -> PtLightHit {
  var result: PtLightHit;
  result.radiance = vec3f(0.0);
  result.pdf = 0.0;
  result.t = PT_INFINITY;
  let count = ptLightCount();
  for (var i = 0u; i < count; i++) {
    if (u32(lights[i].positionKind.w + 0.5) == PT_LIGHT_ENVIRONMENT) {
      result.radiance += ptEnvRadiance(i, direction);
      result.pdf += ptLightPmf(i) * ptEnvPdf(i, direction);
    }
  }
  return result;
}

fn ptPowerHeuristic(a: f32, b: f32) -> f32 {
  let a2 = a * a;
  return a2 / max(a2 + b * b, 1e-30);
}
