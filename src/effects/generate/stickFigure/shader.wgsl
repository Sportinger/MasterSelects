// Stick Figure: capsules between CPU-solved joints plus a round head, drawn over the input.

struct StickFigureParams {
  // output width/height, limb radius, head radius (output pixels)
  size: vec4f,
  color: vec4f,
  // opacity, unused
  style: vec4f,
  // Twelve joints in output pixels (see SKELETON_JOINTS), two per vec4.
  joints: array<vec4f, 6>,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: StickFigureParams;

fn stickFigureJoint(index: u32) -> vec2f {
  let packed = params.joints[index / 2u];
  return select(packed.zw, packed.xy, index % 2u == 0u);
}

fn stickFigureCapsule(point: vec2f, a: vec2f, b: vec2f, radius: f32) -> f32 {
  let pa = point - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h) - radius;
}

@fragment
fn stickFigureFragment(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSample(inputTex, texSampler, input.uv);
  let point = input.uv * params.size.xy;
  // Order matches SKELETON_SEGMENTS: torso, neck, arms, legs.
  var segments = array<vec2u, 10>(
    vec2u(0u, 1u), vec2u(1u, 2u), vec2u(1u, 4u), vec2u(4u, 5u), vec2u(1u, 6u),
    vec2u(6u, 7u), vec2u(0u, 8u), vec2u(8u, 9u), vec2u(0u, 10u), vec2u(10u, 11u)
  );
  var distance = length(point - stickFigureJoint(3u)) - params.size.w;
  for (var index = 0u; index < 10u; index = index + 1u) {
    let segment = segments[index];
    distance = min(distance, stickFigureCapsule(point, stickFigureJoint(segment.x), stickFigureJoint(segment.y), params.size.z));
  }
  let coverage = clamp(0.5 - distance, 0.0, 1.0);
  // Straight-alpha "over" so a transparent Blank clip shows only the figure.
  let alpha = coverage * params.color.a * clamp(params.style.x, 0.0, 1.0);
  let outAlpha = alpha + source.a * (1.0 - alpha);
  let rgb = (params.color.rgb * alpha + source.rgb * source.a * (1.0 - alpha)) / max(outAlpha, 1e-5);
  return vec4f(rgb, outAlpha);
}
