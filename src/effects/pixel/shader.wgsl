// Blockify and Block Mosaic: WGSL reference of the editable graphs (services/operators/cellGridRecipes.ts).

struct BlockParams {
  resolution: vec2f,
  scale: f32,     // cell / tile size in pixels of a 1080p frame
  amount: f32,    // mix with the original, 0…1
  levels: f32,    // Blockify: steps per channel
  grout: f32,     // Block Mosaic: grout width in pixels of a 1080p frame
  time: f32,
  speed: f32,
  groutColor: vec4f,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: BlockParams;

fn blockMix(uv: vec2f, rgb: vec3f, alpha: f32) -> vec4f {
  let original = textureSample(inputTex, texSampler, uv);
  let mixed = mix(vec4f(original.rgb * original.a, original.a), vec4f(rgb * alpha, alpha), clamp(params.amount, 0.0, 1.0));
  return vec4f(mixed.rgb / max(mixed.a, 0.000001), mixed.a);
}

@fragment
fn blockifyFragment(input: VertexOutput) -> @location(0) vec4f {
  let pixel = input.uv * params.resolution;
  let cell = cellRenderedPixels(params.scale, params.resolution, 1.0);
  let average = cellAveragePremultiplied(inputTex, cellBounds(pixel, cell, params.resolution), params.resolution);
  let steps = clamp(floor(params.levels + 0.5), 2.0, 64.0) - 1.0;
  let poster = floor(average.rgb / max(average.a, 0.000001) * steps + 0.5) / steps;
  return blockMix(input.uv, poster, average.a);
}

@fragment
fn blockMosaicFragment(input: VertexOutput) -> @location(0) vec4f {
  let pixel = input.uv * params.resolution;
  let tile = cellRenderedPixels(params.scale, params.resolution, 2.0);
  let origin = floor(params.resolution * 0.5);
  let largeIndex = floor((pixel - origin) / (tile * 2.0));
  let large = hash(largeIndex + floor(params.time * params.speed)) > 0.68;
  let bounds = cellBounds(pixel, select(tile, tile * 2.0, large), params.resolution);
  let average = cellAveragePremultiplied(inputTex, bounds, params.resolution);
  let edge = min(min(pixel.x - bounds.x, pixel.y - bounds.y), min(bounds.z - pixel.x, bounds.w - pixel.y));
  let grout = max(params.grout * min(params.resolution.x, params.resolution.y) / 1080.0, 0.0);
  let coverage = clamp(edge - grout * 0.5 + 0.5, 0.0, 1.0);
  let rgb = mix(params.groutColor.rgb, average.rgb / max(average.a, 0.000001), coverage);
  return blockMix(input.uv, rgb, average.a);
}
