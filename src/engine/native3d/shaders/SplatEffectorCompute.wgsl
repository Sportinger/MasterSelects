struct EffectorData {
  posRadius: vec4f,
  axisStrength: vec4f,
  paramsA: vec4f,
  paramsB: vec4f,
}

struct EffectorSettings {
  effectors: array<EffectorData, 8>,
  effectorCount: u32,
  splatCount: u32,
  _pad0: u32,
  _pad1: u32,
}

@group(0) @binding(0) var<storage, read> source: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(1) @binding(0) var<uniform> settings: EffectorSettings;

fn hash33(p: vec3f) -> vec3f {
  let q = vec3f(
    dot(p, vec3f(127.1, 311.7, 74.7)),
    dot(p, vec3f(269.5, 183.3, 246.1)),
    dot(p, vec3f(113.5, 271.9, 124.6))
  );
  return fract(sin(q) * 43758.5453123) * 2.0 - 1.0;
}

fn safeNormalize(value: vec3f, fallback: vec3f) -> vec3f {
  let len = length(value);
  if (len > 0.0001) {
    return value / len;
  }
  return fallback;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= settings.splatCount) {
    return;
  }

  let stride = 14u;
  let base = idx * stride;
  for (var i = 0u; i < stride; i = i + 1u) {
    output[base + i] = source[base + i];
  }

  if (settings.effectorCount == 0u) {
    return;
  }

  let px = source[base + 0u];
  let py = source[base + 1u];
  let pz = source[base + 2u];
  var displaced = vec3f(px, py, pz);

  for (var i = 0u; i < 8u; i = i + 1u) {
    if (i >= settings.effectorCount) {
      break;
    }

    let effector = settings.effectors[i];
    let effectorPos = effector.posRadius.xyz;
    let radius = max(effector.posRadius.w, 0.0001);
    let axis = safeNormalize(effector.axisStrength.xyz, vec3f(0.0, 0.0, 1.0));
    let strength = effector.axisStrength.w;
    let falloff = max(effector.paramsA.x, 0.001);
    let speed = effector.paramsA.y;
    let seed = effector.paramsA.z;
    let mode = effector.paramsA.w;
    let localTime = effector.paramsB.x;

    let fromEffector = displaced - effectorPos;
    let dist = length(fromEffector);
    if (dist > radius) {
      continue;
    }

    let normDist = clamp(dist / radius, 0.0, 1.0);
    let weight = pow(1.0 - normDist, falloff);
    let radialDir = select(axis, fromEffector / max(dist, 0.0001), dist > 0.0001);
    var delta = vec3f(0.0);

    if (mode < 0.5) {
      delta = radialDir * strength * weight;
    } else if (mode < 1.5) {
      delta = -radialDir * strength * weight;
    } else if (mode < 2.5) {
      let tangent = safeNormalize(cross(axis, radialDir), vec3f(1.0, 0.0, 0.0));
      let pulse = 0.6 + 0.4 * sin(localTime * speed + dist * 6.0 + seed);
      delta = tangent * strength * weight * pulse;
    } else {
      let noiseVector = safeNormalize(
        hash33(displaced * (3.0 + falloff) + vec3f(seed + localTime * speed)),
        axis,
      );
      let pulse = 0.5 + 0.5 * sin(localTime * speed + seed + dist * 5.0);
      delta = noiseVector * strength * weight * pulse;
    }

    displaced = displaced + delta;
  }

  output[base + 0u] = displaced.x;
  output[base + 1u] = displaced.y;
  output[base + 2u] = displaced.z;
}
