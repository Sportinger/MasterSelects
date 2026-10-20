// Shared WGSL reference for Wave, Twirl and Bulge & Pinch (see services/operators/uvDistortRecipes.ts).

// Shape 0 (circle): shorter-side units; shape 1 (frame): plain UV per axis.
fn distortShapeScale(shape: f32, resolution: vec2f) -> vec2f {
  return select(resolution / max(min(resolution.x, resolution.y), 1.0), vec2f(1.0), shape > 0.5);
}

// Edge 0 mirror, 1 clamp, 2 transparent (one-pixel soft edge on alpha only).
fn distortSampleEdges(tex: texture_2d<f32>, smp: sampler, uv: vec2f, edges: f32, resolution: vec2f) -> vec4f {
  let mirrored = 1.0 - abs(fract(uv * 0.5) * 2.0 - 1.0);
  let color = textureSampleLevel(tex, smp, select(mirrored, clamp(uv, vec2f(0.0), vec2f(1.0)), edges > 0.5), 0.0);
  let low = uv * resolution;
  let high = (vec2f(1.0) - uv) * resolution;
  let coverage = clamp(min(min(low.x, low.y), min(high.x, high.y)) + 0.5, 0.0, 1.0);
  return select(color, vec4f(color.rgb, color.a * coverage), edges > 1.5);
}
