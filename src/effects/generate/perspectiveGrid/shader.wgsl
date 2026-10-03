// Perspective Grid: vanishing-point floor grid that scrolls toward the viewer.

struct PerspectiveGridParams {
  horizon: f32,
  columns: f32,
  rows: f32,
  speed: f32,
  lineWidth: f32,
  fade: f32,
  opacity: f32,
  time: f32,
  color: vec4f,
  offset: f32,
  aspect: f32,
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: PerspectiveGridParams;

fn gridLine(value: f32, width: f32) -> f32 {
  let distance = abs(fract(value + 0.5) - 0.5);
  let feather = max(fwidth(value), 1e-4);
  return 1.0 - smoothstep(width * feather, (width + 1.0) * feather, distance);
}

@fragment
fn perspectiveGridFragment(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSample(inputTex, texSampler, input.uv);
  let horizon = clamp(params.horizon, 0.0, 0.98);
  // Depth along the floor: 0 at the horizon, 1 at the bottom edge.
  let depth = (input.uv.y - horizon) / max(1.0 - horizon, 1e-4);
  let below = step(0.0, depth);
  let z = max(depth, 1e-3);
  // Perspective division: `columns` lines cross the bottom edge and converge at the vanishing point;
  // rows sit at constant floor spacing, so they crowd toward the horizon and scroll toward the viewer.
  let across = (input.uv.x - 0.5) / z * params.columns;
  let forward = params.rows / z + params.speed * params.time + params.offset;
  let lines = max(gridLine(across, params.lineWidth), gridLine(forward, params.lineWidth));
  let fadeIn = pow(clamp(depth, 0.0, 1.0), max(params.fade, 0.01));
  let amount = lines * fadeIn * below * clamp(params.opacity, 0.0, 1.0) * params.color.a;
  let rgb = source.rgb + params.color.rgb * amount;
  return vec4f(rgb, max(source.a, amount));
}
