// Levels Effect Shader

struct LevelsParams {
  inputBlack: f32,
  inputWhite: f32,
  gamma: f32,
  outputBlack: f32,
  outputWhite: f32,
  _p1: f32,
  _p2: f32,
  _p3: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: LevelsParams;

@fragment
fn levelsFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);

  // Remap input range
  var adjusted = (color.rgb - vec3f(params.inputBlack)) /
                 (params.inputWhite - params.inputBlack);
  adjusted = clamp(adjusted, vec3f(0.0), vec3f(1.0));

  // Apply gamma
  adjusted = pow(adjusted, vec3f(1.0 / params.gamma));

  // Remap to output range
  adjusted = mix(vec3f(params.outputBlack), vec3f(params.outputWhite), adjusted);

  return vec4f(adjusted, color.a);
}
