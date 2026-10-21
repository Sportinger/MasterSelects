// Shared WGSL reference for Wave, Twirl and Bulge & Pinch (see services/operators/uvDistortRecipes.ts).

// Shape 0 (circle): shorter-side units; shape 1 (frame): plain UV per axis.
fn distortShapeScale(shape: f32, resolution: vec2f) -> vec2f {
  return select(resolution / max(min(resolution.x, resolution.y), 1.0), vec2f(1.0), shape > 0.5);
}

fn distortTexelPremultiplied(tex: texture_2d<f32>, pixel: vec2i, size: vec2i) -> vec4f {
  let color = textureLoad(tex, clamp(pixel, vec2i(0), size - vec2i(1)), 0);
  return vec4f(color.rgb * color.a, color.a);
}

// Bilinear sample of the premultiplied frame (the graph reads an rgba16float premultiplied cache):
// a transparent texel never darkens the colour of a visible neighbour.
fn distortSamplePremultiplied(tex: texture_2d<f32>, uv: vec2f) -> vec4f {
  let size = vec2i(textureDimensions(tex));
  let coord = uv * vec2f(size) - 0.5;
  let base = vec2i(floor(coord));
  let f = fract(coord);
  let top = mix(distortTexelPremultiplied(tex, base, size), distortTexelPremultiplied(tex, base + vec2i(1, 0), size), f.x);
  let bottom = mix(distortTexelPremultiplied(tex, base + vec2i(0, 1), size), distortTexelPremultiplied(tex, base + vec2i(1, 1), size), f.x);
  return mix(top, bottom, f.y);
}

// Edge 0 mirror, 1 clamp, 2 transparent (one-pixel soft edge on coverage only). Returns straight alpha.
fn distortSampleEdges(tex: texture_2d<f32>, smp: sampler, uv: vec2f, edges: f32, resolution: vec2f) -> vec4f {
  let mirrored = 1.0 - abs(fract(uv * 0.5) * 2.0 - 1.0);
  let premultiplied = distortSamplePremultiplied(tex, select(mirrored, clamp(uv, vec2f(0.0), vec2f(1.0)), edges > 0.5));
  let low = uv * resolution;
  let high = (vec2f(1.0) - uv) * resolution;
  let coverage = clamp(min(min(low.x, low.y), min(high.x, high.y)) + 0.5, 0.0, 1.0);
  let weighted = premultiplied * select(1.0, coverage, edges > 1.5);
  return vec4f(weighted.rgb / max(weighted.a, 0.000001), weighted.a);
}
