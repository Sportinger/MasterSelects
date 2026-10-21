// Shared WGSL reference for Pixelate, Blockify and Block Mosaic (services/operators/cellGridRecipes.ts).

// A 1080p-pixel size in whole rendered pixels (at least `minimum`).
fn cellRenderedPixels(size: f32, resolution: vec2f, minimum: f32) -> f32 {
  return max(floor(size * min(resolution.x, resolution.y) / 1080.0 + 0.5), minimum);
}

// The centred grid cell of a pixel: xy = start, zw = end (rendered pixels, not clamped).
fn cellBounds(pixel: vec2f, cell: f32, resolution: vec2f) -> vec4f {
  let origin = floor(resolution * 0.5);
  let start = origin + floor((pixel - origin) / cell) * cell;
  return vec4f(start, start + cell);
}

// Premultiplied average of the cell's pixels inside the frame (at most 128 x 128 evenly spread reads).
fn cellAveragePremultiplied(tex: texture_2d<f32>, bounds: vec4f, resolution: vec2f) -> vec4f {
  let low = clamp(bounds.xy, vec2f(0.0), resolution);
  let high = clamp(bounds.zw, vec2f(0.0), resolution);
  let count = vec2i(max(high - low, vec2f(1.0)));
  let reads = min(count, vec2i(128));
  var sum = vec4f(0.0);
  for (var y = 0; y < reads.y; y++) {
    for (var x = 0; x < reads.x; x++) {
      let pixel = vec2i(low + (vec2f(f32(x), f32(y)) + 0.5) * vec2f(count) / vec2f(reads));
      let color = textureLoad(tex, pixel, 0);
      sum += vec4f(color.rgb * color.a, color.a);
    }
  }
  return sum / f32(reads.x * reads.y);
}
