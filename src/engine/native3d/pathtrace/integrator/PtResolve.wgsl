// Path tracer to scene target: the averaged (or denoised) linear radiance becomes the scene's
// display-referred HDR value (sRGB-encoded, premultiplied, may exceed 1), like the raster writes,
// and the nearest primary hit becomes scene depth so splats composite over it. The accumulation is
// upsampled bilinearly from the render scale; the realtime path's output (already at output size)
// is shown alone while the camera moves and faded out while a still image converges (no jump).
// Debug views show the primary-hit AOVs or a BVH traversal heatmap instead.

struct ResolveParams {
  sizes: vec4f,     // render width, height, output width, height
  scales: vec4f,    // 1 / samples, color scale (1 / samples, or 1 for denoised color), debug view, 1 when denoised
  realtime: vec4f,  // x: weight of the realtime image over the accumulation, y: 1 to show only the realtime image,
                    // z: 1 when a realtime image is bound (it fills pixels without samples, e.g. outside a render region)
};

@group(0) @binding(0) var<uniform> resolve: ResolveParams;
@group(0) @binding(1) var<storage, read> color: array<vec4f>;
@group(0) @binding(2) var<storage, read> auxiliary: array<vec4f>;
// Per pixel: (NDC depth, luminance sums, own sample count) from the integrator.
@group(0) @binding(3) var<storage, read> pixelState: array<vec4f>;
// Accumulated coverage (alpha) per pixel; the denoised color has none of its own.
@group(0) @binding(4) var<storage, read> coverage: array<vec4f>;
// Realtime output at output size: premultiplied linear (rgb, coverage) and NDC depth.
@group(0) @binding(5) var<storage, read> realtimeColor: array<vec4f>;
@group(0) @binding(6) var<storage, read> realtimeDepth: array<f32>;

struct ResolveOut {
  @location(0) color: vec4f,
  @builtin(frag_depth) depth: f32,
};

@vertex
fn resolveVertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn resolveEncode(linear: vec3f) -> vec3f {
  let x = max(linear, vec3f(0.0));
  return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308));
}

fn resolveHeat(t: f32) -> vec3f {
  let x = clamp(t, 0.0, 1.0);
  return clamp(vec3f(1.5 * x - 0.25, 1.5 - abs(2.0 * x - 1.0) * 1.5, 1.25 - 1.5 * x), vec3f(0.0), vec3f(1.0));
}

/** 1 / the samples behind a pixel (adaptive sampling stops pixels at different counts). */
fn resolveInverseSamples(index: u32) -> f32 {
  let count = pixelState[index].w;
  return select(resolve.scales.x, 1.0 / count, count > 0.0);
}

/** Premultiplied linear (rgb, coverage) of the accumulation at render pixel p. */
fn resolveAccumulated(p: vec2i) -> vec4f {
  let render = vec2i(resolve.sizes.xy);
  let q = clamp(p, vec2i(0), render - 1);
  let index = u32(q.y * render.x + q.x);
  let inverse = resolveInverseSamples(index);
  return vec4f(color[index].rgb * select(inverse, 1.0, resolve.scales.w > 0.5), clamp(coverage[index].a * inverse, 0.0, 1.0));
}

fn resolveEncodePremultiplied(c: vec4f) -> vec4f {
  if (c.a <= 0.0) {
    return vec4f(0.0);
  }
  return vec4f(resolveEncode(c.rgb / c.a) * c.a, c.a);
}

@fragment
fn resolveFragment(@builtin(position) position: vec4f) -> ResolveOut {
  var out: ResolveOut;
  let output = vec2u(position.xy);
  let outIndex = output.y * u32(resolve.sizes.z) + output.x;
  if (resolve.realtime.y > 0.5) {
    let c = realtimeColor[outIndex];
    out.color = resolveEncodePremultiplied(c);
    out.depth = select(1.0, realtimeDepth[outIndex], c.a > 0.0);
    return out;
  }
  let render = resolve.sizes.xy;
  let pixel = min(vec2u(position.xy * render / resolve.sizes.zw), vec2u(render) - 1u);
  let index = pixel.y * u32(render.x) + pixel.x;
  // Outside a render region (no samples there) the last realtime image stays visible.
  if (resolve.realtime.z > 0.5 && pixelState[index].w <= 0.0 && u32(resolve.scales.z + 0.5) == 0u) {
    let c = realtimeColor[outIndex];
    out.color = resolveEncodePremultiplied(c);
    out.depth = select(1.0, realtimeDepth[outIndex], c.a > 0.0);
    return out;
  }
  let inverseSamples = resolveInverseSamples(index);
  let alpha = clamp(coverage[index].a * inverseSamples, 0.0, 1.0);
  out.depth = select(1.0, pixelState[index].x, alpha > 0.0);
  let view = u32(resolve.scales.z + 0.5);
  if (view == 1u) {
    out.color = vec4f(auxiliary[index * 2u].rgb * inverseSamples, alpha);
    return out;
  }
  if (view == 2u) {
    let n = auxiliary[index * 2u + 1u].xyz * inverseSamples;
    out.color = vec4f((n * 0.5 + 0.5) * alpha, alpha);
    return out;
  }
  if (view == 3u) {
    let d = auxiliary[index * 2u].w * inverseSamples / max(alpha, 1e-6);
    out.color = vec4f(vec3f(fract(log2(max(d, 1e-3)))) * alpha, alpha);
    return out;
  }
  if (view == 4u) {
    let steps = auxiliary[index * 2u + 1u].w * inverseSamples;
    out.color = vec4f(resolveHeat(steps / 160.0), 1.0);
    out.depth = 1.0;
    return out;
  }
  // Bilinear upsampling of the premultiplied accumulation.
  let continuous = position.xy * render / resolve.sizes.zw - 0.5;
  let base = vec2i(floor(continuous));
  let f = continuous - floor(continuous);
  var accumulated = mix(mix(resolveAccumulated(base), resolveAccumulated(base + vec2i(1, 0)), f.x),
    mix(resolveAccumulated(base + vec2i(0, 1)), resolveAccumulated(base + vec2i(1, 1)), f.x), f.y);
  let blend = resolve.realtime.x;
  if (blend > 0.0) {
    let c = realtimeColor[outIndex];
    accumulated = mix(accumulated, c, blend);
    if (alpha <= 0.0 && c.a > 0.0) {
      out.depth = realtimeDepth[outIndex];
    }
  }
  out.color = resolveEncodePremultiplied(accumulated);
  return out;
}
