// Particle effect compute shader — applies deterministic offsets to splat data.
// Source buffer is read-only; offsets are written to the output buffer.
// All effects are purely deterministic: hash(splatIndex + seed) + clipLocalTime.
// No accumulated state — scrub to frame N == play-through to frame N.

struct ParticleSettings {
  time: f32,
  intensity: f32,
  speed: f32,
  seed: f32,
  effect_type: u32,  // 0=none, 1=explode, 2=drift, 3=swirl, 4=dissolve
  splat_count: u32,
  _pad0: u32,
  _pad1: u32,
}

@group(0) @binding(0) var<storage, read> source: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(1) @binding(0) var<uniform> settings: ParticleSettings;

// Deterministic integer hash (Muller hash)
fn hash_u32(n: u32) -> f32 {
  var x = n;
  x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  x = (x >> 16u) ^ x;
  return f32(x) / 4294967295.0;
}

// 2D hash for more variation
fn hash2(a: u32, b: u32) -> f32 {
  return hash_u32(a * 2654435761u + b);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= settings.splat_count) {
    return;
  }

  let stride = 14u;
  let base = idx * stride;

  // Copy all 14 floats from source to output first
  for (var i = 0u; i < stride; i = i + 1u) {
    output[base + i] = source[base + i];
  }

  // Early exit for no-effect
  if (settings.effect_type == 0u) {
    return;
  }

  // Read position
  let px = source[base + 0u];
  let py = source[base + 1u];
  let pz = source[base + 2u];
  let opacity = source[base + 13u];

  let t = settings.time * settings.speed;
  let seedU = u32(settings.seed);
  let h = hash_u32(idx + seedU);
  let h2 = hash2(idx, seedU);
  let h3 = hash2(idx + 1u, seedU);

  switch settings.effect_type {
    // Explode: splats fly outward from center
    case 1u: {
      let dir = vec3f(px, py, pz) + vec3f(0.001, 0.001, 0.001);
      let dirNorm = normalize(dir);
      let progress = smoothstep(0.0, 1.0, t * (0.5 + h));
      let offset = dirNorm * settings.intensity * progress;
      output[base + 0u] = px + offset.x;
      output[base + 1u] = py + offset.y;
      output[base + 2u] = pz + offset.z;
      // Fade opacity as splats explode
      output[base + 13u] = opacity * (1.0 - progress * 0.5);
    }

    // Drift: gentle organic floating motion
    case 2u: {
      let offset = vec3f(
        sin(h * 6.283185 + t) * settings.intensity * 0.5,
        cos(h2 * 3.141593 + t * 0.7) * settings.intensity * 0.3,
        sin(h3 * 4.712389 + t * 1.3) * settings.intensity * 0.4,
      );
      output[base + 0u] = px + offset.x;
      output[base + 1u] = py + offset.y;
      output[base + 2u] = pz + offset.z;
    }

    // Swirl: rotation around Y axis with per-splat variation
    case 3u: {
      let angle = t * settings.intensity * (0.5 + h);
      let ca = cos(angle);
      let sa = sin(angle);
      // Rotate in XZ plane
      output[base + 0u] = px * ca - pz * sa;
      output[base + 2u] = px * sa + pz * ca;
      // Slight vertical drift for visual interest
      output[base + 1u] = py + sin(t * 0.5 + h * 6.283185) * settings.intensity * 0.1;
    }

    // Dissolve: per-splat opacity fade based on hash threshold
    case 4u: {
      let threshold = t * settings.speed;
      let fade = 1.0 - smoothstep(threshold - 0.2, threshold + 0.2, h);
      output[base + 13u] = opacity * fade;
    }

    default: {}
  }
}
