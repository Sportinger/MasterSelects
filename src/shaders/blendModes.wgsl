// Shared RGB blend functions for timeline compositing and sequence blending.
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

