// Color Wheel: HSV hue/saturation wheel. Disc draws an anti-aliased wheel over the layer (a Blank
// clip shows only it); Fill Layer colours the whole layer inside its alpha (use on an ellipse or
// solid). The scalar helpers run unchanged on the CPU in tests/unit/generateShaderMath.test.ts.

struct ColorWheelParams {
  // Hue at angle 0, in turns: Hue Rotation + Spin × time, wrapped on the CPU.
  hueOffset: f32,
  saturation: f32,
  value: f32,
  mixAmount: f32,
  aspect: f32,
  // 0 = fill layer, 1 = disc
  shape: f32,
  // Output pixels across the shorter frame side.
  shortSide: f32,
  // Rim radius as a share of the shorter side (0.5 reaches its edges).
  radius: f32,
  // Wheel centre in the layer (0..1 across and down).
  centerX: f32,
  centerY: f32,
  // 1 = hue runs counter-clockwise on screen (as HSV wheels), 0 = clockwise (wheels saved before Direction).
  counterClockwise: f32,
  _pad: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: ColorWheelParams;

fn hsvToRgb(hsv: vec3f) -> vec3f {
  let k = vec3f(1.0, 2.0 / 3.0, 1.0 / 3.0);
  let p = abs(fract(vec3f(hsv.x) + k) * 6.0 - vec3f(3.0));
  return hsv.z * mix(vec3f(1.0), clamp(p - vec3f(1.0), vec3f(0.0), vec3f(1.0)), hsv.y);
}

// Hue (turns) at offset (x, y) from the centre, y pointing down the screen.
fn colorWheelHue(x: f32, y: f32, counterClockwise: f32, hueOffset: f32) -> f32 {
  let angle = atan2(select(y, -y, counterClockwise > 0.5), x);
  return fract(angle * 0.15915494 + hueOffset);
}

// Disc coverage at `distance` from the centre (shares of the shorter side): one output pixel of
// anti-aliasing on the rim at any resolution.
fn colorWheelDiscCoverage(distance: f32, rimRadius: f32, shortSide: f32) -> f32 {
  return clamp((rimRadius - distance) * shortSide + 0.5, 0.0, 1.0);
}

// Straight-alpha "over": one colour channel of `top` at coverage `topAlpha` above `under`.
fn straightOverChannel(top: f32, topAlpha: f32, under: f32, underAlpha: f32) -> f32 {
  let outAlpha = topAlpha + underAlpha * (1.0 - topAlpha);
  return (top * topAlpha + under * underAlpha * (1.0 - topAlpha)) / max(outAlpha, 1e-5);
}

@fragment
fn colorWheelFragment(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSample(inputTex, texSampler, input.uv);
  // Square polar coordinates in shares of the shorter side, around the chosen centre.
  var centered = input.uv - vec2f(params.centerX, params.centerY);
  if (params.aspect >= 1.0) { centered.x = centered.x * params.aspect; } else { centered.y = centered.y / params.aspect; }
  let radius = length(centered);
  let hue = colorWheelHue(centered.x, centered.y, params.counterClockwise, params.hueOffset);
  // Full colour at the rim (with Saturation 1).
  let saturation = clamp(radius / params.radius * params.saturation, 0.0, 1.0);
  let wheel = hsvToRgb(vec3f(hue, saturation, params.value));
  let amount = clamp(params.mixAmount, 0.0, 1.0);
  if (params.shape < 0.5) {
    return vec4f(mix(source.rgb, wheel, amount), source.a);
  }
  let coverage = colorWheelDiscCoverage(radius, params.radius, params.shortSide) * amount;
  let outAlpha = coverage + source.a * (1.0 - coverage);
  let rgb = vec3f(straightOverChannel(wheel.r, coverage, source.r, source.a),
    straightOverChannel(wheel.g, coverage, source.g, source.a), straightOverChannel(wheel.b, coverage, source.b, source.a));
  return vec4f(rgb, outAlpha);
}
