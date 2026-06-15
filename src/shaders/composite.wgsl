// Vertex shader for fullscreen quad
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  // Fullscreen triangle positions
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

// Layer uniform for transform and blend settings
struct LayerUniforms {
  opacity: f32,
  blendMode: u32,
  posX: f32,
  posY: f32,
  scaleX: f32,
  scaleY: f32,
  rotationZ: f32,     // Z rotation in radians (2D rotation)
  sourceAspect: f32,  // source width / height
  outputAspect: f32,  // output width / height (16:9 = 1.777)
  time: f32,          // for animated effects like dancing dissolve
  hasMask: u32,       // 0 or 1 - whether layer has a mask
  maskInvert: u32,    // 0 or 1 - whether mask is inverted
  rotationX: f32,     // X rotation in radians (tilt forward/back)
  rotationY: f32,     // Y rotation in radians (turn left/right)
  perspective: f32,   // Perspective distance (higher = less perspective)
  maskFeather: f32,   // Mask blur radius in pixels (0-50)
  maskFeatherQuality: u32, // 0=low (9 samples), 1=medium (17), 2=high (25)
  posZ: f32,          // Z position (depth) - affects scale based on perspective
  inlineBrightness: f32,  // Inline effect: brightness offset (0 = no change)
  inlineContrast: f32,    // Inline effect: contrast multiplier (1 = no change)
  inlineSaturation: f32,  // Inline effect: saturation multiplier (1 = no change)
  inlineInvert: u32,      // Inline effect: invert (0 or 1)
  transitionType: u32,    // 0=none, 1-4=wipe, 5-7/16-19=iris, 8=clock, 9-10=center, 11=noise, 12=blocks, 13=checker, 14-15/20-24=pattern, 25-26=distortion
  transitionProgress: f32,
  transitionSeed: f32,
  sourceRectX: f32,
  sourceRectY: f32,
  sourceRectWidth: f32,
  sourceRectHeight: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var baseTexture: texture_2d<f32>;
@group(0) @binding(2) var layerTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> layer: LayerUniforms;
@group(0) @binding(4) var maskTexture: texture_2d<f32>;

// ============ Utility Functions ============

// Hash function for pseudo-random numbers
fn hash(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn getTransitionAlpha(uv: vec2f) -> f32 {
  if (layer.transitionType == 0u) {
    return 1.0;
  }

  let progress = clamp(layer.transitionProgress, 0.0, 1.0);
  let seedOffset = vec2f(layer.transitionSeed * 0.013, layer.transitionSeed * 0.021);
  if (layer.transitionType == 1u) {
    return select(0.0, 1.0, uv.x >= 1.0 - progress);
  }
  if (layer.transitionType == 2u) {
    return select(0.0, 1.0, uv.x <= progress);
  }
  if (layer.transitionType == 3u) {
    return select(0.0, 1.0, uv.y >= 1.0 - progress);
  }
  if (layer.transitionType == 4u) {
    return select(0.0, 1.0, uv.y <= progress);
  }
  let centered = uv - vec2f(0.5);
  if (layer.transitionType == 5u) {
    return select(0.0, 1.0, length(centered) <= progress * 0.70710678);
  }
  if (layer.transitionType == 6u) {
    return select(0.0, 1.0, abs(centered.x) + abs(centered.y) <= progress);
  }
  if (layer.transitionType == 7u) {
    return select(0.0, 1.0, max(abs(centered.x), abs(centered.y)) <= progress * 0.5);
  }
  if (layer.transitionType == 16u) {
    let ovalDistance = length(vec2f(centered.x * 0.68, centered.y));
    return select(0.0, 1.0, ovalDistance <= progress * 0.605);
  }
  if (layer.transitionType == 17u) {
    let easedShapeProgress = pow(progress, 1.35);
    let triangleDistance = max(abs(centered.x) * 1.1 - centered.y * 0.6, centered.y * 1.2);
    return select(0.0, 1.0, triangleDistance <= easedShapeProgress * 0.9);
  }
  if (layer.transitionType == 18u) {
    let crossWidth = pow(progress, 1.35) * 0.5;
    return select(0.0, 1.0, min(abs(centered.x), abs(centered.y)) <= crossWidth);
  }
  if (layer.transitionType == 19u) {
    let angle = atan2(centered.y, centered.x);
    let radius = length(centered);
    let starRadius = 0.68 + 0.32 * cos(angle * 5.0);
    let starDistance = radius / max(starRadius, 0.24);
    return select(0.0, 1.0, starDistance <= pow(progress, 1.35) * 2.0);
  }
  if (layer.transitionType == 8u) {
    let angle = atan2(centered.x, -centered.y);
    let normalized = fract(angle / 6.28318530718);
    return select(0.0, 1.0, normalized <= progress);
  }
  if (layer.transitionType == 9u) {
    return select(0.0, 1.0, abs(centered.x) <= progress * 0.5);
  }
  if (layer.transitionType == 10u) {
    return select(0.0, 1.0, abs(centered.y) <= progress * 0.5);
  }
  if (layer.transitionType == 11u) {
    let cell = floor(uv * 96.0);
    let noise = hash(cell + seedOffset);
    return select(0.0, 1.0, noise <= progress);
  }
  if (layer.transitionType == 12u) {
    let blockGrid = vec2f(24.0, 14.0);
    let cell = floor(uv * blockGrid);
    let rank = hash(cell + vec2f(19.19, 7.31) + seedOffset);
    return select(0.0, 1.0, rank <= progress);
  }
  if (layer.transitionType == 13u) {
    if (progress <= 0.0) {
      return 0.0;
    }
    if (progress >= 1.0) {
      return 1.0;
    }
    let grid = vec2f(18.0, 10.0);
    let cell = floor(uv * grid);
    let checker = fract((cell.x + cell.y) * 0.5) * 2.0;
    let rank = checker * 0.58 + hash(cell + vec2f(2.71, 5.83)) * 0.42;
    return select(0.0, 1.0, rank < progress);
  }
  if (layer.transitionType == 14u) {
    if (progress <= 0.0) {
      return 0.0;
    }
    if (progress >= 1.0) {
      return 1.0;
    }
    let stripeCount = 10.0;
    let stripeUv = uv.y * stripeCount;
    let stripe = floor(stripeUv);
    let local = fract(stripeUv);
    let stagger = hash(vec2f(stripe, 4.17)) * 0.18;
    let stripeProgress = clamp(progress * 1.18 - stagger, 0.0, 1.0);
    return select(0.0, 1.0, local <= stripeProgress);
  }
  if (layer.transitionType == 15u) {
    if (progress <= 0.0) {
      return 0.0;
    }
    if (progress >= 1.0) {
      return 1.0;
    }
    let stripeCount = 12.0;
    let stripeUv = uv.x * stripeCount;
    let stripe = floor(stripeUv);
    let local = fract(stripeUv);
    let stagger = hash(vec2f(stripe, 9.43)) * 0.18;
    let stripeProgress = clamp(progress * 1.18 - stagger, 0.0, 1.0);
    return select(0.0, 1.0, local <= stripeProgress);
  }
  if (layer.transitionType == 20u) {
    if (progress <= 0.0) {
      return 0.0;
    }
    if (progress >= 1.0) {
      return 1.0;
    }
    let blockGrid = vec2f(10.0, 6.0);
    let cell = floor(uv * blockGrid);
    let rank = hash(cell + vec2f(31.7, 13.9));
    return select(0.0, 1.0, rank <= progress);
  }
  if (layer.transitionType == 21u) {
    if (progress <= 0.0) {
      return 0.0;
    }
    if (progress >= 1.0) {
      return 1.0;
    }
    let rowCount = 8.0;
    let localRow = fract(uv.y * rowCount);
    let notch = abs(localRow - 0.5) * 0.28;
    let edge = progress * 1.28 - 0.14;
    return select(0.0, 1.0, uv.x <= edge - notch);
  }
  if (layer.transitionType == 22u) {
    if (progress <= 0.0) {
      return 0.0;
    }
    if (progress >= 1.0) {
      return 1.0;
    }
    let dotGrid = vec2f(12.0, 7.0);
    let cell = floor(uv * dotGrid);
    let local = fract(uv * dotGrid) - vec2f(0.5);
    let stagger = hash(cell + vec2f(8.13, 2.47)) * 0.16;
    let radius = clamp(progress * 1.18 - stagger, 0.0, 1.0) * 0.72;
    return select(0.0, 1.0, length(local) <= radius);
  }
  if (layer.transitionType == 23u) {
    if (progress <= 0.0) {
      return 0.0;
    }
    if (progress >= 1.0) {
      return 1.0;
    }
    let columnCount = 12.0;
    let column = floor(uv.x * columnCount);
    let stagger = hash(vec2f(column, 6.91)) * 0.18;
    let columnProgress = clamp(progress * 1.18 - stagger, 0.0, 1.0);
    let alternate = fract(column * 0.5) * 2.0;
    let topDown = uv.y <= columnProgress;
    let bottomUp = uv.y >= 1.0 - columnProgress;
    return select(0.0, 1.0, select(bottomUp, topDown, alternate < 1.0));
  }
  if (layer.transitionType == 24u) {
    if (progress <= 0.0) {
      return 0.0;
    }
    if (progress >= 1.0) {
      return 1.0;
    }
    let splatGrid = vec2f(9.0, 5.0);
    let scaled = uv * splatGrid;
    let cell = floor(scaled);
    let local = fract(scaled) - vec2f(0.5);
    let rank = hash(cell + vec2f(4.89, 12.37));
    let growth = clamp(progress * 1.28 - rank * 0.34, 0.0, 1.0);
    let offsetA = (vec2f(
      hash(cell + vec2f(17.1, 2.3)),
      hash(cell + vec2f(5.7, 23.4))
    ) - vec2f(0.5)) * 0.28;
    let offsetB = (vec2f(
      hash(cell + vec2f(11.2, 31.6)),
      hash(cell + vec2f(29.9, 7.4))
    ) - vec2f(0.5)) * 0.32;
    let mainRadius = growth * (0.34 + hash(cell + vec2f(3.4, 44.2)) * 0.18);
    let satelliteA = growth * (0.14 + hash(cell + vec2f(41.8, 1.9)) * 0.1);
    let satelliteB = growth * (0.12 + hash(cell + vec2f(8.6, 15.1)) * 0.08);
    let main = length(local - offsetA) <= mainRadius;
    let spotA = length(local + vec2f(0.24, -0.16) - offsetB * 0.55) <= satelliteA;
    let spotB = length(local + vec2f(-0.18, 0.22) + offsetA * 0.45) <= satelliteB;
    return select(0.0, 1.0, main || spotA || spotB);
  }
  return 1.0;
}

fn getTransitionUv(uv: vec2f) -> vec2f {
  let progress = clamp(layer.transitionProgress, 0.0, 1.0);
  let envelope = sin(progress * 3.14159265359);
  let seedPhase = layer.transitionSeed * 0.0017;
  let centered = uv - vec2f(0.5);
  let radius = length(centered);
  let dir = centered / max(radius, 0.001);

  if (layer.transitionType == 25u) {
    let rippleCenter = progress * 0.82;
    let waveBand = 1.0 - smoothstep(0.0, 0.18, abs(radius - rippleCenter));
    let wave = sin((radius - rippleCenter) * 46.0 + seedPhase) * envelope * waveBand;
    return clamp(uv + dir * wave * 0.035, vec2f(0.0), vec2f(1.0));
  }

  if (layer.transitionType == 26u) {
    let falloff = smoothstep(0.72, 0.0, radius);
    let angle = (1.0 - progress) * envelope * falloff * (2.4 + fract(layer.transitionSeed * 0.013) * 0.8);
    let cosA = cos(angle);
    let sinA = sin(angle);
    let rotated = vec2f(
      centered.x * cosA - centered.y * sinA,
      centered.x * sinA + centered.y * cosA
    );
    return clamp(rotated + vec2f(0.5), vec2f(0.0), vec2f(1.0));
  }

  return uv;
}

// Get luminosity of a color
fn getLuminosity(c: vec3f) -> f32 {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

// Set luminosity of a color
fn setLuminosity(c: vec3f, l: f32) -> vec3f {
  let d = l - getLuminosity(c);
  var result = c + vec3f(d);
  return clipColor(result);
}

// Clip color to valid range
fn clipColor(c: vec3f) -> vec3f {
  let l = getLuminosity(c);
  let n = min(min(c.r, c.g), c.b);
  let x = max(max(c.r, c.g), c.b);
  var result = c;
  if (n < 0.0) {
    result = l + (((c - l) * l) / (l - n));
  }
  if (x > 1.0) {
    result = l + (((c - l) * (1.0 - l)) / (x - l));
  }
  return result;
}

// Get saturation of a color
fn getSaturation(c: vec3f) -> f32 {
  return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
}

// Set saturation of a color (simplified version)
fn setSaturation(c: vec3f, s: f32) -> vec3f {
  let cMin = min(min(c.r, c.g), c.b);
  let cMax = max(max(c.r, c.g), c.b);
  if (cMax == cMin) {
    return vec3f(0.0);
  }
  return (c - cMin) * s / (cMax - cMin);
}

// RGB to HSL conversion
fn rgbToHsl(c: vec3f) -> vec3f {
  let cMax = max(max(c.r, c.g), c.b);
  let cMin = min(min(c.r, c.g), c.b);
  let delta = cMax - cMin;

  var h: f32 = 0.0;
  var s: f32 = 0.0;
  let l = (cMax + cMin) / 2.0;

  if (delta > 0.0) {
    s = select(delta / (2.0 - cMax - cMin), delta / (cMax + cMin), l < 0.5);

    if (cMax == c.r) {
      h = ((c.g - c.b) / delta) + select(0.0, 6.0, c.g < c.b);
    } else if (cMax == c.g) {
      h = ((c.b - c.r) / delta) + 2.0;
    } else {
      h = ((c.r - c.g) / delta) + 4.0;
    }
    h = h / 6.0;
  }

  return vec3f(h, s, l);
}

// Helper for HSL to RGB
fn hueToRgb(p: f32, q: f32, t: f32) -> f32 {
  var tt = t;
  if (tt < 0.0) { tt = tt + 1.0; }
  if (tt > 1.0) { tt = tt - 1.0; }
  if (tt < 1.0/6.0) { return p + (q - p) * 6.0 * tt; }
  if (tt < 1.0/2.0) { return q; }
  if (tt < 2.0/3.0) { return p + (q - p) * (2.0/3.0 - tt) * 6.0; }
  return p;
}

// HSL to RGB conversion
fn hslToRgb(hsl: vec3f) -> vec3f {
  if (hsl.y == 0.0) {
    return vec3f(hsl.z);
  }

  let q = select(hsl.z + hsl.y - hsl.z * hsl.y, hsl.z * (1.0 + hsl.y), hsl.z < 0.5);
  let p = 2.0 * hsl.z - q;

  return vec3f(
    hueToRgb(p, q, hsl.x + 1.0/3.0),
    hueToRgb(p, q, hsl.x),
    hueToRgb(p, q, hsl.x - 1.0/3.0)
  );
}

// ============ Blend Mode Functions ============

// 0: Normal
fn blendNormal(base: vec3f, blend: vec3f) -> vec3f {
  return blend;
}

// 1: Dissolve (uses random based on position and opacity)
fn blendDissolve(base: vec3f, blend: vec3f, uv: vec2f, opacity: f32) -> vec3f {
  let r = hash(uv * 1000.0);
  return select(base, blend, r < opacity);
}

// 2: Dancing Dissolve (dissolve with time-varying random)
fn blendDancingDissolve(base: vec3f, blend: vec3f, uv: vec2f, opacity: f32, time: f32) -> vec3f {
  let r = hash(uv * 1000.0 + vec2f(time * 60.0));
  return select(base, blend, r < opacity);
}

// 3: Darken
fn blendDarken(base: vec3f, blend: vec3f) -> vec3f {
  return min(base, blend);
}

// 4: Multiply
fn blendMultiply(base: vec3f, blend: vec3f) -> vec3f {
  return base * blend;
}

// 5: Color Burn
fn blendColorBurn(base: vec3f, blend: vec3f) -> vec3f {
  return vec3f(
    select(1.0 - min(1.0, (1.0 - base.r) / blend.r), 0.0, blend.r == 0.0),
    select(1.0 - min(1.0, (1.0 - base.g) / blend.g), 0.0, blend.g == 0.0),
    select(1.0 - min(1.0, (1.0 - base.b) / blend.b), 0.0, blend.b == 0.0)
  );
}

// 6: Classic Color Burn (slightly different formula)
fn blendClassicColorBurn(base: vec3f, blend: vec3f) -> vec3f {
  return 1.0 - (1.0 - base) / max(blend, vec3f(0.001));
}

// 7: Linear Burn
fn blendLinearBurn(base: vec3f, blend: vec3f) -> vec3f {
  return max(base + blend - 1.0, vec3f(0.0));
}

// 8: Darker Color
fn blendDarkerColor(base: vec3f, blend: vec3f) -> vec3f {
  return select(blend, base, getLuminosity(base) < getLuminosity(blend));
}

// 9: Add (Linear Dodge)
fn blendAdd(base: vec3f, blend: vec3f) -> vec3f {
  return min(base + blend, vec3f(1.0));
}

// 10: Lighten
fn blendLighten(base: vec3f, blend: vec3f) -> vec3f {
  return max(base, blend);
}

// 11: Screen
fn blendScreen(base: vec3f, blend: vec3f) -> vec3f {
  return 1.0 - (1.0 - base) * (1.0 - blend);
}

// 12: Color Dodge
fn blendColorDodge(base: vec3f, blend: vec3f) -> vec3f {
  return vec3f(
    select(min(1.0, base.r / (1.0 - blend.r)), 1.0, blend.r == 1.0),
    select(min(1.0, base.g / (1.0 - blend.g)), 1.0, blend.g == 1.0),
    select(min(1.0, base.b / (1.0 - blend.b)), 1.0, blend.b == 1.0)
  );
}

// 13: Classic Color Dodge
fn blendClassicColorDodge(base: vec3f, blend: vec3f) -> vec3f {
  return base / max(1.0 - blend, vec3f(0.001));
}

// 14: Linear Dodge (same as Add)
fn blendLinearDodge(base: vec3f, blend: vec3f) -> vec3f {
  return min(base + blend, vec3f(1.0));
}

// 15: Lighter Color
fn blendLighterColor(base: vec3f, blend: vec3f) -> vec3f {
  return select(blend, base, getLuminosity(base) > getLuminosity(blend));
}

// 16: Overlay
fn blendOverlay(base: vec3f, blend: vec3f) -> vec3f {
  let r = select(
    1.0 - 2.0 * (1.0 - base.r) * (1.0 - blend.r),
    2.0 * base.r * blend.r,
    base.r < 0.5
  );
  let g = select(
    1.0 - 2.0 * (1.0 - base.g) * (1.0 - blend.g),
    2.0 * base.g * blend.g,
    base.g < 0.5
  );
  let b = select(
    1.0 - 2.0 * (1.0 - base.b) * (1.0 - blend.b),
    2.0 * base.b * blend.b,
    base.b < 0.5
  );
  return vec3f(r, g, b);
}

// 17: Soft Light
fn blendSoftLight(base: vec3f, blend: vec3f) -> vec3f {
  let d = select(
    sqrt(base),
    ((16.0 * base - 12.0) * base + 4.0) * base,
    base <= vec3f(0.25)
  );
  return select(
    base + (2.0 * blend - 1.0) * (d - base),
    base - (1.0 - 2.0 * blend) * base * (1.0 - base),
    blend <= vec3f(0.5)
  );
}

// 18: Hard Light
fn blendHardLight(base: vec3f, blend: vec3f) -> vec3f {
  let r = select(
    1.0 - 2.0 * (1.0 - base.r) * (1.0 - blend.r),
    2.0 * base.r * blend.r,
    blend.r < 0.5
  );
  let g = select(
    1.0 - 2.0 * (1.0 - base.g) * (1.0 - blend.g),
    2.0 * base.g * blend.g,
    blend.g < 0.5
  );
  let b = select(
    1.0 - 2.0 * (1.0 - base.b) * (1.0 - blend.b),
    2.0 * base.b * blend.b,
    blend.b < 0.5
  );
  return vec3f(r, g, b);
}

// 19: Linear Light
fn blendLinearLight(base: vec3f, blend: vec3f) -> vec3f {
  return clamp(base + 2.0 * blend - 1.0, vec3f(0.0), vec3f(1.0));
}

// 20: Vivid Light
fn blendVividLight(base: vec3f, blend: vec3f) -> vec3f {
  let r = select(
    blendColorDodge(base, 2.0 * (blend - 0.5)).r,
    blendColorBurn(base, 2.0 * blend).r,
    blend.r <= 0.5
  );
  let g = select(
    blendColorDodge(base, 2.0 * (blend - 0.5)).g,
    blendColorBurn(base, 2.0 * blend).g,
    blend.g <= 0.5
  );
  let b = select(
    blendColorDodge(base, 2.0 * (blend - 0.5)).b,
    blendColorBurn(base, 2.0 * blend).b,
    blend.b <= 0.5
  );
  return vec3f(r, g, b);
}

// 21: Pin Light
fn blendPinLight(base: vec3f, blend: vec3f) -> vec3f {
  let r = select(
    max(base.r, 2.0 * (blend.r - 0.5)),
    min(base.r, 2.0 * blend.r),
    blend.r <= 0.5
  );
  let g = select(
    max(base.g, 2.0 * (blend.g - 0.5)),
    min(base.g, 2.0 * blend.g),
    blend.g <= 0.5
  );
  let b = select(
    max(base.b, 2.0 * (blend.b - 0.5)),
    min(base.b, 2.0 * blend.b),
    blend.b <= 0.5
  );
  return vec3f(r, g, b);
}

// 22: Hard Mix
fn blendHardMix(base: vec3f, blend: vec3f) -> vec3f {
  return vec3f(
    select(0.0, 1.0, base.r + blend.r >= 1.0),
    select(0.0, 1.0, base.g + blend.g >= 1.0),
    select(0.0, 1.0, base.b + blend.b >= 1.0)
  );
}

// 23: Difference
fn blendDifference(base: vec3f, blend: vec3f) -> vec3f {
  return abs(base - blend);
}

// 24: Classic Difference (same as Difference for standard cases)
fn blendClassicDifference(base: vec3f, blend: vec3f) -> vec3f {
  return abs(base - blend);
}

// 25: Exclusion
fn blendExclusion(base: vec3f, blend: vec3f) -> vec3f {
  return base + blend - 2.0 * base * blend;
}

// 26: Subtract
fn blendSubtract(base: vec3f, blend: vec3f) -> vec3f {
  return max(base - blend, vec3f(0.0));
}

// 27: Divide
fn blendDivide(base: vec3f, blend: vec3f) -> vec3f {
  return base / max(blend, vec3f(0.001));
}

// 28: Hue
fn blendHue(base: vec3f, blend: vec3f) -> vec3f {
  let baseHsl = rgbToHsl(base);
  let blendHsl = rgbToHsl(blend);
  return hslToRgb(vec3f(blendHsl.x, baseHsl.y, baseHsl.z));
}

// 29: Saturation
fn blendSaturation(base: vec3f, blend: vec3f) -> vec3f {
  let baseHsl = rgbToHsl(base);
  let blendHsl = rgbToHsl(blend);
  return hslToRgb(vec3f(baseHsl.x, blendHsl.y, baseHsl.z));
}

// 30: Color
fn blendColor(base: vec3f, blend: vec3f) -> vec3f {
  let baseHsl = rgbToHsl(base);
  let blendHsl = rgbToHsl(blend);
  return hslToRgb(vec3f(blendHsl.x, blendHsl.y, baseHsl.z));
}

// 31: Luminosity
fn blendLuminosity(base: vec3f, blend: vec3f) -> vec3f {
  let baseHsl = rgbToHsl(base);
  let blendHsl = rgbToHsl(blend);
  return hslToRgb(vec3f(baseHsl.x, baseHsl.y, blendHsl.z));
}

// ============ Fragment Shader ============

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  // Apply transform to UV
  var uv = input.uv;

  // Center the UV coordinates
  uv = uv - vec2f(0.5);

  // For 3D rotation, we need to work in world coordinates where the panel
  // has its actual aspect ratio. The panel spans -0.5 to 0.5 in both U and V,
  // but in world space, a 16:9 panel is wider than tall.
  // We model this by scaling the Y coordinate to match the panel's real proportions.
  // posZ sets the initial depth: positive = closer (larger), negative = further (smaller)
  var p = vec3f(uv.x, uv.y / layer.outputAspect, layer.posZ);

  // Apply X rotation (tilt forward/back) - rotates around X axis
  // Positive angle tilts top away from viewer
  if (abs(layer.rotationX) > 0.0001) {
    let cosX = cos(-layer.rotationX);  // Negate for intuitive direction
    let sinX = sin(-layer.rotationX);
    p = vec3f(
      p.x,
      p.y * cosX - p.z * sinX,
      p.y * sinX + p.z * cosX
    );
  }

  // Apply Y rotation (turn left/right) - rotates around Y axis
  // Positive angle turns right side away from viewer
  if (abs(layer.rotationY) > 0.0001) {
    let cosY = cos(-layer.rotationY);  // Negate for intuitive direction
    let sinY = sin(-layer.rotationY);
    p = vec3f(
      p.x * cosY + p.z * sinY,
      p.y,
      -p.x * sinY + p.z * cosY
    );
  }

  // Apply Z rotation (spin) - rotates around Z axis (2D rotation in screen plane)
  if (abs(layer.rotationZ) > 0.0001) {
    let cosZ = cos(layer.rotationZ);
    let sinZ = sin(layer.rotationZ);
    p = vec3f(
      p.x * cosZ - p.y * sinZ,
      p.x * sinZ + p.y * cosZ,
      p.z
    );
  }

  // Apply perspective projection
  // perspectiveDist is the distance from camera to the panel plane
  // Higher values = weaker perspective (more orthographic)
  // Lower values = stronger perspective (more dramatic 3D effect)
  let perspectiveDist = max(layer.perspective, 0.5);
  let w = 1.0 - p.z / perspectiveDist;  // Homogeneous coordinate
  let projectedX = p.x / w;
  let projectedY = p.y / w;

  // Convert back from world coordinates to UV coordinates
  // Scale Y back up to UV range
  uv = vec2f(projectedX, projectedY * layer.outputAspect);

  // Undo user scale after rotation so forward transforms scale in local layer
  // space first, then rotate the scaled plane.
  uv = uv / vec2f(layer.scaleX, layer.scaleY);

  // Apply source aspect ratio correction (fit source into output)
  let aspectRatio = layer.sourceAspect / layer.outputAspect;
  if (aspectRatio > 1.0) {
    uv.y = uv.y * aspectRatio;
  } else {
    uv.x = uv.x / aspectRatio;
  }

  uv = uv + vec2f(0.5) - vec2f(layer.posX, layer.posY);

  // Clamp UV to valid range for sampling
  let clampedUV = clamp(uv, vec2f(0.0), vec2f(1.0));
  let transitionUV = getTransitionUv(clampedUV);
  let sourceUV = vec2f(layer.sourceRectX, layer.sourceRectY) +
    transitionUV * vec2f(layer.sourceRectWidth, layer.sourceRectHeight);

  // Sample both textures in uniform control flow
  let baseColor = textureSample(baseTexture, texSampler, input.uv);
  var layerColor = textureSample(layerTexture, texSampler, sourceUV);

  // Apply inline color effects (invert → brightness+contrast → saturation)
  // Zero-cost at defaults (brightness=0, contrast=1, saturation=1, invert=0)
  var ec = layerColor.rgb;
  ec = select(ec, 1.0 - ec, layer.inlineInvert == 1u);
  ec = clamp((ec + layer.inlineBrightness - 0.5) * layer.inlineContrast + 0.5, vec3f(0.0), vec3f(1.0));
  ec = mix(vec3f(getLuminosity(ec)), ec, layer.inlineSaturation);
  layerColor = vec4f(clamp(ec, vec3f(0.0), vec3f(1.0)), layerColor.a);

  // Check if UV is out of bounds - use this to mask the layer
  let outOfBounds = uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0;
  let maskAlpha = select(layerColor.a, 0.0, outOfBounds) * getTransitionAlpha(clampedUV);

  // Apply blend mode
  var blended: vec3f;
  var finalAlpha: f32 = maskAlpha * layer.opacity;

  switch (layer.blendMode) {
    // Normal modes
    case 0u: { blended = blendNormal(baseColor.rgb, layerColor.rgb); }
    case 1u: { blended = blendDissolve(baseColor.rgb, layerColor.rgb, input.uv, layer.opacity); finalAlpha = 1.0; }
    case 2u: { blended = blendDancingDissolve(baseColor.rgb, layerColor.rgb, input.uv, layer.opacity, layer.time); finalAlpha = 1.0; }
    // Darken modes
    case 3u: { blended = blendDarken(baseColor.rgb, layerColor.rgb); }
    case 4u: { blended = blendMultiply(baseColor.rgb, layerColor.rgb); }
    case 5u: { blended = blendColorBurn(baseColor.rgb, layerColor.rgb); }
    case 6u: { blended = blendClassicColorBurn(baseColor.rgb, layerColor.rgb); }
    case 7u: { blended = blendLinearBurn(baseColor.rgb, layerColor.rgb); }
    case 8u: { blended = blendDarkerColor(baseColor.rgb, layerColor.rgb); }
    // Lighten modes
    case 9u: { blended = blendAdd(baseColor.rgb, layerColor.rgb); }
    case 10u: { blended = blendLighten(baseColor.rgb, layerColor.rgb); }
    case 11u: { blended = blendScreen(baseColor.rgb, layerColor.rgb); }
    case 12u: { blended = blendColorDodge(baseColor.rgb, layerColor.rgb); }
    case 13u: { blended = blendClassicColorDodge(baseColor.rgb, layerColor.rgb); }
    case 14u: { blended = blendLinearDodge(baseColor.rgb, layerColor.rgb); }
    case 15u: { blended = blendLighterColor(baseColor.rgb, layerColor.rgb); }
    // Contrast modes
    case 16u: { blended = blendOverlay(baseColor.rgb, layerColor.rgb); }
    case 17u: { blended = blendSoftLight(baseColor.rgb, layerColor.rgb); }
    case 18u: { blended = blendHardLight(baseColor.rgb, layerColor.rgb); }
    case 19u: { blended = blendLinearLight(baseColor.rgb, layerColor.rgb); }
    case 20u: { blended = blendVividLight(baseColor.rgb, layerColor.rgb); }
    case 21u: { blended = blendPinLight(baseColor.rgb, layerColor.rgb); }
    case 22u: { blended = blendHardMix(baseColor.rgb, layerColor.rgb); }
    // Inversion modes
    case 23u: { blended = blendDifference(baseColor.rgb, layerColor.rgb); }
    case 24u: { blended = blendClassicDifference(baseColor.rgb, layerColor.rgb); }
    case 25u: { blended = blendExclusion(baseColor.rgb, layerColor.rgb); }
    case 26u: { blended = blendSubtract(baseColor.rgb, layerColor.rgb); }
    case 27u: { blended = blendDivide(baseColor.rgb, layerColor.rgb); }
    // Component modes
    case 28u: { blended = blendHue(baseColor.rgb, layerColor.rgb); }
    case 29u: { blended = blendSaturation(baseColor.rgb, layerColor.rgb); }
    case 30u: { blended = blendColor(baseColor.rgb, layerColor.rgb); }
    case 31u: { blended = blendLuminosity(baseColor.rgb, layerColor.rgb); }
    // Stencil/Silhouette modes - these affect alpha, not color
    case 32u: { // Stencil Alpha
      blended = baseColor.rgb;
      finalAlpha = layerColor.a * layer.opacity;
    }
    case 33u: { // Stencil Luma
      blended = baseColor.rgb;
      finalAlpha = getLuminosity(layerColor.rgb) * layer.opacity;
    }
    case 34u: { // Silhouette Alpha
      blended = baseColor.rgb;
      finalAlpha = (1.0 - layerColor.a) * layer.opacity;
    }
    case 35u: { // Silhouette Luma
      blended = baseColor.rgb;
      finalAlpha = (1.0 - getLuminosity(layerColor.rgb)) * layer.opacity;
    }
    case 36u: { // Alpha Add
      blended = layerColor.rgb;
      finalAlpha = min(baseColor.a + layerColor.a * layer.opacity, 1.0);
    }
    default: { blended = layerColor.rgb; }
  }

  // Apply mask in layer-local UV space so it follows position, scale, rotation,
  // and perspective transforms with the clip.
  if (layer.hasMask == 1u) {
    var maskValue = textureSample(maskTexture, texSampler, clampedUV).r;

    // Apply inversion in shader
    if (layer.maskInvert == 1u) {
      maskValue = 1.0 - maskValue;
    }
    finalAlpha = finalAlpha * maskValue;
  }

  // For stencil/silhouette modes, handle differently
  if (layer.blendMode >= 32u && layer.blendMode <= 35u) {
    // Stencil/Silhouette: multiply base by computed alpha
    return vec4f(blended * finalAlpha, finalAlpha);
  }

  // For alpha add mode
  if (layer.blendMode == 36u) {
    return vec4f(mix(baseColor.rgb, blended, layerColor.a * layer.opacity), finalAlpha);
  }

  // Apply opacity and alpha blending with bounds mask
  let alpha = select(finalAlpha, 0.0, outOfBounds);
  let result = mix(baseColor.rgb, blended, alpha);

  return vec4f(result, max(baseColor.a, alpha));
}
