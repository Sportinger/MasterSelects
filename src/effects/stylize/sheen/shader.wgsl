// Sheen: a soft specular band sweeping across the layer, limited to its alpha.

struct SheenParams {
  position: f32,
  angle: f32,
  width: f32,
  softness: f32,
  intensity: f32,
  aspect: f32,
  _pad0: f32,
  _pad1: f32,
  color: vec4f,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: SheenParams;

@fragment
fn sheenFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  // Aspect-correct coordinates so the band keeps its angle on wide layers.
  let centered = (input.uv - vec2f(0.5)) * vec2f(params.aspect, 1.0);
  let radians = params.angle * 0.017453292;
  let direction = vec2f(cos(radians), sin(radians));
  // Project onto the sweep direction and normalize by the layer's extent along it.
  let extent = 0.5 * (abs(direction.x) * params.aspect + abs(direction.y));
  let along = dot(centered, direction) / max(extent, 1e-4);
  // position 0..1 sweeps the band from fully outside one side to fully outside the other.
  let center = mix(-1.0 - params.width, 1.0 + params.width, params.position);
  let halfWidth = max(params.width, 1e-4);
  let hard = halfWidth * (1.0 - clamp(params.softness, 0.0, 1.0));
  let band = 1.0 - smoothstep(hard, halfWidth, abs(along - center));
  let light = params.color.rgb * band * params.intensity * params.color.a * color.a;
  return vec4f(color.rgb + light, color.a);
}
