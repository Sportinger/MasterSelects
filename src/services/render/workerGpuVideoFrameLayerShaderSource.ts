export const VIDEO_FRAME_LAYER_COMPOSITE_SHADER = `
struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f };
struct LayerParams {
  opacity: f32,
  blendMode: u32,
  inlineBrightness: f32,
  inlineContrast: f32,
  inlineSaturation: f32,
  inlineInvert: u32,
  hueShift: f32,
  pixelateSize: f32,
  kaleidoscopeSegments: f32,
  kaleidoscopeRotation: f32,
  rgbSplitAmount: f32,
  rgbSplitAngle: f32,
  blurRadius: f32,
  exposure: f32,
  exposureOffset: f32,
  exposureGamma: f32,
  temperature: f32,
  tint: f32,
  vibrance: f32,
  thresholdLevel: f32,
  posterizeLevels: f32,
  vignetteAmount: f32,
  vignetteSize: f32,
  vignetteSoftness: f32,
  vignetteRoundness: f32,
  chromaKeyMode: u32,
  chromaKeyTolerance: f32,
  chromaKeySoftness: f32,
  chromaKeySpill: f32,
  scanlineDensity: f32,
  scanlineOpacity: f32,
  scanlineSpeed: f32,
  grainAmount: f32,
  grainSize: f32,
  grainSpeed: f32,
  waveAmplitudeX: f32,
  waveAmplitudeY: f32,
  waveFrequencyX: f32,
  waveFrequencyY: f32,
  twirlAmount: f32,
  twirlRadius: f32,
  twirlCenterX: f32,
  twirlCenterY: f32,
  bulgeAmount: f32,
  bulgeRadius: f32,
  bulgeCenterX: f32,
  bulgeCenterY: f32,
  sharpenAmount: f32,
  sharpenRadius: f32,
  edgeDetectStrength: f32,
  edgeDetectInvert: u32,
  glowAmount: f32,
  glowThreshold: f32,
  glowRadius: f32,
  levelsInputBlack: f32,
  levelsInputWhite: f32,
  levelsGamma: f32,
  levelsOutputBlack: f32,
  levelsOutputWhite: f32,
  mirrorHorizontal: u32,
  mirrorVertical: u32,
  levelsEnabled: u32,
  outputWidth: f32,
  outputHeight: f32,
  effectTime: f32,
  _pad1: u32,
};

@group(0) @binding(0) var frameSampler: sampler;
@group(0) @binding(1) var baseTexture: texture_2d<f32>;
@group(0) @binding(2) var frameTexture: texture_external;
@group(0) @binding(3) var<uniform> layer: LayerParams;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0)
  );
  var out: VertexOutput;
  out.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  out.uv = uvs[vertexIndex];
  return out;
}

fn clampColor(value: vec3f) -> vec3f { return clamp(value, vec3f(0.0), vec3f(1.0)); }
fn luminosity(color: vec3f) -> f32 { return dot(color, vec3f(0.299, 0.587, 0.114)); }

fn blendOverlay(base: vec3f, blend: vec3f) -> vec3f {
  let low = 2.0 * base * blend;
  let high = 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
  return select(low, high, base >= vec3f(0.5));
}

fn blendSoftLight(base: vec3f, blend: vec3f) -> vec3f {
  let low = base - (1.0 - 2.0 * blend) * base * (1.0 - base);
  let high = base + (2.0 * blend - 1.0) * (sqrt(max(base, vec3f(0.0))) - base);
  return select(low, high, blend >= vec3f(0.5));
}

fn blendColorDodge(base: vec3f, blend: vec3f) -> vec3f {
  return min(base / max(vec3f(0.001), 1.0 - blend), vec3f(1.0));
}

fn blendColorBurn(base: vec3f, blend: vec3f) -> vec3f {
  return 1.0 - min((1.0 - base) / max(vec3f(0.001), blend), vec3f(1.0));
}

fn blendRgb(base: vec3f, blend: vec3f, mode: u32) -> vec3f {
  switch mode {
    case 1u: { return base * blend; }
    case 2u: { return 1.0 - (1.0 - base) * (1.0 - blend); }
    case 3u: { return blendOverlay(base, blend); }
    case 4u: { return min(base, blend); }
    case 5u: { return max(base, blend); }
    case 6u: { return min(base + blend, vec3f(1.0)); }
    case 7u: { return max(base - blend, vec3f(0.0)); }
    case 8u: { return abs(base - blend); }
    case 9u: { return base + blend - 2.0 * base * blend; }
    case 10u: { return blendColorDodge(base, blend); }
    case 11u: { return blendColorBurn(base, blend); }
    case 12u: { return blendOverlay(blend, base); }
    case 13u: { return blendSoftLight(base, blend); }
    case 14u: { return min(base / max(vec3f(0.001), blend), vec3f(1.0)); }
    default: { return blend; }
  }
}

fn rgb2hsv(c: vec3f) -> vec3f {
  let K = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = mix(vec4f(c.bg, K.wz), vec4f(c.gb, K.xy), step(c.b, c.g));
  let q = mix(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), step(p.x, c.r));
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn hsv2rgb(c: vec3f) -> vec3f {
  let K = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3f(0.0), vec3f(1.0)), c.y);
}

fn effectUv(sourceUv: vec2f) -> vec2f {
  var uv = sourceUv;
  if (abs(layer.waveAmplitudeX) > 0.000001 || abs(layer.waveAmplitudeY) > 0.000001) {
    uv.y += sin(uv.x * layer.waveFrequencyX * 6.28318530718) * layer.waveAmplitudeX;
    uv.x += sin(uv.y * layer.waveFrequencyY * 6.28318530718) * layer.waveAmplitudeY;
  }
  if (abs(layer.twirlAmount) > 0.000001) {
    let center = vec2f(layer.twirlCenterX, layer.twirlCenterY);
    let delta = uv - center;
    let dist = length(delta);
    let safeRadius = max(layer.twirlRadius, 0.0001);
    let factor = 1.0 - min(dist / safeRadius, 1.0);
    let angle = layer.twirlAmount * factor * factor;
    let rotated = vec2f(delta.x * cos(angle) - delta.y * sin(angle), delta.x * sin(angle) + delta.y * cos(angle));
    uv = select(uv, center + rotated, dist < safeRadius);
  }
  if (abs(layer.bulgeAmount) > 0.000001) {
    let center = vec2f(layer.bulgeCenterX, layer.bulgeCenterY);
    let delta = uv - center;
    let dist = length(delta);
    let safeDist = max(dist, 0.0001);
    let radius = max(layer.bulgeRadius, 0.0001);
    let newDist = pow(safeDist / radius, layer.bulgeAmount) * radius;
    uv = select(uv, center + delta / safeDist * newDist, dist < radius && dist > 0.0);
  }
  if (layer.mirrorHorizontal == 1u && uv.x > 0.5) { uv.x = 1.0 - uv.x; }
  if (layer.mirrorVertical == 1u && uv.y > 0.5) { uv.y = 1.0 - uv.y; }
  if (layer.kaleidoscopeSegments >= 2.0) {
    var centered = uv - vec2f(0.5);
    let angle = atan2(centered.y, centered.x) + layer.kaleidoscopeRotation;
    let radius = length(centered);
    let segmentAngle = 6.28318530718 / max(2.0, layer.kaleidoscopeSegments);
    var segment = fract(angle / segmentAngle) * segmentAngle;
    if (segment > segmentAngle * 0.5) { segment = segmentAngle - segment; }
    uv = vec2f(cos(segment), sin(segment)) * radius + vec2f(0.5);
  }
  if (layer.pixelateSize >= 1.0) {
    let pixel = vec2f(
      layer.pixelateSize / max(1.0, layer.outputWidth),
      layer.pixelateSize / max(1.0, layer.outputHeight)
    );
    uv = floor(uv / pixel) * pixel;
  }
  return uv;
}

fn sampleExternalFrame(uv: vec2f) -> vec4f {
  if (abs(layer.rgbSplitAmount) > 0.000001) {
    let offset = vec2f(cos(layer.rgbSplitAngle), sin(layer.rgbSplitAngle)) * layer.rgbSplitAmount;
    let r = textureSampleBaseClampToEdge(frameTexture, frameSampler, uv + offset).r;
    let g = textureSampleBaseClampToEdge(frameTexture, frameSampler, uv).g;
    let b = textureSampleBaseClampToEdge(frameTexture, frameSampler, uv - offset).b;
    let a = textureSampleBaseClampToEdge(frameTexture, frameSampler, uv).a;
    return vec4f(r, g, b, a);
  }
  return textureSampleBaseClampToEdge(frameTexture, frameSampler, uv);
}

fn sampleBlurredFrame(uv: vec2f, radius: f32) -> vec4f {
  let texel = vec2f(radius / max(1.0, layer.outputWidth), radius / max(1.0, layer.outputHeight));
  return (
    sampleExternalFrame(uv + texel * vec2f(-1.0, -1.0)) +
    sampleExternalFrame(uv + texel * vec2f(0.0, -1.0)) +
    sampleExternalFrame(uv + texel * vec2f(1.0, -1.0)) +
    sampleExternalFrame(uv + texel * vec2f(-1.0, 0.0)) +
    sampleExternalFrame(uv) +
    sampleExternalFrame(uv + texel * vec2f(1.0, 0.0)) +
    sampleExternalFrame(uv + texel * vec2f(-1.0, 1.0)) +
    sampleExternalFrame(uv + texel * vec2f(0.0, 1.0)) +
    sampleExternalFrame(uv + texel * vec2f(1.0, 1.0))
  ) / 9.0;
}

fn sampleFrame(uv: vec2f) -> vec4f {
  var color = select(sampleExternalFrame(uv), sampleBlurredFrame(uv, layer.blurRadius), layer.blurRadius > 0.000001);
  if (abs(layer.sharpenAmount) > 0.000001 && layer.sharpenRadius > 0.0) {
    let blurred = sampleBlurredFrame(uv, layer.sharpenRadius);
    color = vec4f(clamp(color.rgb + (color.rgb - blurred.rgb) * layer.sharpenAmount, vec3f(0.0), vec3f(1.0)), color.a);
  }
  if (abs(layer.edgeDetectStrength) > 0.000001) {
    let texel = vec2f(1.0 / max(1.0, layer.outputWidth), 1.0 / max(1.0, layer.outputHeight));
    let gx = luminosity(sampleExternalFrame(uv + texel * vec2f(1.0, 0.0)).rgb) - luminosity(sampleExternalFrame(uv - texel * vec2f(1.0, 0.0)).rgb);
    let gy = luminosity(sampleExternalFrame(uv + texel * vec2f(0.0, 1.0)).rgb) - luminosity(sampleExternalFrame(uv - texel * vec2f(0.0, 1.0)).rgb);
    var edge = clamp(length(vec2f(gx, gy)) * layer.edgeDetectStrength, 0.0, 1.0);
    edge = select(edge, 1.0 - edge, layer.edgeDetectInvert == 1u);
    color = vec4f(vec3f(edge), color.a);
  }
  if (abs(layer.glowAmount) > 0.000001 && layer.glowRadius > 0.0) {
    let glow = sampleBlurredFrame(uv, layer.glowRadius).rgb;
    let bright = smoothstep(layer.glowThreshold - 0.1, layer.glowThreshold + 0.1, luminosity(glow));
    color = vec4f(clamp(color.rgb + glow * bright * layer.glowAmount, vec3f(0.0), vec3f(1.0)), color.a);
  }
  return color;
}

fn noise(uv: vec2f) -> f32 {
  return fract(sin(dot(uv, vec2f(12.9898, 78.233))) * 43758.5453);
}

fn applyColorEffects(color: vec4f, uv: vec2f) -> vec4f {
  var rgb = color.rgb;
  var alpha = color.a;
  if (abs(layer.hueShift) > 0.000001) {
    var hsv = rgb2hsv(rgb);
    hsv.x = fract(hsv.x + layer.hueShift);
    rgb = hsv2rgb(hsv);
  }
  if (layer.levelsEnabled == 1u) {
    let inputRange = max(0.0001, layer.levelsInputWhite - layer.levelsInputBlack);
    var adjusted = clamp((rgb - vec3f(layer.levelsInputBlack)) / inputRange, vec3f(0.0), vec3f(1.0));
    adjusted = pow(adjusted, vec3f(1.0 / max(0.001, layer.levelsGamma)));
    rgb = mix(vec3f(layer.levelsOutputBlack), vec3f(layer.levelsOutputWhite), adjusted);
  }
  rgb = select(rgb, 1.0 - rgb, layer.inlineInvert == 1u);
  rgb = clamp((rgb + layer.inlineBrightness - 0.5) * layer.inlineContrast + 0.5, vec3f(0.0), vec3f(1.0));
  rgb = mix(vec3f(luminosity(rgb)), rgb, layer.inlineSaturation);
  if (abs(layer.exposure) > 0.000001 || abs(layer.exposureOffset) > 0.000001 || abs(layer.exposureGamma - 1.0) > 0.000001) {
    rgb = pow(max(rgb * pow(2.0, layer.exposure) + vec3f(layer.exposureOffset), vec3f(0.0)), vec3f(1.0 / max(0.001, layer.exposureGamma)));
  }
  if (abs(layer.temperature) > 0.000001 || abs(layer.tint) > 0.000001) {
    rgb += vec3f(layer.temperature * 0.1 + layer.tint * 0.05, -layer.tint * 0.1, -layer.temperature * 0.1 + layer.tint * 0.05);
  }
  if (abs(layer.vibrance) > 0.000001) {
    let maxChannel = max(rgb.r, max(rgb.g, rgb.b));
    let minChannel = min(rgb.r, min(rgb.g, rgb.b));
    let sat = (maxChannel - minChannel) / (maxChannel + 0.001);
    rgb = mix(vec3f(luminosity(rgb)), rgb, 1.0 + layer.vibrance * (1.0 - sat));
  }
  if (layer.posterizeLevels >= 2.0) {
    rgb = floor(rgb * layer.posterizeLevels) / max(1.0, layer.posterizeLevels - 1.0);
  }
  if (layer.thresholdLevel >= 0.0) {
    rgb = vec3f(select(0.0, 1.0, luminosity(rgb) > layer.thresholdLevel));
  }
  if (abs(layer.vignetteAmount) > 0.000001) {
    let centered = uv - vec2f(0.5);
    let dist = length(vec2f(centered.x, centered.y * layer.vignetteRoundness)) * 2.0;
    let vignette = 1.0 - smoothstep(layer.vignetteSize, layer.vignetteSize + layer.vignetteSoftness, dist);
    rgb *= mix(1.0, vignette, layer.vignetteAmount);
  }
  if (layer.scanlineOpacity > 0.000001 && layer.scanlineDensity > 0.0) {
    let scanline = sin((uv.y + layer.effectTime * layer.scanlineSpeed * 0.1) * layer.scanlineDensity * 100.0) * 0.5 + 0.5;
    rgb *= 1.0 - layer.scanlineOpacity * (1.0 - scanline);
  }
  if (layer.grainAmount > 0.000001) {
    let grainUv = uv * (100.0 / max(0.001, layer.grainSize)) + vec2f(layer.effectTime * layer.grainSpeed * 0.1, layer.effectTime * layer.grainSpeed * 0.07);
    let grain = noise(grainUv) * 2.0 - 1.0;
    rgb += vec3f(grain * layer.grainAmount * (1.0 - luminosity(rgb) * 0.5));
  }
  if (layer.chromaKeyMode != 0u) {
    let key = select(vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0), layer.chromaKeyMode == 2u);
    let diff = distance(rgb, key);
    let keep = smoothstep(layer.chromaKeyTolerance, layer.chromaKeyTolerance + layer.chromaKeySoftness, diff);
    alpha *= keep;
    if (layer.chromaKeyMode == 1u) {
      let spill = max(0.0, rgb.g - max(rgb.r, rgb.b)) * layer.chromaKeySpill;
      rgb += vec3f(spill * 0.5, -spill, spill * 0.5);
    }
    if (layer.chromaKeyMode == 2u) {
      let spill = max(0.0, rgb.b - max(rgb.r, rgb.g)) * layer.chromaKeySpill;
      rgb += vec3f(spill * 0.5, spill * 0.5, -spill);
    }
  }
  return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), clamp(alpha, 0.0, 1.0));
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let baseColor = textureSample(baseTexture, frameSampler, input.uv);
  let layerUv = effectUv(input.uv);
  let frameColor = applyColorEffects(sampleFrame(layerUv), input.uv);
  let alpha = clamp(frameColor.a * clamp(layer.opacity, 0.0, 1.0), 0.0, 1.0);
  let blended = clampColor(blendRgb(baseColor.rgb, frameColor.rgb, layer.blendMode));
  let outAlpha = alpha + baseColor.a * (1.0 - alpha);
  return vec4f(mix(baseColor.rgb, blended, alpha), outAlpha);
}
`;

/** Injects the compiled image DAG at the legacy inline-invert position, preserving the surrounding effect order. */
export function specializeVideoFrameLayerCompositeShader(source: string, program: import('../../types/imageOperatorProgram').ImageOperatorProgram): string {
  const marker = '  rgb = select(rgb, 1.0 - rgb, layer.inlineInvert == 1u);';
  if (!source.includes(marker)) throw new Error('Worker video operator insertion point is missing.');
  const parameters = program.values.length ? ', layer.imageParameters' : '';
  const specialized = program.values.length
    ? source.replace('  _pad1: u32,', '  _pad1: u32,\n  imageParameters: ImageOperatorParameters,') : source;
  return `${program.wgsl}\n${specialized.replace(marker, `  let operatorColor = evaluateImageGraph(vec4f(rgb, alpha)${parameters});\n  rgb = operatorColor.rgb;\n  alpha = operatorColor.a;\n${marker}`)}`;
}

export const VIDEO_FRAME_LAYER_DISPLAY_SHADER = `
struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@group(0) @binding(0) var frameSampler: sampler;
@group(0) @binding(1) var frameTexture: texture_2d<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0)
  );
  var out: VertexOutput;
  out.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  out.uv = uvs[vertexIndex];
  return out;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return textureSample(frameTexture, frameSampler, input.uv);
}
`;
