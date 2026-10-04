// Temporal upscaler of the realtime path (plan 4.6): from the jittered render resolution to the
// output resolution. Each output pixel samples the denoised frame (Catmull-Rom, 4x4 taps) at its
// position minus the frame's jitter, reprojects its history with the motion of the nearest
// surface in the 3x3 neighborhood, clamps the history into the neighbors' color range (YCoCg),
// blends, and sharpens lightly. Colors are premultiplied (rgb, coverage). Writes the output
// history (read by the scene resolve) and the output depth for compositing.

struct UpscaleParams {
  renderSize: vec2u,
  outputSize: vec2u,
  jitter: vec2f,          // render pixels, the camera ray offset of this frame
  historyValid: u32,      // 1 when the read history belongs to this output size
  pad: u32,
};

@group(0) @binding(0) var<storage, read> surfaces: array<vec4f>;
@group(0) @binding(1) var<storage, read> current: array<vec4f>;
@group(0) @binding(2) var<storage, read> previous: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> output: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> outputDepth: array<f32>;
@group(0) @binding(5) var<uniform> params: UpscaleParams;

const UPSCALE_BLEND: f32 = 0.1;
const UPSCALE_SHARPEN: f32 = 0.15;

fn upscaleToYCoCg(c: vec4f) -> vec4f {
  return vec4f(dot(c.rgb, vec3f(0.25, 0.5, 0.25)), dot(c.rgb, vec3f(0.5, 0.0, -0.5)), dot(c.rgb, vec3f(-0.25, 0.5, -0.25)), c.a);
}

fn upscaleFromYCoCg(c: vec4f) -> vec4f {
  return vec4f(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z, c.a);
}

fn upscaleFinite(c: vec4f) -> vec4f {
  return select(vec4f(0.0), c, all(abs(c) < vec4f(1.0e20)));
}

fn upscaleCurrent(p: vec2i) -> vec4f {
  let q = clamp(p, vec2i(0), vec2i(params.renderSize) - 1);
  return upscaleFinite(current[u32(q.y) * params.renderSize.x + u32(q.x)]);
}

fn upscalePrevious(p: vec2i) -> vec4f {
  let q = clamp(p, vec2i(0), vec2i(params.outputSize) - 1);
  return upscaleFinite(previous[u32(q.y) * params.outputSize.x + u32(q.x)]);
}

fn upscaleCatmullRomWeights(f: f32) -> vec4f {
  let f2 = f * f;
  let f3 = f2 * f;
  return vec4f(-0.5 * f3 + f2 - 0.5 * f, 1.5 * f3 - 2.5 * f2 + 1.0, -1.5 * f3 + 2.0 * f2 + 0.5 * f, 0.5 * f3 - 0.5 * f2);
}

/** Catmull-Rom sample of the current frame at continuous render index position p. */
fn upscaleSampleCurrent(p: vec2f) -> vec4f {
  let base = floor(p);
  let f = p - base;
  let wx = upscaleCatmullRomWeights(f.x);
  let wy = upscaleCatmullRomWeights(f.y);
  var sum = vec4f(0.0);
  for (var y = 0; y < 4; y++) {
    for (var x = 0; x < 4; x++) {
      sum += upscaleCurrent(vec2i(base) + vec2i(x - 1, y - 1)) * (wx[x] * wy[y]);
    }
  }
  return max(sum, vec4f(0.0));
}

fn upscaleSamplePrevious(p: vec2f) -> vec4f {
  let base = floor(p);
  let f = p - base;
  let b = vec2i(base);
  return mix(mix(upscalePrevious(b), upscalePrevious(b + vec2i(1, 0)), f.x),
    mix(upscalePrevious(b + vec2i(0, 1)), upscalePrevious(b + vec2i(1, 1)), f.x), f.y);
}

@compute @workgroup_size(8, 8)
fn upscale(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= params.outputSize)) {
    return;
  }
  let outIndex = id.y * params.outputSize.x + id.x;
  let scale = vec2f(params.renderSize) / vec2f(params.outputSize);
  // Continuous render index (pixel centers at integers) of this output pixel's center.
  let renderPosition = (vec2f(id.xy) + 0.5) * scale - 0.5 - params.jitter;
  let nearest = clamp(vec2i(floor(renderPosition + params.jitter + 0.5)), vec2i(0), vec2i(params.renderSize) - 1);

  // Neighborhood range and the nearest surface's motion (closest depth in 3x3: edges follow the front).
  var low = vec4f(1e30);
  var high = vec4f(-1e30);
  var closest = 2.0;
  var motionPixel = nearest;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let p = clamp(nearest + vec2i(dx, dy), vec2i(0), vec2i(params.renderSize) - 1);
      let c = upscaleToYCoCg(upscaleCurrent(p));
      low = min(low, c);
      high = max(high, c);
      let ndc = surfaces[(u32(p.y) * params.renderSize.x + u32(p.x)) * 4u + 2u].z;
      if (ndc < closest) {
        closest = ndc;
        motionPixel = p;
      }
    }
  }
  let center = surfaces[(u32(nearest.y) * params.renderSize.x + u32(nearest.x)) * 4u + 2u].z;
  outputDepth[outIndex] = center;

  var color = upscaleSampleCurrent(renderPosition);
  let previousRender = surfaces[(u32(motionPixel.y) * params.renderSize.x + u32(motionPixel.x)) * 4u + 3u].yz;
  // The stored previous position belongs to the jittered sample of motionPixel; shift it to this output pixel.
  let velocity = previousRender - (vec2f(motionPixel) + params.jitter);
  let previousOutput = (renderPosition + params.jitter + velocity + 0.5) / scale - 0.5;
  let inside = all(previousOutput >= vec2f(-0.5)) && all(previousOutput <= vec2f(params.outputSize) - 0.5);
  if (params.historyValid == 1u && inside) {
    let history = upscaleToYCoCg(upscaleSamplePrevious(previousOutput));
    let clamped = upscaleFromYCoCg(clamp(history, low, high));
    // Sharpen the new sample against its neighborhood mean before blending.
    let mean = upscaleFromYCoCg((low + high) * 0.5);
    let sharpened = max(color + (color - mean) * UPSCALE_SHARPEN * min(scale.x, 1.0), vec4f(0.0));
    color = mix(clamped, sharpened, UPSCALE_BLEND);
  }
  // NaN or infinite values would spread through the history: drop them.
  output[outIndex] = select(vec4f(0.0), color, all(abs(color) < vec4f(1.0e20)));
}
