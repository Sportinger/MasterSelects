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

fn rotated(uv: vec2f) -> vec2f {
  let a = params.angle * PI / 180.0;
  let p = uv - 0.5;
  return vec2f(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a)) + 0.5;
}

fn bayer4(pixel: vec2f) -> f32 {
  let table = array<f32, 16>(
    0.0, 8.0, 2.0, 10.0,
    12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0,
    15.0, 7.0, 13.0, 5.0
  );
  let x = u32(max(0.0, floor(pixel.x))) % 4u;
  let y = u32(max(0.0, floor(pixel.y))) % 4u;
  return (table[y * 4u + x] + 0.5) / 16.0;
}

fn inkMix(tone: f32, pattern: f32, alpha: f32) -> vec4f {
  let threshold = mix(tone, pattern, params.amount);
  return vec4f(mix(params.colorA.rgb, params.colorB.rgb, step(0.5, threshold)), alpha);
}

@fragment
fn ditherFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  let threshold = bayer4(input.uv * params.resolution / max(params.scale, 1.0));
  let quantized = floor(clamp(color.rgb + threshold - 0.5, vec3f(0.0), vec3f(0.999)) * 4.0) / 3.0;
  return vec4f(mix(color.rgb, quantized, params.amount), color.a);
}

@fragment
fn ditherStudioFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  var threshold = bayer4(input.uv * params.resolution / max(params.scale * 0.35, 1.0));
  if (params.variant < 0.5) { threshold = fract(dot(floor(input.uv * params.resolution), vec2f(0.5, 0.75))); }
  if (params.variant > 1.5) { threshold = select(0.25, 0.75, fract(input.uv.x * params.resolution.x / params.scale) > 0.5); }
  let bit = step(threshold, luminance(color.rgb));
  return vec4f(mix(color.rgb, mix(params.colorA.rgb, params.colorB.rgb, bit), params.amount), color.a);
}

@fragment
fn halftoneFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = rotated(input.uv);
  let cells = max(params.scale, 2.0);
  let cell = fract(uv * params.resolution / cells) - 0.5;
  let tone = luminance(source(input.uv).rgb);
  let dotRadius = sqrt(max(0.0, 1.0 - tone)) * 0.68;
  let ink = 1.0 - smoothstep(dotRadius - 0.06, dotRadius + 0.06, length(cell));
  let original = source(input.uv);
  return vec4f(mix(original.rgb, mix(params.colorB.rgb, params.colorA.rgb, ink), params.amount), original.a);
}

@fragment
fn patternHalftoneFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = fract(rotated(input.uv) * params.resolution / max(params.scale, 2.0)) - 0.5;
  let color = source(input.uv);
  let radius = (1.0 - luminance(color.rgb)) * 0.72;
  var distance = length(cell);
  if (params.variant > 0.5 && params.variant < 1.5) { distance = abs(cell.x) + abs(cell.y); }
  if (params.variant > 1.5) { distance = abs(cell.y); }
  let mark = 1.0 - smoothstep(radius - 0.04, radius + 0.04, distance);
  return vec4f(mix(color.rgb, mix(params.colorB.rgb, params.colorA.rgb, mark), params.amount), color.a);
}

fn risoColor(uv: vec2f, glow: f32) -> vec3f {
  let offset = vec2f(params.scale / params.resolution.x, 0.0) * 0.35;
  let a = 1.0 - luminance(source(uv - offset).rgb);
  let b = 1.0 - luminance(source(uv + offset).rgb);
  let paper = vec3f(0.96, 0.93, 0.85);
  let subtractive = paper * (1.0 - a * params.colorA.rgb) * (1.0 - b * params.colorB.rgb);
  return subtractive + glow * (a * params.colorA.rgb + b * params.colorB.rgb) * 0.3;
}

@fragment
fn risoFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  return vec4f(mix(color.rgb, risoColor(input.uv, 0.0), params.amount), color.a);
}

@fragment
fn risoGlowFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  let pulse = 0.55 + 0.45 * sin(params.time * params.speed * 2.0);
  return vec4f(mix(color.rgb, risoColor(input.uv, pulse), params.amount), color.a);
}

@fragment
fn paperPrintFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  let pixel = floor(input.uv * params.resolution);
  let grain = noise2d(pixel / max(params.scale, 1.0)) - 0.5;
  let pressed = smoothstep(0.15, 0.85, luminance(color.rgb) + grain * 0.3);
  let printColor = mix(params.colorA.rgb, params.colorB.rgb, pressed) * (0.92 + grain * 0.08);
  return vec4f(mix(color.rgb, printColor, params.amount), color.a);
}

@fragment
fn pixelPosterFragment(input: VertexOutput) -> @location(0) vec4f {
  let grid = max(params.scale, 2.0);
  let uv = (floor(input.uv * params.resolution / grid) + 0.5) * grid / params.resolution;
  let color = source(uv);
  let poster = floor(color.rgb * 5.0) / 4.0;
  return vec4f(mix(color.rgb, poster, params.amount), color.a);
}

@fragment
fn toneGeometryFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = rotated(input.uv + vec2f(sin(params.time * params.speed) * 0.002, 0.0));
  let cell = fract(uv * params.resolution / max(params.scale, 3.0)) - 0.5;
  let color = source(input.uv);
  let size = (1.0 - luminance(color.rgb)) * 0.65;
  var dist = max(abs(cell.x), abs(cell.y));
  if (params.variant > 0.5 && params.variant < 1.5) { dist = length(cell); }
  if (params.variant > 1.5) { dist = max(abs(cell.x), cell.y * 0.75 - 0.15); }
  let shape = 1.0 - smoothstep(size - 0.04, size + 0.04, dist);
  return vec4f(mix(color.rgb, mix(params.colorB.rgb, params.colorA.rgb, shape), params.amount), color.a);
}

@fragment
fn crossStitchFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = fract(input.uv * params.resolution / max(params.scale, 3.0)) - 0.5;
  let color = source(input.uv);
  let line = min(abs(cell.x - cell.y), abs(cell.x + cell.y));
  let stitch = (1.0 - smoothstep(0.04, 0.1, line)) * step(length(cell), 0.62);
  let ink = mix(params.colorB.rgb, color.rgb * params.colorA.rgb, stitch);
  return vec4f(mix(color.rgb, ink, params.amount), color.a);
}

@fragment
fn glitchGridFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = floor(input.uv * params.resolution / max(params.scale, 2.0));
  let tick = floor(params.time * params.speed * 8.0);
  let jump = (hash(cell + tick) - 0.5) * params.amount;
  let enabledCell = step(0.82, hash(vec2f(cell.y, tick)));
  let uv = input.uv + vec2f(jump * enabledCell * 0.12, 0.0);
  return source(uv);
}

@fragment
fn scatterMosaicFragment(input: VertexOutput) -> @location(0) vec4f {
  let grid = max(params.scale, 3.0);
  let cell = floor(input.uv * params.resolution / grid);
  let jitter = vec2f(hash(cell), hash(cell + 17.0)) - 0.5;
  let drift = sin(params.time * params.speed + hash(cell) * TAU);
  let uv = (cell + 0.5 + jitter * params.amount * drift) * grid / params.resolution;
  return source(uv);
}

@fragment
fn driftLinesFragment(input: VertexOutput) -> @location(0) vec4f {
  let row = floor(input.uv.y * params.resolution.y / max(params.scale, 2.0));
  let shift = sin(row * 0.71 + params.time * params.speed * 2.0) * params.amount * 0.06;
  let sampled = source(input.uv + vec2f(shift, 0.0));
  let line = 0.82 + 0.18 * sin(input.uv.y * params.resolution.y * PI / max(params.scale, 2.0));
  return vec4f(sampled.rgb * line, sampled.a);
}
