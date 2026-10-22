struct CatalogParams {
  resolution: vec2f,
  scale: f32,
  amount: f32,
  angle: f32,
  time: f32,
  speed: f32,
  variant: f32,
  colorA: vec4f,
  colorB: vec4f,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: CatalogParams;

fn source(uv: vec2f) -> vec4f {
  return textureSample(inputTex, texSampler, clamp(uv, vec2f(0.001), vec2f(0.999)));
}
fn toneAt(uv: vec2f) -> f32 {
  return luminance(source(uv).rgb);
}

@fragment
fn quadtreeZoomFragment(input: VertexOutput) -> @location(0) vec4f {
  let pixel = 1.0 / params.resolution;
  let detail = abs(toneAt(input.uv + vec2f(pixel.x, 0.0)) - toneAt(input.uv - vec2f(pixel.x, 0.0)))
    + abs(toneAt(input.uv + vec2f(0.0, pixel.y)) - toneAt(input.uv - vec2f(0.0, pixel.y)));
  let level = clamp(floor((1.0 - detail * 8.0) * 4.0 + sin(params.time * params.speed) * 0.5), 0.0, 4.0);
  let block = max(2.0, params.scale * pow(2.0, level - 2.0));
  let uv = (floor(input.uv * params.resolution / block) + 0.5) * block / params.resolution;
  let sampled = source(uv);
  let border = step(0.035, min(fract(input.uv.x * params.resolution.x / block), fract(input.uv.y * params.resolution.y / block)));
  return vec4f(mix(source(input.uv).rgb, sampled.rgb * (0.82 + border * 0.18), params.amount), sampled.a);
}

@fragment
fn contourFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  let bands = max(3.0, params.scale * 0.5);
  let contourLine = 1.0 - smoothstep(0.02, 0.11, abs(fract(luminance(color.rgb) * bands) - 0.5));
  return vec4f(mix(color.rgb, mix(params.colorB.rgb, params.colorA.rgb, contourLine), params.amount), color.a);
}

// Contour Map (geometryFragmentEffectGraphs.ts CONTOUR_MAP). The graph reads the tone through Smoothing (patternCellFilter.ts);
// this twin reads the pixel itself.
@fragment
fn contourMapFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  let levels = max(params.scale, 6.0) * 0.35;
  let texel = 1.0 / params.resolution;
  let height = luminance(color.rgb) * levels;
  let slope = max(length(vec2f(
    luminance(source(input.uv + vec2f(texel.x, 0.0)).rgb) - luminance(source(input.uv - vec2f(texel.x, 0.0)).rgb),
    luminance(source(input.uv + vec2f(0.0, texel.y)).rgb) - luminance(source(input.uv - vec2f(0.0, texel.y)).rgb)) * levels * 0.5), 1e-4);
  let nearest = floor(height + 0.5);
  // Line Width (variant slot) in 1080p pixels; a line under one pixel fades. No line at pure black or white.
  let width = max(params.variant, 0.0) * min(params.resolution.x, params.resolution.y) / 1080.0;
  let line = clamp(width * 0.5 + 0.5 - abs(height - nearest) / slope, 0.0, 1.0) * min(width, 1.0)
    * step(0.5, nearest) * step(nearest, levels - 0.5);
  let quantized = min(1.0, floor(height) / max(1.0, ceil(levels) - 1.0));
  // Fill (Angle slot): bands tinted from Paper (0) to the full Ink-to-Paper range (1).
  let band = mix(params.colorB.rgb, mix(params.colorA.rgb, params.colorB.rgb, quantized), clamp(params.angle, 0.0, 1.0));
  return vec4f(mix(color.rgb, mix(band, params.colorA.rgb, line), params.amount), color.a);
}

// Pattern sizes count pixels of a 1080p frame (shorter side), as the graphs do (patternReferenceFrame.ts).
fn referencePixels(size: f32) -> f32 {
  return max(size * (min(params.resolution.x, params.resolution.y) / 1080.0), 1.0);
}

// Vector Engraving (geometryFragmentEffectGraphs.ts ENGRAVING_LINE). The graph reads the tone from the picture
// averaged over half a line spacing (patternCellFilter.ts); this twin reads the pixel itself.
@fragment
fn vectorTilingFragment(input: VertexOutput) -> @location(0) vec4f {
  let angle = params.angle * PI / 180.0;
  let point = input.uv * params.resolution - params.resolution * 0.5;
  let turned = vec2f(point.x * cos(angle) - point.y * sin(angle), point.x * sin(angle) + point.y * cos(angle));
  let line = turned / referencePixels(max(params.scale, 3.0));
  let darkness = 1.0 - toneAt(input.uv);
  let across = line.y - sin(line.x * 2.1) * darkness * 0.3;
  // Line Weight (variant slot, 0-1): 0 keeps the fixed width, 1 swells each line from a hairline on white.
  let width = mix(0.0575, clamp(darkness * 0.46, 0.02, 0.46), clamp(params.variant, 0.0, 1.0));
  let engraving = 1.0 - smoothstep(width - 0.0325, width + 0.0325, abs(fract(across) - 0.5));
  let color = source(input.uv);
  return vec4f(mix(color.rgb, mix(params.colorB.rgb, params.colorA.rgb, engraving), params.amount), color.a);
}

// One Crosshatch line layer (geometryFragmentEffectGraphs.ts HATCH_LAYERS): drawn only where tone <= limit.
fn hatchLine(coordinate: f32, low: f32, high: f32, limit: f32, heavy: f32, tone: f32, weight: f32) -> f32 {
  let soft = (high - low) * 0.5;
  let width = mix((low + high) * 0.5, clamp((limit - tone) * (heavy / limit), 0.03, heavy), weight);
  return (1.0 - smoothstep(width - soft, width + soft, abs(fract(coordinate) - 0.5))) * step(tone, limit);
}

@fragment
fn crosshatchFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  let tone = luminance(color.rgb);
  let pixel = input.uv * params.resolution / referencePixels(max(params.scale, 2.0));
  // Line Weight (variant slot, 0-1): 0 keeps the fixed widths, 1 swells each line from a hairline at its tone limit.
  let weight = clamp(params.variant, 0.0, 1.0);
  let first = hatchLine(pixel.x + pixel.y, 0.06, 0.15, 0.82, 0.36, tone, weight);
  let second = hatchLine(pixel.x - pixel.y, 0.06, 0.15, 0.58, 0.36, tone, weight);
  let third = hatchLine(pixel.x * 0.5, 0.05, 0.13, 0.32, 0.3, tone, weight);
  let hatch = max(first, max(second, third));
  return vec4f(mix(color.rgb, mix(params.colorB.rgb, params.colorA.rgb, hatch), params.amount), color.a);
}

@fragment
fn embroideryFragment(input: VertexOutput) -> @location(0) vec4f {
  let grid = params.resolution / referencePixels(max(params.scale, 3.0));
  let cell = fract(input.uv * grid) - 0.5;
  let wave = sin(cell.x * TAU + params.time * params.speed * 2.0) * 0.16;
  let thread = 1.0 - smoothstep(0.04, 0.12, abs(cell.y - wave));
  let color = source(input.uv);
  let fiber = mix(params.colorA.rgb, color.rgb, 0.65) * (0.72 + thread * 0.38);
  return vec4f(mix(color.rgb, fiber, params.amount), color.a);
}

@fragment
fn kilimFragment(input: VertexOutput) -> @location(0) vec4f {
  let grid = input.uv * params.resolution / referencePixels(max(params.scale, 4.0));
  let cell = fract(grid) - 0.5;
  let diamond = step(abs(cell.x) + abs(cell.y), 0.38 + 0.12 * sin(floor(grid.y) * 1.7));
  let stripe = step(0.5, fract(floor(grid.x) * 0.5 + floor(grid.y) * 0.25));
  let textile = mix(params.colorA.rgb, params.colorB.rgb, abs(diamond - stripe));
  let color = source(input.uv);
  return vec4f(mix(color.rgb, textile * (0.6 + 0.4 * luminance(color.rgb)), params.amount), color.a);
}

@fragment
fn outlineFragment(input: VertexOutput) -> @location(0) vec4f {
  let pixel = referencePixels(1.0) / params.resolution;
  let horizontal = toneAt(input.uv + vec2f(pixel.x, 0.0)) - toneAt(input.uv - vec2f(pixel.x, 0.0));
  let vertical = toneAt(input.uv + vec2f(0.0, pixel.y)) - toneAt(input.uv - vec2f(0.0, pixel.y));
  let edge = smoothstep(0.04, 0.24, length(vec2f(horizontal, vertical)) * (1.0 + 0.25 * sin(params.time * params.speed)));
  let color = source(input.uv);
  return vec4f(mix(color.rgb, mix(params.colorB.rgb, params.colorA.rgb, edge), params.amount), color.a);
}

@fragment
fn bricksFragment(input: VertexOutput) -> @location(0) vec4f {
  let brickSize = referencePixels(max(params.scale, 5.0));
  var grid = input.uv * params.resolution / vec2f(brickSize * 1.6, brickSize);
  grid.x += floor(grid.y) * 0.5;
  let id = floor(grid);
  let local = fract(grid);
  let sampleUv = (vec2f(id.x - floor(id.y) * 0.5, id.y) + 0.5) * vec2f(brickSize * 1.6, brickSize) / params.resolution;
  let color = source(sampleUv);
  let height = luminance(color.rgb);
  let bevel = min(min(local.x, 1.0 - local.x), min(local.y, 1.0 - local.y));
  let light = 0.58 + smoothstep(0.0, 0.16, bevel) * 0.52 + height * 0.18;
  let pulse = 1.0 + 0.04 * sin(params.time * params.speed + hash(id) * TAU);
  return vec4f(mix(source(input.uv).rgb, color.rgb * light * pulse, params.amount), color.a);
}
