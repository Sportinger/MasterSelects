struct GuidedPerspectiveParams { row0: vec4f, row1: vec4f, row2: vec4f, controls: vec4f };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: GuidedPerspectiveParams;
@fragment
fn guidedPerspectiveFragment(input: VertexOutput) -> @location(0) vec4f {
  let outputUv = (input.uv - 0.5) / params.controls.x + 0.5;
  let point = vec3f(outputUv, 1.0);
  let w = dot(params.row2.xyz, point);
  let safeW = select(-1.0, 1.0, w >= 0.0) * max(abs(w), 0.00001);
  let sourceUv = mix(outputUv, vec2f(dot(params.row0.xyz, point), dot(params.row1.xyz, point)) / safeW, params.controls.y);
  let visible = abs(w) > 0.00001 && all(sourceUv >= vec2f(0.0)) && all(sourceUv <= vec2f(1.0));
  return textureSampleLevel(inputTex, texSampler, sourceUv, 0.0) * select(0.0, 1.0, visible);
}
