// Fiber-aware SVGF for the realtime path (plan 3.4): temporal accumulation of the demodulated
// lighting (lighting / albedo) with history rejection on material and depth and a variance estimate
// from the luminance moments (spatial for short histories). The edge-aware filter follows in
// PtAtrous.wgsl. Buffer layouts: PtRealtimeIntegrator.wgsl and PtRestirShade.wgsl.
//
// Moments, per render pixel 2 vec4: (demodulated color, history length), (luminance moment 1, moment 2, 0, 0).

struct SvgfParams {
  size: vec2u,             // render width, height
  restirHistory: u32,      // first vec4 of the ReSTIR history read half (last frame's geometry), 0xffffffff none
  historyValid: u32,       // 1 when the moments history belongs to this render size
};

@group(0) @binding(0) var<storage, read> surfaces: array<vec4f>;
@group(0) @binding(1) var<storage, read> lighting: array<vec4f>;
@group(0) @binding(2) var<storage, read> restirHistory: array<vec4f>;
@group(0) @binding(3) var<storage, read> previousMoments: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> moments: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> filtered: array<vec4f>;
@group(0) @binding(6) var<uniform> params: SvgfParams;

const SVGF_MAX_HISTORY: f32 = 32.0;
const SVGF_COLOR_ALPHA: f32 = 0.12;
const SVGF_MOMENT_ALPHA: f32 = 0.2;
const SVGF_GBUFFER_HIT: u32 = 1u;

fn svgfLuminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn svgfAlbedo(index: u32) -> vec3f {
  return unpack4x8unorm(bitcast<u32>(surfaces[index * 4u + 2u].x)).rgb;
}

fn svgfHit(index: u32) -> bool {
  return (bitcast<u32>(surfaces[index * 4u + 1u].w) & SVGF_GBUFFER_HIT) != 0u;
}

/** Lighting of a render pixel divided by its albedo (finite, not negative). */
fn svgfDemodulated(index: u32) -> vec3f {
  let c = lighting[index * 3u + 2u].rgb / max(svgfAlbedo(index), vec3f(1e-3));
  return select(vec3f(0.0), max(c, vec3f(0.0)), all(abs(c) < vec3f(1.0e20)));
}

@compute @workgroup_size(8, 8)
fn svgfTemporal(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= params.size)) {
    return;
  }
  let index = id.y * params.size.x + id.x;
  if (!svgfHit(index)) {
    moments[index * 2u] = vec4f(0.0);
    moments[index * 2u + 1u] = vec4f(0.0);
    filtered[index] = vec4f(0.0);
    return;
  }
  let color = svgfDemodulated(index);
  let luminance = svgfLuminance(color);
  let key = bitcast<u32>(surfaces[index * 4u + 1u].z);
  let depth = surfaces[index * 4u + 2u].y;
  let previous = surfaces[index * 4u + 3u].yz;

  // Bilinear history over the taps that show the same surface.
  var history = vec4f(0.0);
  var historyMoments = vec2f(0.0);
  var weight = 0.0;
  if (params.historyValid == 1u && params.restirHistory != 0xffffffffu) {
    let base = vec2i(floor(previous));
    let f = previous - floor(previous);
    for (var tap = 0u; tap < 4u; tap++) {
      let offset = vec2i(i32(tap & 1u), i32(tap >> 1u));
      let p = base + offset;
      if (any(p < vec2i(0)) || any(p >= vec2i(params.size))) {
        continue;
      }
      let at = u32(p.y) * params.size.x + u32(p.x);
      let geometry = restirHistory[params.restirHistory + at * 2u + 1u];
      if ((bitcast<u32>(geometry.y) >> 16u) != key || abs(geometry.z - depth) > 0.1 * depth) {
        continue;
      }
      let w = select(1.0 - f.x, f.x, offset.x == 1) * select(1.0 - f.y, f.y, offset.y == 1);
      let past = previousMoments[at * 2u];
      let pastMoments = previousMoments[at * 2u + 1u].xy;
      // A history texel that went bad is not used (it would keep the defect alive).
      if (!all(abs(past) < vec4f(1.0e20)) || !all(abs(pastMoments) < vec2f(1.0e20))) {
        continue;
      }
      history += past * w;
      historyMoments += pastMoments * w;
      weight += w;
    }
  }
  var historyLength = 1.0;
  var accumulated = color;
  var m = vec2f(luminance, luminance * luminance);
  if (weight > 1e-3) {
    history /= weight;
    historyMoments /= weight;
    historyLength = min(history.w + 1.0, SVGF_MAX_HISTORY);
    accumulated = mix(history.rgb, color, max(1.0 / historyLength, SVGF_COLOR_ALPHA));
    m = mix(historyMoments, m, max(1.0 / historyLength, SVGF_MOMENT_ALPHA));
  }
  var variance = max(m.y - m.x * m.x, 0.0);
  if (historyLength < 4.0) {
    // Short history: the spatial variance of the 3x3 neighbors with the same material.
    var sum = 0.0;
    var sumSquares = 0.0;
    var count = 0.0;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let p = vec2i(id.xy) + vec2i(dx, dy);
        if (any(p < vec2i(0)) || any(p >= vec2i(params.size))) {
          continue;
        }
        let at = u32(p.y) * params.size.x + u32(p.x);
        if (!svgfHit(at) || bitcast<u32>(surfaces[at * 4u + 1u].z) != key) {
          continue;
        }
        let l = svgfLuminance(svgfDemodulated(at));
        sum += l;
        sumSquares += l * l;
        count += 1.0;
      }
    }
    let mean = sum / max(count, 1.0);
    variance = max(variance, max(sumSquares / max(count, 1.0) - mean * mean, 0.0) * (4.0 / historyLength));
  }
  moments[index * 2u] = vec4f(accumulated, historyLength);
  moments[index * 2u + 1u] = vec4f(m, 0.0, 0.0);
  filtered[index] = vec4f(accumulated, variance);
}
