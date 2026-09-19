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
};

struct GlyphCell {
  source: vec4f,
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

fn glyphCell(uv: vec2f, indexOffset: f32) -> GlyphCell {
  let grid = params.resolution / max(params.cellSize, 2.0);
  let id = floor(uv * grid);
  let local = fract(uv * grid);
  let sampleUv = (id + 0.5) / grid;
  let sourceColor = textureSample(inputTex, texSampler, clamp(sampleUv, vec2f(0.001), vec2f(0.999)));
  let tone = luminance(sourceColor.rgb);
  let baseIndex = glyphIndexFromTone(tone, params.glyphCount, params.invert);
  let index = baseIndex + indexOffset - floor((baseIndex + indexOffset) / params.glyphCount) * params.glyphCount;
  let alpha = sampleGlyphAlpha(local, index, params.atlasColumns, params.atlasRows);
  return GlyphCell(sourceColor, local, id, tone, index, alpha);
}

fn glyphInk(cell: GlyphCell, alpha: f32, background: vec3f) -> vec4f {
  let duotone = mix(params.colorA.rgb, params.colorB.rgb, cell.tone);
  let ink = select(duotone, cell.source.rgb, params.colorMode < 0.5);
  let result = mix(background, ink, clamp(alpha, 0.0, 1.0));
  return vec4f(mix(cell.source.rgb, result, params.amount), cell.source.a);
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
  let offset = floor(params.time * params.speed * 5.0);
  let cell = glyphCell(input.uv, offset);
  let current = glyphInk(cell, cell.alpha, darkBackground(cell));
  let previous = textureSample(feedbackTex, texSampler, input.uv);
  return vec4f(max(current.rgb, previous.rgb * 0.88), max(current.a, previous.a * 0.88));
}

@fragment
fn ditherTextFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = glyphCell(input.uv, floor(params.time * params.speed * 2.0));
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
  let rain = floor(params.time * params.speed * 8.0 + hash(vec2f(base.id.x, 0.0)) * params.glyphCount - base.id.y);
  let cell = glyphCell(input.uv, rain);
  let head = pow(0.5 + 0.5 * sin(base.id.y * 0.43 - params.time * params.speed * 5.0 + hash(base.id.xx) * TAU), 4.0);
  let green = vec3f(0.04, 0.35 + head * 0.65, 0.13);
  return vec4f(mix(base.source.rgb, green * cell.alpha, params.amount), base.source.a);
}

@fragment
fn pixelCodeFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = glyphCell(input.uv, floor(hash(floor(input.uv * params.resolution / params.cellSize)) * params.glyphCount));
  let codeColor = mix(vec3f(0.08, 0.3, 0.48), vec3f(0.28, 0.95, 0.72), cell.tone);
  return vec4f(mix(cell.source.rgb, codeColor * cell.alpha, params.amount), cell.source.a);
}

@fragment
fn numberFieldFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = glyphCell(input.uv, 0.0);
  let ink = mix(params.colorA.rgb, params.colorB.rgb, floor(cell.tone * 5.0) / 4.0);
  return vec4f(mix(cell.source.rgb, ink * cell.alpha, params.amount), cell.source.a);
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
  let cell = glyphCell(input.uv, floor(params.time * params.speed + hash(floor(input.uv * 12.0)) * params.glyphCount));
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
  let cell = glyphCell(input.uv, floor(params.time * params.speed * 2.0));
  let hatch = 1.0 - smoothstep(0.04, 0.13, abs(fract((cell.local.x + cell.local.y) * 4.0) - 0.5));
  return glyphInk(cell, max(cell.alpha, hatch * (1.0 - cell.tone) * 0.55), darkBackground(cell));
}

@fragment
fn glyphMatrixFragment(input: VertexOutput) -> @location(0) vec4f {
  let base = glyphCell(input.uv, 0.0);
  let sweep = floor(params.time * params.speed * 6.0 + base.id.x + base.id.y * 0.35);
  let cell = glyphCell(input.uv, sweep);
  return glyphInk(cell, cell.alpha, darkBackground(cell));
}

@fragment
fn symbolMatrixFragment(input: VertexOutput) -> @location(0) vec4f {
  let base = glyphCell(input.uv, 0.0);
  let jitter = floor(hash(base.id + floor(params.time * params.speed * 4.0)) * params.glyphCount);
  let cell = glyphCell(input.uv, jitter);
  let pulse = 0.65 + 0.35 * sin(params.time * params.speed * 2.0 + hash(base.id) * TAU);
  return glyphInk(cell, cell.alpha * pulse, darkBackground(cell));
}

@fragment
fn retroMatrixFragment(input: VertexOutput) -> @location(0) vec4f {
  let base = glyphCell(input.uv, floor(params.time * params.speed * 3.0 - input.uv.y * params.glyphCount));
  let amber = vec3f(1.0, 0.52, 0.08) * base.alpha * (0.55 + base.tone * 0.7);
  let scan = 0.82 + 0.18 * sin(input.uv.y * params.resolution.y * PI);
  return vec4f(mix(base.source.rgb, amber * scan, params.amount), base.source.a);
}

@fragment
fn pixelDitherFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = glyphCell(input.uv, floor(params.time * params.speed));
  let glow = smoothstep(0.05, 0.65, cell.alpha + (1.0 - length(cell.local - 0.5)) * 0.18);
  let neon = mix(params.colorA.rgb, params.colorB.rgb, cell.tone) * glow * 1.25;
  return vec4f(mix(cell.source.rgb, neon, params.amount), cell.source.a);
}

@fragment
fn brandGeneratorFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = glyphCell(input.uv, floor(length(input.uv - 0.5) * params.glyphCount));
  let frame = 1.0 - smoothstep(0.02, 0.05, min(min(input.uv.x, 1.0 - input.uv.x), min(input.uv.y, 1.0 - input.uv.y)));
  return glyphInk(cell, max(cell.alpha, frame), darkBackground(cell));
}

@fragment
fn uiCollageFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = glyphCell(input.uv, floor(params.time * params.speed + hash(floor(input.uv * 7.0)) * params.glyphCount));
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
