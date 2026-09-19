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

@fragment
fn glitchFragment(input: VertexOutput) -> @location(0) vec4f {
  let tick = floor(params.time * params.speed * 12.0);
  let band = floor(input.uv.y * max(params.scale, 4.0));
  let enabledBand = step(0.76, hash(vec2f(band, tick)));
  let shift = (hash(vec2f(tick, band + 3.0)) - 0.5) * params.amount * enabledBand * 0.16;
  let r = source(input.uv + vec2f(shift + 0.004 * params.amount, 0.0)).r;
  let g = source(input.uv + vec2f(shift, 0.0)).g;
  let b = source(input.uv + vec2f(shift - 0.004 * params.amount, 0.0)).b;
  return vec4f(r, g, b, source(input.uv).a);
}

@fragment
fn crystalFragment(input: VertexOutput) -> @location(0) vec4f {
  let cells = max(params.scale, 4.0);
  let id = floor(input.uv * cells);
  let local = fract(input.uv * cells) - 0.5;
  let facet = normalize(vec2f(hash(id) - 0.5, hash(id + 13.7) - 0.5) + vec2f(0.001));
  let refraction = facet * dot(local, facet) * params.amount * 0.08;
  let shimmer = sin(params.time * params.speed + hash(id) * TAU) * 0.003;
  return source(input.uv + refraction + shimmer);
}

@fragment
fn glassDispersionFragment(input: VertexOutput) -> @location(0) vec4f {
  let grid = max(params.scale, 4.0);
  let cell = floor(input.uv * params.resolution / grid);
  let direction = normalize(vec2f(hash(cell) - 0.5, hash(cell + 31.0) - 0.5) + vec2f(0.001));
  let pulse = 0.6 + 0.4 * sin(params.time * params.speed + hash(cell) * TAU);
  let offset = direction * params.amount * pulse * 0.025;
  return vec4f(source(input.uv + offset).r, source(input.uv).g, source(input.uv - offset).b, source(input.uv).a);
}

@fragment
fn ribbonScanFragment(input: VertexOutput) -> @location(0) vec4f {
  let phase = fract(input.uv.y * max(params.scale, 3.0) - params.time * params.speed);
  let ribbon = smoothstep(0.0, 0.18, phase) * (1.0 - smoothstep(0.62, 1.0, phase));
  let shift = sin(phase * TAU) * params.amount * 0.08 * ribbon;
  let color = source(input.uv + vec2f(shift, 0.0));
  return vec4f(mix(source(input.uv).rgb, color.rgb, ribbon), color.a);
}

@fragment
fn crtScreenFragment(input: VertexOutput) -> @location(0) vec4f {
  let p = input.uv * 2.0 - 1.0;
  let curved = p * (1.0 + dot(p, p) * 0.08 * params.amount) * 0.5 + 0.5;
  let color = source(curved);
  let scan = 0.78 + 0.22 * sin(input.uv.y * params.resolution.y * PI);
  let maskPhase = u32(floor(input.uv.x * params.resolution.x / max(params.scale, 1.0))) % 3u;
  let mask = select(select(vec3f(0.75, 0.92, 0.75), vec3f(0.75, 0.75, 0.92), maskPhase == 2u), vec3f(0.92, 0.75, 0.75), maskPhase == 0u);
  let flicker = 0.98 + 0.02 * sin(params.time * params.speed * 50.0);
  return vec4f(mix(color.rgb, color.rgb * mask * scan * flicker, params.amount), color.a);
}

@fragment
fn filmPrismFragment(input: VertexOutput) -> @location(0) vec4f {
  let center = input.uv - 0.5;
  let radial = center * params.amount * (0.012 + 0.005 * sin(params.time * params.speed));
  let grain = (noise2d(input.uv * params.resolution + params.time) - 0.5) * 0.035;
  return vec4f(source(input.uv + radial).r + grain, source(input.uv).g + grain, source(input.uv - radial).b + grain, source(input.uv).a);
}

@fragment
fn waveLinesFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  let tone = luminance(color.rgb);
  let frequency = max(params.scale, 3.0) * 3.0;
  let wave = sin(input.uv.x * frequency + params.time * params.speed * 3.0 + tone * TAU);
  let line = 1.0 - smoothstep(0.05, 0.2, abs(fract(input.uv.y * frequency + wave * params.amount) - 0.5));
  return vec4f(mix(color.rgb, mix(params.colorB.rgb, params.colorA.rgb, line), params.amount), color.a);
}

@fragment
fn holoFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  let phase = input.uv.x * 12.0 + input.uv.y * 19.0 + params.time * params.speed * 2.0;
  let interference = 0.5 + 0.5 * sin(phase + sin(phase * 0.37) * 3.0);
  let spectrum = mix(params.colorA.rgb, params.colorB.rgb, interference);
  let edge = length(vec2f(dpdx(luminance(color.rgb)), dpdy(luminance(color.rgb)))) * 8.0;
  return vec4f(mix(color.rgb, color.rgb * 0.55 + spectrum * (0.3 + edge), params.amount), color.a);
}
