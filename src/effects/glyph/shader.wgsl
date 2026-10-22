// WGSL twin of the glyph graph (src/services/operators/asciiEffectGraph.ts). cellSize arrives in
// rendered pixels (Cell Size × shorter side / 1080, glyphCellPixels); travel is the distance a
// keyframed Speed has travelled, or -1e20 without keys.
struct GlyphParams {
  resolution: vec2f,
  cellSize: f32,
  amount: f32,
  time: f32,
  speed: f32,
  glyphCount: f32,
  atlasColumns: f32,
  atlasRows: f32,
  variant: f32,
  invert: f32,
  colorMode: f32,
  colorA: vec4f,
  colorB: vec4f,
  background: f32,
  travel: f32,
  roll: f32,
  scanlines: f32, // Retro Matrix only (0 elsewhere)
};

struct GlyphCell {
  source: vec4f,
  original: vec4f,
  local: vec2f,
  id: vec2f,
  tone: f32,
  index: f32,
  alpha: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: GlyphParams;
@group(0) @binding(3) var feedbackTex: texture_2d<f32>;

// Roll: the cell runs through a window of 1 + ceil(roll × (count − 1)) characters around its own one,
// kept inside the ramp; roll 1 is the whole ramp, 0 holds it on its own character.
fn rolledIndex(baseIndex: f32, offset: f32) -> f32 {
  let count = max(params.glyphCount, 1.0);
  let window = ceil(clamp(params.roll, 0.0, 1.0) * (count - 1.0)) + 1.0;
  let start = clamp(baseIndex - floor(window * 0.5), 0.0, count - window);
  let shifted = baseIndex - start + offset;
  return start + shifted - floor((shifted + 0.5) / window) * window;
}

fn glyphCell(uv: vec2f, indexOffset: f32) -> GlyphCell {
  return glyphCellShifted(uv, vec2f(0.0), indexOffset);
}

// A cell of a grid moved by `shift` cells (Retro Matrix's scroll); it reads the picture where it is now.
fn glyphCellShifted(uv: vec2f, shift: vec2f, indexOffset: f32) -> GlyphCell {
  let grid = params.resolution / max(params.cellSize, 2.0);
  let id = floor(uv * grid + shift);
  let local = fract(uv * grid + shift);
  let sampleUv = (id + 0.5 - shift) / grid;
  let sourceColor = textureSample(inputTex, texSampler, clamp(sampleUv, vec2f(0.001), vec2f(0.999)));
  let tone = luminance(sourceColor.rgb);
  let baseIndex = glyphIndexFromTone(tone, params.glyphCount, params.invert);
  let index = rolledIndex(baseIndex, indexOffset);
  let alpha = sampleGlyphAlpha(local, index, params.atlasColumns, params.atlasRows);
  let original = textureSample(inputTex, texSampler, uv);
  return GlyphCell(sourceColor, original, local, id, tone, index, alpha);
}

// Amount fades from the untouched picture (each pixel, not the cell's colour) to the look, transparency included.
fn amountBlend(cell: GlyphCell, look: vec3f) -> vec4f {
  return vec4f(mix(cell.original.rgb, look, params.amount), mix(cell.original.a, cell.source.a, params.amount));
}

// Timeline time × Speed, or the travel of a keyframed Speed.
fn motionTime() -> f32 {
  return select(params.time * params.speed, params.travel, params.travel > -5e19);
}

// Uniform random of a whole-number cell (PCG2D, the graph's Random (Cell)).
fn glyphCellRandom(p: vec2f) -> f32 {
  var v = bitcast<vec2u>(vec2i(floor(p))) * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v = v ^ (v >> vec2u(16u));
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v = v ^ (v >> vec2u(16u));
  return f32(v.x >> 8u) / 16777216.0;
}

// Integer hash of the exact float bits (the graph's Random (Integer Hash), hashPcg2d.wgsl).
fn glyphHashPcg(p: vec2f) -> f32 {
  var v = bitcast<vec2u>(p);
  v = v ^ (v >> vec2u(16u));
  v = v * vec2u(0x7feb352du, 0x846ca68bu);
  v = v ^ (v >> vec2u(15u));
  v = v * 1664525u + 1013904223u;
  v.x = v.x + v.y * 1664525u;
  v.y = v.y + v.x * 1664525u;
  v = v ^ (v >> vec2u(16u));
  v.x = v.x + v.y * 1664525u;
  v.y = v.y + v.x * 1664525u;
  v = v ^ (v >> vec2u(16u));
  return f32(v.x >> 8u) * (1.0 / 16777216.0);
}

// Coverage of a look that colours every cell in its own palette: full under the character, Background around it.
fn inkCoverage(alpha: f32, ground: f32) -> f32 {
  return mix(ground, 1.0, alpha);
}

fn glyphInk(cell: GlyphCell, alpha: f32, background: vec3f) -> vec4f {
  let duotone = mix(params.colorA.rgb, params.colorB.rgb, cell.tone);
  let ink = select(duotone, cell.source.rgb, params.colorMode < 0.5);
  let ground = mix(background, ink, params.background);
  let result = mix(ground, ink, clamp(alpha, 0.0, 1.0));
  return amountBlend(cell, result);
}

fn darkBackground(cell: GlyphCell) -> vec3f {
  return select(params.colorA.rgb * 0.15, cell.source.rgb * 0.08, params.colorMode < 0.5);
}

@fragment
fn asciiFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = glyphCell(input.uv, 0.0);
  return glyphInk(cell, cell.alpha, darkBackground(cell));
}

@fragment
fn asciiGhostFragment(input: VertexOutput) -> @location(0) vec4f {
  let offset = floor(motionTime() * 5.0);
  let cell = glyphCell(input.uv, offset);
  let current = glyphInk(cell, cell.alpha, darkBackground(cell));
  let previous = textureSample(feedbackTex, texSampler, input.uv);
  return vec4f(max(current.rgb, previous.rgb * 0.88), max(current.a, previous.a * 0.88));
}

@fragment
fn ditherTextFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = glyphCell(input.uv, floor(motionTime() * 2.0));
  let checker = step(0.5, fract((cell.id.x + cell.id.y) * 0.5));
  let threshold = mix(0.28, 0.72, checker);
  let alpha = cell.alpha * step(threshold, cell.tone + hash(cell.id + params.time) * 0.18);
  return glyphInk(cell, alpha, darkBackground(cell));
}

@fragment
fn wordMosaicFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = glyphCell(input.uv, floor(fract(input.uv.x * 0.5) * params.glyphCount));
  let wordBand = smoothstep(0.04, 0.12, cell.local.y) * (1.0 - smoothstep(0.78, 0.95, cell.local.y));
  let connector = step(abs(cell.local.y - 0.5), 0.08) * step(0.25, cell.tone);
  return glyphInk(cell, max(cell.alpha, connector * wordBand * 0.45), darkBackground(cell));
}

@fragment
fn matrixFragment(input: VertexOutput) -> @location(0) vec4f {
  let base = glyphCell(input.uv, 0.0);
  let rain = floor(motionTime() * 8.0 + hash(vec2f(base.id.x, 0.0)) * params.glyphCount - base.id.y);
  let cell = glyphCell(input.uv, rain);
  let head = pow(0.5 + 0.5 * sin(base.id.y * 0.43 - motionTime() * 5.0 + hash(base.id.xx) * TAU), 4.0);
  let green = vec3f(0.04, 0.35 + head * 0.65, 0.13);
  return amountBlend(base, green * inkCoverage(cell.alpha, params.background * base.tone));
}

@fragment
fn pixelCodeFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = glyphCell(input.uv, floor(hash(floor(input.uv * params.resolution / params.cellSize)) * params.glyphCount));
  let codeColor = mix(vec3f(0.08, 0.3, 0.48), vec3f(0.28, 0.95, 0.72), cell.tone);
  return amountBlend(cell, codeColor * inkCoverage(cell.alpha, params.background));
}

@fragment
fn numberFieldFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = glyphCell(input.uv, 0.0);
  let ink = mix(params.colorA.rgb, params.colorB.rgb, floor(cell.tone * 5.0) / 4.0);
  return amountBlend(cell, ink * inkCoverage(cell.alpha, params.background));
}

@fragment
fn gridGlyphFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = glyphCell(input.uv, 0.0);
  let edgeDistance = min(min(cell.local.x, 1.0 - cell.local.x), min(cell.local.y, 1.0 - cell.local.y));
  let gridLine = 1.0 - smoothstep(0.02, 0.07, edgeDistance);
  return glyphInk(cell, max(cell.alpha, gridLine * 0.28), darkBackground(cell));
}

@fragment
fn capsuleCloudFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = glyphCell(input.uv, floor(motionTime() + hash(floor(input.uv * 12.0)) * params.glyphCount));
  let p = abs(cell.local - 0.5) - vec2f(0.43, 0.26);
  let pillDistance = length(max(p, vec2f(0.0))) + min(max(p.x, p.y), 0.0) - 0.18;
  let pill = 1.0 - smoothstep(-0.02, 0.03, pillDistance);
  let ink = max(cell.alpha, pill * 0.18);
  return glyphInk(cell, ink, darkBackground(cell));
}

@fragment
fn inscribeFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = glyphCell(input.uv, 0.0);
  let edge = length(vec2f(dpdx(cell.tone), dpdy(cell.tone))) * params.cellSize * 2.5;
  return glyphInk(cell, cell.alpha * smoothstep(0.02, 0.35, edge), cell.source.rgb * 0.18);
}

@fragment
fn dataHatchFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = glyphCell(input.uv, floor(motionTime() * 2.0));
  let hatch = 1.0 - smoothstep(0.04, 0.13, abs(fract((cell.local.x + cell.local.y) * 4.0) - 0.5));
  return glyphInk(cell, max(cell.alpha, hatch * (1.0 - cell.tone) * 0.55), darkBackground(cell));
}

@fragment
fn glyphMatrixFragment(input: VertexOutput) -> @location(0) vec4f {
  let base = glyphCell(input.uv, 0.0);
  let sweep = floor(motionTime() * 6.0 + base.id.x + base.id.y * 0.35);
  let cell = glyphCell(input.uv, sweep);
  return glyphInk(cell, cell.alpha, darkBackground(cell));
}

@fragment
fn symbolMatrixFragment(input: VertexOutput) -> @location(0) vec4f {
  let base = glyphCell(input.uv, 0.0);
  // Each cell swaps at its own moment to a random character (the graph's Random (Cell) and Random (Integer Hash)).
  let cellRandom = glyphCellRandom(base.id);
  let tick = floor(motionTime() * 4.0 + cellRandom);
  let jitter = floor(glyphHashPcg(vec2f(cellRandom, tick)) * params.glyphCount);
  let cell = glyphCell(input.uv, jitter);
  let pulse = 0.65 + 0.35 * sin(motionTime() * 2.0 + hash(base.id) * TAU);
  return glyphInk(cell, cell.alpha * pulse, darkBackground(cell));
}

@fragment
fn retroMatrixFragment(input: VertexOutput) -> @location(0) vec4f {
  // The text scrolls up 3 rows a second × Speed; each cell keeps one random character of its window (column, line).
  let scroll = vec2f(0.0, motionTime() * 3.0);
  let grid = params.resolution / max(params.cellSize, 2.0);
  let line = floor(input.uv * grid + scroll);
  let cell = glyphCellShifted(input.uv, scroll, floor(glyphCellRandom(line) * params.glyphCount));
  // Phosphor (colorB slot) × coverage on its Background ground × brightness 0.2 + 1.1 × tone.
  let lit = params.colorB.rgb * inkCoverage(cell.alpha, params.background) * (0.2 + cell.tone * 1.1);
  // Scanlines every 3 px of a 1080p frame, moving with the text; closer than 3 output px they fade to an even dimming.
  let pitch = 3.0 * min(params.resolution.x, params.resolution.y) / 1080.0;
  let fade = smoothstep(1.5, 3.0, pitch);
  let row = (input.uv.y * grid.y + scroll.y) * max(params.cellSize, 2.0);
  let dip = pow(sin(row / pitch * PI), 2.0);
  let scan = 1.0 - clamp(params.scanlines, 0.0, 1.0) * mix(0.5, dip, fade);
  return amountBlend(cell, lit * scan);
}

@fragment
fn pixelDitherFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = glyphCell(input.uv, floor(motionTime()));
  let glow = smoothstep(0.05, 0.65, cell.alpha + (1.0 - length(cell.local - 0.5)) * 0.18);
  let neon = mix(params.colorA.rgb, params.colorB.rgb, cell.tone) * inkCoverage(glow, params.background) * 1.25;
  return amountBlend(cell, neon);
}

@fragment
fn brandGeneratorFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = glyphCell(input.uv, floor(length(input.uv - 0.5) * params.glyphCount));
  let frame = 1.0 - smoothstep(0.02, 0.05, min(min(input.uv.x, 1.0 - input.uv.x), min(input.uv.y, 1.0 - input.uv.y)));
  return glyphInk(cell, max(cell.alpha, frame), darkBackground(cell));
}

@fragment
fn uiCollageFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = glyphCell(input.uv, floor(motionTime() + hash(floor(input.uv * 7.0)) * params.glyphCount));
  let border = 1.0 - smoothstep(0.03, 0.09, min(min(cell.local.x, 1.0 - cell.local.x), min(cell.local.y, 1.0 - cell.local.y)));
  let cursor = step(length(cell.local - vec2f(0.72, 0.28)), 0.07);
  return glyphInk(cell, max(cell.alpha, max(border * 0.42, cursor)), darkBackground(cell));
}

@fragment
fn stitchPosterFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = glyphCell(input.uv, 0.0);
  let centered = cell.local - 0.5;
  let stitch = 1.0 - smoothstep(0.025, 0.08, min(abs(centered.x - centered.y), abs(centered.x + centered.y)));
  let thread = max(cell.alpha, stitch * (0.35 + 0.65 * (1.0 - cell.tone)));
  return glyphInk(cell, thread, mix(params.colorB.rgb, darkBackground(cell), 0.25));
}

@fragment
fn contourTypeFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = glyphCell(input.uv, floor(cellValueForContour(input.uv) * params.glyphCount));
  let derivative = length(vec2f(dpdx(cell.tone), dpdy(cell.tone))) * params.cellSize * 3.0;
  let band = 1.0 - smoothstep(0.03, 0.12, abs(fract(cell.tone * 8.0) - 0.5));
  return glyphInk(cell, cell.alpha * max(band, smoothstep(0.05, 0.4, derivative)), darkBackground(cell));
}

fn cellValueForContour(uv: vec2f) -> f32 {
  return luminance(textureSample(inputTex, texSampler, uv).rgb);
}
