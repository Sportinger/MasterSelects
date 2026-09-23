/** Random-access resident video volume, represented as tiled texture-array pages.
 * Interpolate actual source PTS within grid positions, then interpolate the grid.
 * Negative slots refer to this render's current effect input, never stale history.
 */
export const RESIDENT_TEMPORAL_SAMPLE_WGSL = /* wgsl */`
fn residentTemporalColor(atlas: texture_2d_array<f32>, s: sampler, uv: vec2f,
  slot: i32, grid: vec2u, current: vec4f) -> vec4f {
  if (slot < 0) { return current; }
  let index = u32(slot);
  let pageSize = grid.x * grid.y;
  let cell = vec2u(index % grid.x, (index % pageSize) / grid.x);
  let size = vec2f(textureDimensions(atlas));
  let tileSize = size / vec2f(grid);
  let local = clamp(uv, .5 / tileSize, vec2f(1.0) - .5 / tileSize);
  let coord = (vec2f(cell) + local) / vec2f(grid);
  return textureSampleLevel(atlas, s, coord, i32(index / pageSize), 0.0);
}
fn residentTemporalPoint(atlas: texture_2d_array<f32>, s: sampler, uv: vec2f,
  sample: vec4f, grid: vec2u, current: vec4f) -> vec4f {
  let a = residentTemporalColor(atlas, s, uv, i32(sample.y), grid, current);
  if (sample.w <= 0.0 || sample.y == sample.z) { return a; }
  return mix(a, residentTemporalColor(atlas, s, uv, i32(sample.z), grid, current), sample.w);
}
fn sampleResidentTemporal(atlas: texture_2d_array<f32>, ages: texture_2d<f32>, s: sampler,
  uv: vec2f, requestedDelay: f32, current: vec4f, header: vec4f) -> vec4f {
  let count = u32(header.x);
  if (count <= 1u) { return current; }
  let delay = max(0.0, requestedDelay);
  var lo = 1u; var hi = count - 1u;
  while (lo < hi) {
    let mid = (lo + hi) / 2u;
    if (textureLoad(ages, vec2i(i32(mid), 0), 0).x < delay) { lo = mid + 1u; } else { hi = mid; }
  }
  let young = textureLoad(ages, vec2i(i32(lo - 1u), 0), 0);
  let old = textureLoad(ages, vec2i(i32(lo), 0), 0);
  let grid = vec2u(textureLoad(ages, vec2i(i32(textureDimensions(ages).x - 1u), 1), 0).xy);
  let weight = clamp((delay - young.x) / max(old.x - young.x, .00001), 0.0, 1.0);
  if (header.y > .5) {
    if (weight >= .5) { return residentTemporalPoint(atlas, s, uv, old, grid, current); }
    return residentTemporalPoint(atlas, s, uv, young, grid, current);
  }
  return mix(residentTemporalPoint(atlas, s, uv, young, grid, current),
    residentTemporalPoint(atlas, s, uv, old, grid, current), weight);
}
`;
