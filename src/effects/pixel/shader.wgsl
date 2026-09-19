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
fn blockifyFragment(input: VertexOutput) -> @location(0) vec4f {
  let block = max(params.scale, 2.0);
  let uv = (floor(input.uv * params.resolution / block) + 0.5) * block / params.resolution;
  let sampled = source(uv);
  let poster = floor(sampled.rgb * 8.0) / 7.0;
  return vec4f(mix(source(input.uv).rgb, poster, params.amount), sampled.a);
}

@fragment
fn blockMosaicFragment(input: VertexOutput) -> @location(0) vec4f {
  let base = max(params.scale, 4.0);
  let coarseCell = floor(input.uv * params.resolution / base);
  let sizeMultiplier = select(1.0, 2.0, hash(coarseCell + floor(params.time * params.speed)) > 0.68);
  let block = base * sizeMultiplier;
  let uv = (floor(input.uv * params.resolution / block) + 0.5) * block / params.resolution;
  let sampled = source(uv);
  let border = step(0.04, min(fract(input.uv.x * params.resolution.x / block), fract(input.uv.y * params.resolution.y / block)));
  let mosaic = mix(params.colorA.rgb * 0.35, sampled.rgb, border);
  return vec4f(mix(source(input.uv).rgb, mosaic, params.amount), sampled.a);
}
