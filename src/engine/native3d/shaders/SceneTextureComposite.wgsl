// Scene to compositor: the HDR native scene (rgba16float, premultiplied, display-referred sRGB
// values that may exceed 1) is exposed and tone mapped into the 8-bit texture the compositor
// samples. Raster passes and the path tracer's resolve both write display-referred values, so one
// view transform serves both engines. Standard tone mapping at 0 EV is a plain clamp, exactly what
// the former 8-bit scene target stored.

struct ToneUniforms {
  params: vec4f, // x: exposure scale (2^EV), y: tone mapping (0 standard, 1 AgX, 2 ACES, 3 neutral), zw: unused
}

@group(0) @binding(0) var sceneTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> tone: ToneUniforms;

struct VertexOutput {
  @builtin(position) position: vec4f,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let p = vec2f(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
  var output: VertexOutput;
  output.position = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  return output;
}

fn srgbToLinear(c: vec3f) -> vec3f {
  let x = max(c, vec3f(0.0));
  return select(pow((x + 0.055) / 1.055, vec3f(2.4)), x / 12.92, x <= vec3f(0.04045));
}

fn linearToSrgb(c: vec3f) -> vec3f {
  let x = max(c, vec3f(0.0));
  return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308));
}

// AgX (Troy Sobotka), polynomial fit of the default contrast curve by Benjamin Wrensch.
fn agxContrast(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

fn agx(color: vec3f) -> vec3f {
  let inset = mat3x3f(
    vec3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051),
    vec3f(0.0784335999999992, 0.878468636469772, 0.0784336),
    vec3f(0.0792237451477643, 0.0791661274605434, 0.879142973793104));
  let outset = mat3x3f(
    vec3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438),
    vec3f(-0.0980208811401368, 1.15190312990417, -0.0980434501171241),
    vec3f(-0.0990297440797205, -0.0989611768448433, 1.15107367264116));
  let minEv = -12.47393;
  let maxEv = 4.026069;
  var v = inset * max(color, vec3f(1e-10));
  v = clamp((log2(v) - minEv) / (maxEv - minEv), vec3f(0.0), vec3f(1.0));
  v = agxContrast(v);
  // The curve output is display encoded; back to linear for the shared sRGB encode below.
  return srgbToLinear(clamp(outset * v, vec3f(0.0), vec3f(1.0)));
}

// ACES filmic (RRT + ODT fit by Stephen Hill).
fn aces(color: vec3f) -> vec3f {
  let input = mat3x3f(vec3f(0.59719, 0.07600, 0.02840), vec3f(0.35458, 0.90834, 0.13383), vec3f(0.04823, 0.01566, 0.83777));
  let output = mat3x3f(vec3f(1.60475, -0.10208, -0.00327), vec3f(-0.53108, 1.10813, -0.07276), vec3f(-0.07367, -0.00605, 1.07602));
  let v = input * color;
  let a = v * (v + 0.0245786) - 0.000090537;
  let b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(output * (a / b), vec3f(0.0), vec3f(1.0));
}

// Khronos PBR Neutral.
fn neutral(colorIn: vec3f) -> vec3f {
  let startCompression = 0.8 - 0.04;
  let desaturation = 0.15;
  let x = min(colorIn.r, min(colorIn.g, colorIn.b));
  let offset = select(0.04, x - 6.25 * x * x, x < 0.08);
  var color = colorIn - offset;
  let peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) {
    return color;
  }
  let d = 1.0 - startCompression;
  let newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  let g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3f(newPeak), g);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let premultiplied = textureLoad(sceneTexture, vec2i(input.position.xy), 0);
  let mode = u32(tone.params.y + 0.5);
  if (mode == 0u && tone.params.x == 1.0) {
    return clamp(premultiplied, vec4f(0.0), vec4f(1.0));
  }
  let alpha = clamp(premultiplied.a, 0.0, 1.0);
  if (alpha <= 0.0) {
    return vec4f(0.0);
  }
  let linear = srgbToLinear(premultiplied.rgb / max(premultiplied.a, 1e-6)) * tone.params.x;
  var mapped = clamp(linear, vec3f(0.0), vec3f(1.0));
  if (mode == 1u) {
    mapped = agx(linear);
  } else if (mode == 2u) {
    mapped = aces(linear);
  } else if (mode == 3u) {
    mapped = clamp(neutral(linear), vec3f(0.0), vec3f(1.0));
  }
  return vec4f(clamp(linearToSrgb(mapped), vec3f(0.0), vec3f(1.0)) * alpha, alpha);
}
