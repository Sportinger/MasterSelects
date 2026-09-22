/** Shared temporal sampler; the surrounding spatial map is ordinary Image IR. */
export const INPUT_HISTORY_SAMPLE_WGSL = `
fn sampleInputHistory(atlas: texture_2d<f32>, ages: texture_2d<f32>, s: sampler,
  uv: vec2f, requestedDelay: f32, current: vec4f) -> vec4f {
  let header = textureLoad(ages, vec2i(64, 0), 0);
  let count = u32(clamp(header.x, 0.0, 64.0));
  let delay = clamp(requestedDelay, 0.0, 4.0);
  if (delay <= 0.00001 || count == 0u) { return current; }
  let tileSize = vec2f(textureDimensions(atlas)) / 8.0;
  let localUv = clamp(uv, 0.5 / tileSize, vec2f(1.0) - 0.5 / tileSize);
  var younger = current;
  var youngerAge = 0.0;
  for (var i = 0u; i < count; i++) {
    let slot = (u32(header.y) + 64u - i) % 64u;
    let age = textureLoad(ages, vec2i(i32(slot), 0), 0).x;
    if (age >= delay || i + 1u == count) {
      let tile = vec2f(f32(slot % 8u), f32(slot / 8u));
      let older = textureSampleLevel(atlas, s, (tile + localUv) / 8.0, 0.0);
      if (i > 0u) {
        let next = (slot + 1u) % 64u;
        youngerAge = textureLoad(ages, vec2i(i32(next), 0), 0).x;
        younger = textureSampleLevel(atlas, s, (vec2f(f32(next % 8u), f32(next / 8u)) + localUv) / 8.0, 0.0);
      }
      let weight = clamp((delay - youngerAge) / max(age - youngerAge, 0.00001), 0.0, 1.0);
      return mix(younger, older, weight);
    }
  }
  return current;
}`;
