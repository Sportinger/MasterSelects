// Pixelate: WGSL reference of the editable graph (services/operators/cellGridRecipes.ts).

struct PixelateParams {
  size: f32,   // cell size in pixels of a 1080p frame (shorter side)
  width: f32,
  height: f32,
  _p: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: PixelateParams;

@fragment
fn pixelateFragment(input: VertexOutput) -> @location(0) vec4f {
  let resolution = vec2f(params.width, params.height);
  let cell = cellRenderedPixels(params.size, resolution, 1.0);
  let average = cellAveragePremultiplied(inputTex, cellBounds(input.uv * resolution, cell, resolution), resolution);
  return vec4f(average.rgb / max(average.a, 0.000001), average.a);
}
