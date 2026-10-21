// Mirror: WGSL reference of the editable graph (services/operators/mirrorRecipes.ts).

struct MirrorParams {
  horizontal: f32,  // 1: mirror across the (turned) vertical line
  vertical: f32,    // 1: mirror across the (turned) horizontal line
  keepEnd: f32,     // 0 keeps the left / top side, 1 the right / bottom side
  angle: f32,       // radians
  centerX: f32,
  centerY: f32,
  edges: f32,
  _p0: f32,
  width: f32,
  height: f32,
  _p1: f32,
  _p2: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: MirrorParams;

fn mirrorRotate(value: vec2f, angle: f32) -> vec2f {
  let s = sin(angle);
  let c = cos(angle);
  return vec2f(value.x * c - value.y * s, value.x * s + value.y * c);
}

@fragment
fn mirrorFragment(input: VertexOutput) -> @location(0) vec4f {
  let resolution = vec2f(params.width, params.height);
  let center = vec2f(params.centerX, params.centerY);
  let scale = distortShapeScale(0.0, resolution);
  let angle = params.angle;
  var local = mirrorRotate((input.uv - center) * scale, -angle);
  let keepSign = select(-1.0, 1.0, params.keepEnd > 0.5);
  if (params.horizontal > 0.5) { local.x = abs(local.x) * keepSign; }
  if (params.vertical > 0.5) { local.y = abs(local.y) * keepSign; }
  return distortSampleEdges(inputTex, texSampler, center + mirrorRotate(local, angle) / scale, params.edges, resolution);
}
