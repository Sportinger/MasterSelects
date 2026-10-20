struct Settings { world: mat4x4f, camera: vec4f, time: f32, count: u32, operations: u32, sourceCount: u32, sampling: vec4u }
struct Operation { header: vec4f, a: vec4f, b: vec4f, c: vec4f }
@group(0) @binding(0) var<storage, read> source: array<f32>;
@group(0) @binding(1) var<storage, read_write> outputData: array<f32>;
@group(0) @binding(2) var<uniform> settings: Settings;
@group(0) @binding(3) var<storage, read> operations: array<Operation>;
@group(0) @binding(4) var<storage, read> sourceIndices: array<u32>;
@group(0) @binding(5) var<storage, read_write> outputIds: array<u32>;
fn hash(n: u32) -> f32 {
  var x = n; x = ((x >> 16u) ^ x) * 0x45d9f3bu; x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  return f32((x >> 16u) ^ x) / 4294967295.0;
}
fn noise(p: vec3f, t: f32, seed: f32) -> vec3f {
  let q = p + vec3f(seed * 0.013, seed * 0.027, seed * 0.031);
  return vec3f(sin(q.y + t) * cos(q.z - t * 0.7), sin(q.z + t * 0.8) * cos(q.x - t), sin(q.x + t * 0.6) * cos(q.y + t * 0.9));
}
// Smooth two-octave vector potential; its curl is a divergence-free swirl field.
fn potential(p: vec3f, seed: f32) -> vec3f {
  let q = p + vec3f(seed * 1.7, seed * 2.3, seed * 3.1);
  return vec3f(sin(q.y * 1.3 + cos(q.z * 0.7)) + 0.5 * sin(q.z * 2.1 + q.x * 1.1),
    sin(q.z * 1.1 + cos(q.x * 0.9)) + 0.5 * sin(q.x * 2.3 + q.y * 1.3),
    sin(q.x * 1.2 + cos(q.y * 0.8)) + 0.5 * sin(q.y * 1.9 + q.z * 1.4));
}
fn curl(p: vec3f, seed: f32) -> vec3f {
  let e = 0.05; let dx = vec3f(e, 0, 0); let dy = vec3f(0, e, 0); let dz = vec3f(0, 0, e);
  let x0 = potential(p - dx, seed); let x1 = potential(p + dx, seed);
  let y0 = potential(p - dy, seed); let y1 = potential(p + dy, seed);
  let z0 = potential(p - dz, seed); let z1 = potential(p + dz, seed);
  return vec3f((y1.z - y0.z) - (z1.y - z0.y), (z1.x - z0.x) - (x1.z - x0.z), (x1.y - x0.y) - (y1.x - y0.x)) / (2.0 * e);
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
  outputIds[outputId] = id;
  var p = vec3f(source[base], source[base+1u], source[base+2u]);
  var scale = vec3f(source[base+3u], source[base+4u], source[base+5u]);
  var q = vec4f(source[base+6u], source[base+7u], source[base+8u], source[base+9u]);
  var color = vec3f(source[base+10u], source[base+11u], source[base+12u]);
  var alpha = source[base+13u];
  // Chain state shared by later operations: release weight (0 solid .. 1 gone) and the part of it that does
  // not come from the conveyor axis, conveyor (axis, start, length, flow sign), loop period, flow direction
  // and the falloff window along the conveyor axis (center, solid half-size, feather, valid flag).
  var weight = 0.0; var sideWeight = 0.0; var conveyor = vec4f(-1, 0, 0, 0); var period = 0.0; var flow = vec3f(0);
  var window = vec4f(0); var released = 0.0; var home = vec3f(0);
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
      case 10u: {
        // Conveyor: scroll along a local axis and wrap into [start, start + length). Closed form, so seeking
        // is exact; the motion repeats every length / |speed| seconds. Travel adds a keyframeable distance,
        // so speed ramps and the starting position of the content seam can be animated without jumps.
        // a = axis, speed, start, length; b.x = travel.
        let axis = min(u32(a.x), 2u); let span = max(a.w, 0.0001);
        let shifted = p[axis] - a.z + settings.time * a.y + b.x;
        p[axis] = a.z + shifted - floor(shifted / span) * span;
        conveyor = vec4f(f32(axis), a.z, span, select(1.0, -1.0, a.y < 0.0));
        flow = vec3f(0); flow[axis] = select(1.0, -1.0, a.y < 0.0);
        if (a.y != 0.0) { period = span / abs(a.y); }
      }
      case 11u: {
        // Falloff box: release weight grows from the solid half-size to half-size + feather on every axis.
        // a.xyz = center, (a.w, b.x, b.y) = half-size, (b.z, b.w, c.x) = feather, c.y = edge jitter.
        let feather = max(vec3f(b.z, b.w, op.c.x), vec3f(0.0001));
        let reach = abs(p - a.xyz) + (hash(id ^ 0x9e3779b9u) - 0.5) * feather * op.c.y;
        let w = smoothstep(vec3f(a.w, b.x, b.y), vec3f(a.w, b.x, b.y) + feather, reach);
        weight = max(weight, max(w.x, max(w.y, w.z)));
        if (conveyor.x >= 0.0) {
          let along = u32(conveyor.x); var side = w; side[along] = 0.0;
          sideWeight = max(sideWeight, max(side.x, max(side.y, side.z)));
          window = vec4f(a.xyz[along], vec3f(a.w, b.x, b.y)[along], feather[along], 1.0);
        }
      }
      case 12u: {
        // Release: released splats fly along a two-octave curl field built from the connected Turbulence,
        // Gravity and Drag forces, are swept along the conveyor flow, shrink, glow and optionally fade.
        // Per-splat swirl scale and long-tailed flight lengths keep the motion organic. The field circles
        // once per conveyor loop, so the animation stays seamless. Cycle blends the release amount from the
        // falloff weight to a round trip: leaving the conveyor window, a splat drifts out through the gap and
        // lands back on its own place when the strip re-enters the window (pair with a closed Ring Bend).
        // a = flight, stream, particle size, glow; b = turbulence strength, frequency, gravity (+ = -Y), drag;
        // c = seed, fade, cycle, linger; header = -, dissolve spread, path steps (quality), particle density.
        var amount = weight;
        if (op.c.z > 0.0 && window.w > 0.0 && conveyor.x >= 0.0) {
          // The trip starts Feather before the window's exit edge (a long dissolve inside the strip) and
          // ends exactly at the entry edge, so splats land crisply.
          let span = conveyor.z; let half = window.y; let exitStart = min(half - window.z, half);
          var o = p[u32(conveyor.x)] - window.x; o = (o - span * floor(o / span + 0.5)) * conveyor.w;
          let gap = max(span - exitStart - half, 0.001);
          var journey = -1.0;
          if (o >= exitStart) { journey = (o - exitStart) / gap; } else if (o <= -half) { journey = (o + span - exitStart) / gap; }
          // Linger reshapes the trip from a sine into: fly out fast, hold far out while drifting with the
          // gap, then return slowly at first and faster and faster until the splat snaps into place.
          // Dissolve spread gives every splat its own departure time, so the exit frays over a long stretch.
          let j = clamp(journey, 0.0, 1.0); let departure = hash(id ^ 0x632be5abu) * op.header.y * 0.6;
          let leave = 1.0 - pow(1.0 - smoothstep(departure, departure + 0.12 + 0.2 * op.header.y, j), 2.0);
          let back = 1.0 - pow(smoothstep(0.35, 1.0, j), 3.0);
          let trip = select(0.0, mix(sin(3.14159265 * j), leave * back, clamp(op.c.w, 0.0, 1.0)), journey >= 0.0);
          amount = mix(weight, max(trip, sideWeight), clamp(op.c.z, 0.0, 1.0));
        }
        if (released == 0.0) { home = p; }
        released = max(released, amount);
        // Particle density keeps only a seeded share of released splats as particles; the rest fade out
        // while leaving and are then culled before sorting, so dense strips stay cheap.
        if (hash(id ^ 0x1b873593u) >= op.header.w) { alpha *= 1.0 - smoothstep(0.0, 0.3, amount); }
        if ((amount >= 0.999 && op.c.y >= 0.999) || alpha <= 0.0) { alpha = 0.0; }
        else if (amount > 0.0) {
          let e = amount * amount; let r1 = hash(id ^ 0x85ebca6bu); let r2 = hash(id ^ 0x27d4eb2fu);
          let frequency = max(b.y, 0.001) * (0.55 + 0.9 * r2);
          let flight = a.x * (0.15 + 2.2 * r1 * r1) * e * exp(-b.w);
          var phase = settings.time * 0.25;
          if (period > 0.0) { phase = settings.time / period * 6.2831853; }
          let start = p * frequency + vec3f(cos(phase), sin(phase), 0.5 * cos(phase + r2 * 6.2831853)) * 3.0;
          let spread = normalize(vec3f(hash(id + 11u), hash(id + 12u), hash(id + 13u)) - vec3f(0.4999));
          var q = start; let steps = u32(clamp(round(op.header.z), 1.0, 12.0));
          for (var step = 0u; step < steps; step++) {
            let swirl = curl(q, op.c.x) + 0.5 * curl(q * 2.3 + vec3f(7.1, 3.7, 1.3), op.c.x + 5.0);
            let v = swirl / max(length(swirl), 0.0001) * b.x + flow * a.y + vec3f(0, -b.z, 0) * 0.25 + spread * 0.3;
            q += v / max(length(v), 0.0001) * (flight * frequency / f32(steps));
          }
          p += (q - start) / frequency;
          scale *= mix(1.0, a.z, amount);
          color *= 1.0 + a.w * amount;
          alpha *= 1.0 - op.c.y * smoothstep(0.6, 1.0, amount);
        }
      }
      case 13u: {
        // Ring bend: roll the strip along axis X or Z onto the inside of a ring whose center lies Radius
        // from the ground height along local Y (negative Radius: toward -Y, for Y-down captures), so it
        // curves up ahead and behind the center. A radius of length / 2pi closes a full ring.
        // Keep outside: splats released by an upstream Release may only move outward from their place and
        // are pushed behind the ring surface while they leave, so flights never crowd the view from inside;
        // settled splats keep their place. Bend scales the curvature from 0 (flat) to 1 (Radius), so the
        // strip curls up smoothly around Center while that point stays in place.
        // a = axis, center, radius, ground; b.x = keep outside, b.y = bend.
        let axis = min(u32(a.x), 2u); let radius = abs(a.z) / max(clamp(b.y, 0.0, 1.0), 0.0001); let up = sign(a.z);
        if (a.z != 0.0 && b.y > 0.0 && axis != 1u && alpha > 0.0) {
          let theta = (p[axis] - a.y) / radius; var r = radius - (p.y - a.w) * up;
          if (released > 0.0) {
            let settled = radius - (home.y - a.w) * up;
            let outside = settled + abs(r - settled) + max(radius - settled, 0.0) * smoothstep(0.0, 0.5, released) + released;
            r = mix(r, outside, clamp(b.x, 0.0, 1.0));
          }
          // Content higher than the ring center would fold through the axis; fade it out near the axis
          // instead (sky and tall surroundings disappear as the world curls).
          alpha *= smoothstep(0.0, 0.35 * radius, r);
          p[axis] = a.y + r * sin(theta); p.y = a.w + up * (radius - r * cos(theta));
          var turn = vec3f(0); let degrees = theta * 57.29578 * up;
          if (axis == 2u) { turn.x = -degrees; } else { turn.z = degrees; }
          q = rotate(q, turn);
        }
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
