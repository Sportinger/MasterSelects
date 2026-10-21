// Blockify and Block Mosaic: WGSL reference of the editable graphs (services/operators/cellGridRecipes.ts).

struct BlockParams {
  resolution: vec2f,
  scale: f32,     // cell / tile size in pixels of a 1080p frame
  amount: f32,    // mix with the original, 0…1
  levels: f32,    // Blockify: steps per channel
  grout: f32,     // Block Mosaic: grout width in pixels of a 1080p frame
  time: f32,
  speed: f32,
  dither: f32,    // Blockify: ordered Bayer dither strength, 0…1
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
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

// The 4 x 4 Bayer threshold of a cell index, (k + 0.5) / 16 (indices offset to be nonnegative).
fn bayer4(cell: vec2f) -> f32 {
  let table = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  let x = u32(cell.x + 65536.0) % 4u;
  let y = u32(cell.y + 65536.0) % 4u;
  return (table[y * 4u + x] + 0.5) / 16.0;
}

@fragment
fn blockifyFragment(input: VertexOutput) -> @location(0) vec4f {
  let pixel = input.uv * params.resolution;
  let cell = cellRenderedPixels(params.scale, params.resolution, 1.0);
  let average = cellAveragePremultiplied(inputTex, cellBounds(pixel, cell, params.resolution), params.resolution);
  let steps = clamp(floor(params.levels + 0.5), 2.0, 64.0) - 1.0;
  let index = floor((pixel - floor(params.resolution * 0.5)) / cell);
  let shift = 0.5 + (bayer4(index) - 0.5) * clamp(params.dither, 0.0, 1.0);
  let poster = floor(average.rgb / max(average.a, 0.000001) * steps + shift) / steps;
  return blockMix(input.uv, poster, average.a);
}

@fragment
fn blockMosaicFragment(input: VertexOutput) -> @location(0) vec4f {
  let pixel = input.uv * params.resolution;
  let tile = cellRenderedPixels(params.scale, params.resolution, 2.0);
  let origin = floor(params.resolution * 0.5);
  let largeIndex = floor((pixel - origin) / (tile * 2.0));
  let seed = fract(vec2f(floor(params.time * params.speed)) * vec2f(0.6180339887, 0.7548776662));
  let large = hash(vec2f(hash(largeIndex), 0.0) + seed) > 0.68;
  let bounds = cellBounds(pixel, select(tile, tile * 2.0, large), params.resolution);
  let average = cellAveragePremultiplied(inputTex, bounds, params.resolution);
  let edge = min(min(pixel.x - bounds.x, pixel.y - bounds.y), min(bounds.z - pixel.x, bounds.w - pixel.y));
  let grout = max(params.grout * min(params.resolution.x, params.resolution.y) / 1080.0, 0.0);
  let coverage = clamp(edge - grout * 0.5 + 0.5, 0.0, 1.0);
  let rgb = mix(params.groutColor.rgb, average.rgb / max(average.a, 0.000001), coverage);
  return blockMix(input.uv, rgb, average.a);
}
