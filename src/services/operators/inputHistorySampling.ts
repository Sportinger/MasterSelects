import { RESIDENT_TEMPORAL_SAMPLE_WGSL } from './residentTemporalSampling';
/** Shared temporal sampler; the surrounding spatial map is ordinary Image IR. */
export const INPUT_HISTORY_SAMPLE_WGSL = RESIDENT_TEMPORAL_SAMPLE_WGSL + `
fn sampleInputHistory(atlas: texture_2d_array<f32>, ages: texture_2d<f32>, s: sampler,
  uv: vec2f, requestedDelay: f32, current: vec4f, outputUv: vec2f) -> vec4f {
  let metadataCount = textureDimensions(ages).x - 1u;
  let header = textureLoad(ages, vec2i(i32(metadataCount), 0), 0);
  if (header.z > 3.5) { return sampleResidentTemporal(atlas, ages, s, uv, requestedDelay, current, header); }
  if (header.z > 2.5) {
    let count = u32(clamp(header.x, 1.0, f32(metadataCount)));
    let delay = max(requestedDelay, 0.0);
    let size = vec2f(textureDimensions(atlas));
    let coord = clamp(uv, 0.5 / size, vec2f(1.0) - 0.5 / size);
    var youngAge = 0.0;
    var youngSlot = -1;
    for (var i = 1u; i < count; i++) {
      let sample = textureLoad(ages, vec2i(i32(i), 0), 0);
      if (sample.x >= delay || i + 1u == count) {
        let old = textureSampleLevel(atlas, s, coord, i32(sample.y), 0.0);
        var young = current;
        if (youngSlot >= 0) { young = textureSampleLevel(atlas, s, coord, youngSlot, 0.0); }
        let weight = clamp((delay - youngAge) / max(sample.x - youngAge, 0.00001), 0.0, 1.0);
        if (header.y > 0.5) { return select(young, old, weight >= 0.5); }
        return mix(young, old, weight);
      }
      youngSlot = i32(sample.y); youngAge = sample.x;
    }
    return current;
  }
  if (header.z > 1.5) { return textureSampleLevel(atlas, s, outputUv, 0, 0.0); }
  let count = u32(clamp(header.x, 0.0, 64.0));
  let delay = max(requestedDelay, 0.0);
  if (header.z > 0.5 && count > 0u) {
    // Prepared samples are ordered by map position, independent of source PTS/reverse.
    let tileSize = vec2f(textureDimensions(atlas));
    let localUv = clamp(uv, 0.5 / tileSize, vec2f(1.0) - 0.5 / tileSize);
    let position = clamp(delay / max(header.w, 0.00001), 0.0, 1.0) * f32(count - 1u);
    if (header.y > 0.5) {
      let slot = u32(round(position));
      return textureSampleLevel(atlas, s, localUv, i32(slot), 0.0);
    }
    let lower = u32(floor(position));
    let upper = min(lower + 1u, count - 1u);
    let a = textureSampleLevel(atlas, s, localUv, i32(lower), 0.0);
    let b = textureSampleLevel(atlas, s, localUv, i32(upper), 0.0);
    return mix(a, b, fract(position));
  }
  if (delay <= 0.00001 || count == 0u) { return current; }
  let tileSize = vec2f(textureDimensions(atlas));
  let localUv = clamp(uv, 0.5 / tileSize, vec2f(1.0) - 0.5 / tileSize);
  var younger = current;
  var youngerAge = 0.0;
  for (var i = 0u; i < count; i++) {
    let slot = (u32(header.y) + 64u - i) % 64u;
    let age = textureLoad(ages, vec2i(i32(slot), 0), 0).x;
    if (age >= delay || i + 1u == count) {
      let older = textureSampleLevel(atlas, s, localUv, i32(slot), 0.0);
      if (i > 0u) {
        let next = (slot + 1u) % 64u;
        youngerAge = textureLoad(ages, vec2i(i32(next), 0), 0).x;
        younger = textureSampleLevel(atlas, s, localUv, i32(next), 0.0);
      }
      let weight = clamp((delay - youngerAge) / max(age - youngerAge, 0.00001), 0.0, 1.0);
      if (header.z < -0.5) { return select(younger, older, weight >= 0.5); }
      return mix(younger, older, weight);
    }
  }
  return current;
}`;
