// Color Wheel: HSV hue/saturation wheel. Fill Layer keeps it inside the layer's alpha (use on an
// ellipse or solid); Disc draws an anti-aliased wheel over the layer (a Blank clip shows only it).

struct ColorWheelParams {
  // Hue at angle 0, in turns: Hue Rotation + Spin × time, wrapped on the CPU.
  hueOffset: f32,
  saturation: f32,
  value: f32,
  mixAmount: f32,
  aspect: f32,
  // 0 = fill layer, 1 = disc
  shape: f32,
  // Output pixels across the shorter frame side (the disc's diameter).
  shortSide: f32,
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

@fragment
fn colorWheelFragment(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSample(inputTex, texSampler, input.uv);
  // Square, centered polar coordinates: radius 0.5 reaches the shorter layer edge.
  var centered = input.uv - vec2f(0.5);
  if (params.aspect >= 1.0) { centered.x = centered.x * params.aspect; } else { centered.y = centered.y / params.aspect; }
  let radius = length(centered);
  let angle = atan2(centered.y, centered.x);
  let hue = fract(angle * 0.15915494 + params.hueOffset);
  let saturation = clamp(radius * 2.0 * params.saturation, 0.0, 1.0);
  let wheel = hsvToRgb(vec3f(hue, saturation, params.value));
  let amount = clamp(params.mixAmount, 0.0, 1.0);
  if (params.shape < 0.5) {
    return vec4f(mix(source.rgb, wheel, amount), source.a);
  }
  // One output pixel of anti-aliasing on the rim, at any resolution.
  let coverage = clamp((0.5 - radius) * params.shortSide + 0.5, 0.0, 1.0) * amount;
  let outAlpha = coverage + source.a * (1.0 - coverage);
  let rgb = (wheel * coverage + source.rgb * source.a * (1.0 - coverage)) / max(outAlpha, 1e-5);
  return vec4f(rgb, outAlpha);
}
