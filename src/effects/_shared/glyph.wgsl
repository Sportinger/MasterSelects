@group(0) @binding(4) var glyphAtlasTex: texture_2d<f32>;

fn glyphIndexFromTone(tone: f32, glyphCount: f32, invert: f32) -> f32 {
  let mapped = mix(tone, 1.0 - tone, step(0.5, invert));
  return floor(clamp(mapped, 0.0, 0.99999) * max(glyphCount, 1.0));
}
fn sampleGlyphAlpha(localUv: vec2f, glyphIndex: f32, atlasColumns: f32, atlasRows: f32) -> f32 {
  let safeColumns = max(1.0, atlasColumns);
  let safeRows = max(1.0, atlasRows);
  let index = max(0.0, glyphIndex);
  let tile = vec2f(index - floor(index / safeColumns) * safeColumns, floor(index / safeColumns));
  let atlasUv = (tile + clamp(localUv, vec2f(0.001), vec2f(0.999))) / vec2f(safeColumns, safeRows);
  return textureSampleLevel(glyphAtlasTex, texSampler, atlasUv, 0.0).a;
}
