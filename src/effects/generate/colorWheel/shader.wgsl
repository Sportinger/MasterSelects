// Color Wheel: HSV hue/saturation wheel inside the layer's alpha (use on an ellipse or solid).

struct ColorWheelParams {
  rotation: f32,
  spin: f32,
  saturation: f32,
  value: f32,
  mixAmount: f32,
  aspect: f32,
  time: f32,
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
  let hue = fract(angle * 0.15915494 + params.rotation + params.spin * params.time);
  let saturation = clamp(radius * 2.0 * params.saturation, 0.0, 1.0);
  let wheel = hsvToRgb(vec3f(hue, saturation, params.value));
  return vec4f(mix(source.rgb, wheel, clamp(params.mixAmount, 0.0, 1.0)), source.a);
}
