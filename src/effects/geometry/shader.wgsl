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

fn rotatedGeometry(uv: vec2f) -> vec2f {
  let angle = params.angle * PI / 180.0;
  let point = uv - 0.5;
  return vec2f(point.x * cos(angle) - point.y * sin(angle), point.x * sin(angle) + point.y * cos(angle)) + 0.5;
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

@fragment
fn contourMapFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  let levels = max(3.0, params.scale * 0.35);
  let quantized = floor(luminance(color.rgb) * levels) / max(1.0, levels - 1.0);
  let bandColor = mix(params.colorA.rgb, params.colorB.rgb, quantized);
  let line = 1.0 - smoothstep(0.02, 0.09, abs(fract(luminance(color.rgb) * levels) - 0.5));
  return vec4f(mix(color.rgb, bandColor * (0.72 + line * 0.28), params.amount), color.a);
}

@fragment
fn vectorTilingFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = rotatedGeometry(input.uv);
  let grid = params.resolution / max(params.scale, 3.0);
  let cell = fract(uv * grid) - 0.5;
  let tone = toneAt((floor(uv * grid) + 0.5) / grid);
  let engraving = 1.0 - smoothstep(0.025, 0.09, abs(cell.y - sin(cell.x * 10.0) * (1.0 - tone) * 0.18));
  let color = source(input.uv);
  return vec4f(mix(color.rgb, mix(params.colorB.rgb, params.colorA.rgb, engraving), params.amount), color.a);
}

@fragment
fn crosshatchFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  let tone = luminance(color.rgb);
  let pixel = input.uv * params.resolution / max(params.scale, 2.0);
  let first = 1.0 - smoothstep(0.06, 0.15, abs(fract(pixel.x + pixel.y) - 0.5));
  let second = 1.0 - smoothstep(0.06, 0.15, abs(fract(pixel.x - pixel.y) - 0.5));
  let third = 1.0 - smoothstep(0.05, 0.13, abs(fract(pixel.x * 0.5) - 0.5));
  let hatch = max(first * step(tone, 0.82), max(second * step(tone, 0.58), third * step(tone, 0.32)));
  return vec4f(mix(color.rgb, mix(params.colorB.rgb, params.colorA.rgb, hatch), params.amount), color.a);
}

@fragment
fn embroideryFragment(input: VertexOutput) -> @location(0) vec4f {
  let grid = params.resolution / max(params.scale, 3.0);
  let cell = fract(input.uv * grid) - 0.5;
  let wave = sin(cell.x * TAU + params.time * params.speed * 2.0) * 0.16;
  let thread = 1.0 - smoothstep(0.04, 0.12, abs(cell.y - wave));
  let color = source(input.uv);
  let fiber = mix(params.colorA.rgb, color.rgb, 0.65) * (0.72 + thread * 0.38);
  return vec4f(mix(color.rgb, fiber, params.amount), color.a);
}

@fragment
fn kilimFragment(input: VertexOutput) -> @location(0) vec4f {
  let grid = input.uv * params.resolution / max(params.scale, 4.0);
  let cell = fract(grid) - 0.5;
  let diamond = step(abs(cell.x) + abs(cell.y), 0.38 + 0.12 * sin(floor(grid.y) * 1.7));
  let stripe = step(0.5, fract(floor(grid.x) * 0.5 + floor(grid.y) * 0.25));
  let textile = mix(params.colorA.rgb, params.colorB.rgb, abs(diamond - stripe));
  let color = source(input.uv);
  return vec4f(mix(color.rgb, textile * (0.6 + 0.4 * luminance(color.rgb)), params.amount), color.a);
}

@fragment
fn outlineFragment(input: VertexOutput) -> @location(0) vec4f {
  let pixel = 1.0 / params.resolution;
  let horizontal = toneAt(input.uv + vec2f(pixel.x, 0.0)) - toneAt(input.uv - vec2f(pixel.x, 0.0));
  let vertical = toneAt(input.uv + vec2f(0.0, pixel.y)) - toneAt(input.uv - vec2f(0.0, pixel.y));
  let edge = smoothstep(0.04, 0.24, length(vec2f(horizontal, vertical)) * (1.0 + 0.25 * sin(params.time * params.speed)));
  let color = source(input.uv);
  return vec4f(mix(color.rgb, mix(params.colorB.rgb, params.colorA.rgb, edge), params.amount), color.a);
}

@fragment
fn bricksFragment(input: VertexOutput) -> @location(0) vec4f {
  let brickSize = max(params.scale, 5.0);
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
