struct Settings { world: mat4x4f, camera: vec4f, time: f32, count: u32, operations: u32, sourceCount: u32, sampling: vec4u }
struct Operation { header: vec4f, a: vec4f, b: vec4f }
@group(0) @binding(0) var<storage, read> source: array<f32>;
@group(0) @binding(1) var<storage, read_write> outputData: array<f32>;
@group(0) @binding(2) var<uniform> settings: Settings;
@group(0) @binding(3) var<storage, read> operations: array<Operation>;
@group(0) @binding(4) var<storage, read> sourceIndices: array<u32>;
fn hash(n: u32) -> f32 {
  var x = n; x = ((x >> 16u) ^ x) * 0x45d9f3bu; x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  return f32((x >> 16u) ^ x) / 4294967295.0;
}
fn noise(p: vec3f, t: f32, seed: f32) -> vec3f {
  let q = p + vec3f(seed * 0.013, seed * 0.027, seed * 0.031);
  return vec3f(sin(q.y + t) * cos(q.z - t * 0.7), sin(q.z + t * 0.8) * cos(q.x - t), sin(q.x + t * 0.6) * cos(q.y + t * 0.9));
}
fn mulq(a: vec4f, b: vec4f) -> vec4f {
  return vec4f(a.x * b.x - dot(a.yzw, b.yzw), a.x * b.yzw + b.x * a.yzw + cross(a.yzw, b.yzw));
}
fn rotate(q: vec4f, degrees: vec3f) -> vec4f {
  let a = degrees * 0.00872664626; let c = cos(a); let s = sin(a);
  return normalize(mulq(mulq(mulq(vec4f(c.z, 0, 0, s.z), vec4f(c.y, 0, s.y, 0)), vec4f(c.x, s.x, 0, 0)), q));
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let outputId = gid.x; if (outputId >= settings.count) { return; }
  var id = outputId;
  if (settings.sampling.x == 2u) { id = sourceIndices[outputId]; }
  else if (settings.sampling.x == 1u) { id = (u32(floor(f32(outputId) * f32(settings.sourceCount) / f32(settings.count))) + settings.sampling.y) % settings.sourceCount; }
  let base = id * 14u; let outBase = outputId * 14u;
  var p = vec3f(source[base], source[base+1u], source[base+2u]);
  var scale = vec3f(source[base+3u], source[base+4u], source[base+5u]);
  var q = vec4f(source[base+6u], source[base+7u], source[base+8u], source[base+9u]);
  var color = vec3f(source[base+10u], source[base+11u], source[base+12u]);
  var alpha = source[base+13u];
  for (var i = 0u; i < settings.operations; i++) {
    let op = operations[i]; let kind = u32(op.header.x); let a = op.a; let b = op.b;
    switch kind {
      case 1u: { scale = clamp(scale, vec3f(a.x), vec3f(a.y)); }
      case 2u: { scale *= a.xyz; }
      case 3u: { q = rotate(q, a.xyz); }
      case 4u: { color *= a.xyz; alpha *= a.w; }
      case 5u: { if (hash(id ^ u32(a.y)) >= a.x) { alpha = 0; } }
      case 6u: {
        let n = noise(p * b.x, settings.time * b.y, b.z) * a.yzw;
        switch u32(a.x) {
          case 0u: { p += n; }
          case 1u: { scale *= exp(clamp(n, vec3f(-8), vec3f(8))); }
          default: { q = rotate(q, n); }
        }
      }
      case 7u: {
        if (alpha > 0.00001) {
          let seed = u32(b.z); let h = hash(id ^ seed);
          let life = max(0.1, a.x * (1.0 + (h * 2.0 - 1.0) * a.y));
          let time = max(0.0, settings.time); let phased = time + h * life;
          let cycle = u32(floor(phased / life)); let age = phased - f32(cycle) * life;
          let salt = id ^ seed ^ (cycle * 2654435761u);
          var velocity = normalize(vec3f(hash(salt + 1u), hash(salt + 2u), hash(salt + 3u)) - vec3f(0.4999)) * a.z;
          // Re-integrate only the current lifetime. Fixed 1/30 s steps plus a final fraction.
          let steps = min(570u, u32(ceil(age * 30.0)));
          for (var step = 0u; step < steps; step++) {
            let elapsed = f32(step) / 30.0; let dt = min(1.0 / 30.0, max(0.0, age - elapsed));
            let force = noise(p * b.x, time - age + elapsed, f32(seed)) * a.w + vec3f(0, b.w, 0);
            velocity = (velocity + force * dt) * exp(-b.y * dt); p += velocity * dt;
          }
          alpha *= smoothstep(0.0, 0.08, age / life) * (1.0 - smoothstep(0.7, 1.0, age / life));
        }
      }
      case 8u: {
        let world = (settings.world * vec4f(p, 1)).xyz;
        let fade = smoothstep(a.x, a.x + a.y, distance(world, settings.camera.xyz));
        alpha *= fade; scale *= max(0.001, fade);
      }
      case 9u: {
        let d = distance(p, a.xyz);
        let edge = min(b.x, a.w);
        if (edge > 0.0) {
          alpha *= 1.0 - smoothstep(a.w - edge, a.w, d);
        } else if (d > a.w) { alpha = 0.0; }
      }
      default: {}
    }
  }
  scale = clamp(scale, vec3f(0.000001), vec3f(100));
  outputData[outBase] = p.x; outputData[outBase+1u] = p.y; outputData[outBase+2u] = p.z;
  outputData[outBase+3u] = scale.x; outputData[outBase+4u] = scale.y; outputData[outBase+5u] = scale.z;
  outputData[outBase+6u] = q.x; outputData[outBase+7u] = q.y; outputData[outBase+8u] = q.z; outputData[outBase+9u] = q.w;
  outputData[outBase+10u] = color.x; outputData[outBase+11u] = color.y; outputData[outBase+12u] = color.z; outputData[outBase+13u] = clamp(alpha, 0.0, 1.0);
}
