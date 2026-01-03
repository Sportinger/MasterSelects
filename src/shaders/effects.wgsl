// Effect shaders for WebVJ Mixer

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0)
  );

  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0),
    vec2f(1.0, 1.0),
    vec2f(0.0, 0.0),
    vec2f(0.0, 0.0),
    vec2f(1.0, 1.0),
    vec2f(1.0, 0.0)
  );

  var output: VertexOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  output.uv = uvs[vertexIndex];
  return output;
}

// ==================== HUE SHIFT ====================
struct HueShiftParams {
  shift: f32,
  _p1: f32,
  _p2: f32,
  _p3: f32,
};

@group(0) @binding(0) var hsSampler: sampler;
@group(0) @binding(1) var hsTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> hsParams: HueShiftParams;

fn rgb2hsv(c: vec3f) -> vec3f {
  let K = vec4f(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  let p = mix(vec4f(c.bg, K.wz), vec4f(c.gb, K.xy), step(c.b, c.g));
  let q = mix(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), step(p.x, c.r));
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn hsv2rgb(c: vec3f) -> vec3f {
  let K = vec4f(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3f(0.0), vec3f(1.0)), c.y);
}

@fragment
fn hueShiftFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(hsTexture, hsSampler, input.uv);
  var hsv = rgb2hsv(color.rgb);
  hsv.x = fract(hsv.x + hsParams.shift);
  return vec4f(hsv2rgb(hsv), color.a);
}

// ==================== COLOR ADJUST ====================
struct ColorAdjustParams {
  brightness: f32,
  contrast: f32,
  saturation: f32,
  _p: f32,
};

@group(0) @binding(0) var caSampler: sampler;
@group(0) @binding(1) var caTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> caParams: ColorAdjustParams;

@fragment
fn colorAdjustFragment(input: VertexOutput) -> @location(0) vec4f {
  var color = textureSample(caTexture, caSampler, input.uv);

  // Brightness
  color = vec4f(color.rgb + caParams.brightness, color.a);

  // Contrast
  color = vec4f((color.rgb - 0.5) * caParams.contrast + 0.5, color.a);

  // Saturation
  let gray = dot(color.rgb, vec3f(0.299, 0.587, 0.114));
  color = vec4f(mix(vec3f(gray), color.rgb, caParams.saturation), color.a);

  return clamp(color, vec4f(0.0), vec4f(1.0));
}

// ==================== PIXELATE ====================
struct PixelateParams {
  pixelSize: f32,
  width: f32,
  height: f32,
  _p: f32,
};

@group(0) @binding(0) var pxSampler: sampler;
@group(0) @binding(1) var pxTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> pxParams: PixelateParams;

@fragment
fn pixelateFragment(input: VertexOutput) -> @location(0) vec4f {
  let pixelX = pxParams.pixelSize / pxParams.width;
  let pixelY = pxParams.pixelSize / pxParams.height;
  let uv = vec2f(
    floor(input.uv.x / pixelX) * pixelX,
    floor(input.uv.y / pixelY) * pixelY
  );
  return textureSample(pxTexture, pxSampler, uv);
}

// ==================== KALEIDOSCOPE ====================
struct KaleidoscopeParams {
  segments: f32,
  rotation: f32,
  _p1: f32,
  _p2: f32,
};

@group(0) @binding(0) var ksSampler: sampler;
@group(0) @binding(1) var ksTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> ksParams: KaleidoscopeParams;

const PI: f32 = 3.14159265359;

@fragment
fn kaleidoscopeFragment(input: VertexOutput) -> @location(0) vec4f {
  var uv = input.uv - 0.5;
  let angle = atan2(uv.y, uv.x) + ksParams.rotation;
  let radius = length(uv);

  let segmentAngle = 2.0 * PI / ksParams.segments;
  var a = fract(angle / segmentAngle) * segmentAngle;

  if (a > segmentAngle * 0.5) {
    a = segmentAngle - a;
  }

  uv = vec2f(cos(a), sin(a)) * radius + 0.5;
  return textureSample(ksTexture, ksSampler, uv);
}

// ==================== RGB SPLIT ====================
struct RGBSplitParams {
  amount: f32,
  angle: f32,
  _p1: f32,
  _p2: f32,
};

@group(0) @binding(0) var rgbSampler: sampler;
@group(0) @binding(1) var rgbTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> rgbParams: RGBSplitParams;

@fragment
fn rgbSplitFragment(input: VertexOutput) -> @location(0) vec4f {
  let offset = vec2f(cos(rgbParams.angle), sin(rgbParams.angle)) * rgbParams.amount;
  let r = textureSample(rgbTexture, rgbSampler, input.uv + offset).r;
  let g = textureSample(rgbTexture, rgbSampler, input.uv).g;
  let b = textureSample(rgbTexture, rgbSampler, input.uv - offset).b;
  let a = textureSample(rgbTexture, rgbSampler, input.uv).a;
  return vec4f(r, g, b, a);
}

// ==================== MIRROR ====================
struct MirrorParams {
  horizontal: f32,
  vertical: f32,
  _p1: f32,
  _p2: f32,
};

@group(0) @binding(0) var mirrorSampler: sampler;
@group(0) @binding(1) var mirrorTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> mirrorParams: MirrorParams;

@fragment
fn mirrorFragment(input: VertexOutput) -> @location(0) vec4f {
  var uv = input.uv;

  if (mirrorParams.horizontal > 0.5 && uv.x > 0.5) {
    uv.x = 1.0 - uv.x;
  }

  if (mirrorParams.vertical > 0.5 && uv.y > 0.5) {
    uv.y = 1.0 - uv.y;
  }

  return textureSample(mirrorTexture, mirrorSampler, uv);
}

// ==================== INVERT ====================
@group(0) @binding(0) var invSampler: sampler;
@group(0) @binding(1) var invTexture: texture_2d<f32>;

@fragment
fn invertFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(invTexture, invSampler, input.uv);
  return vec4f(1.0 - color.rgb, color.a);
}
