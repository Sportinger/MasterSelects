// Shadows / Highlights tone controls of the primary corrector.
//
// Both controls reshape luma and rescale RGB by the luma ratio, so hue and
// saturation survive instead of being washed out by an added grey.
// - Shadows is a bump below mid grey: black stays pinned at zero, mid grey is
//   untouched and the curve joins the identity with a continuous slope.
// - Negative Highlights rolls off above the knee with a soft shoulder; at -1
//   every value, including overexposure above 1.0, lands below white.
// - Positive Highlights expands the range above the knee.
//
// The WGSL copy below must stay numerically identical to the TypeScript path.

export const SHADOW_TONE_RANGE = 0.5;
export const SHADOW_TONE_LIFT_STRENGTH = 2;
export const SHADOW_TONE_CRUSH_STRENGTH = 1;
export const HIGHLIGHT_TONE_KNEE = 0.5;
export const HIGHLIGHT_TONE_RECOVERY_STRENGTH = 1 / (1 - HIGHLIGHT_TONE_KNEE);
export const HIGHLIGHT_TONE_BOOST_STRENGTH = 1;
const MIN_TONE_LUMA = 0.00001;

function toneLuma(red: number, green: number, blue: number): number {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

export function shadowHighlightToneLuma(luma: number, shadows: number, highlights: number): number {
  if (luma <= 0) return luma;
  if (luma < SHADOW_TONE_RANGE) {
    const u = luma / SHADOW_TONE_RANGE;
    const strength = shadows >= 0 ? SHADOW_TONE_LIFT_STRENGTH : SHADOW_TONE_CRUSH_STRENGTH;
    return luma + shadows * strength * SHADOW_TONE_RANGE * u * (1 - u) * (1 - u);
  }
  const above = luma - HIGHLIGHT_TONE_KNEE;
  if (highlights < 0) {
    return HIGHLIGHT_TONE_KNEE + above / (1 - highlights * HIGHLIGHT_TONE_RECOVERY_STRENGTH * above);
  }
  return HIGHLIGHT_TONE_KNEE + above * (1 + highlights * HIGHLIGHT_TONE_BOOST_STRENGTH * above);
}

export function applyShadowHighlightTone(
  red: number,
  green: number,
  blue: number,
  shadows: number,
  highlights: number,
): [number, number, number] {
  if (shadows === 0 && highlights === 0) return [red, green, blue];
  const luma = toneLuma(red, green, blue);
  if (luma <= MIN_TONE_LUMA) return [red, green, blue];
  let ratio = shadowHighlightToneLuma(luma, shadows, highlights) / luma;
  // Lifting dark saturated colours must not push a channel past white.
  if (luma < SHADOW_TONE_RANGE && ratio > 1) {
    ratio = Math.min(ratio, Math.max(1, 1 / Math.max(red, green, blue)));
  }
  return [red * ratio, green * ratio, blue * ratio];
}

export const SHADOW_HIGHLIGHT_TONE_WGSL = `
fn shadowHighlightToneLuma(toneLuma: f32, shadows: f32, highlights: f32) -> f32 {
  if (toneLuma <= 0.0) {
    return toneLuma;
  }
  if (toneLuma < ${SHADOW_TONE_RANGE.toFixed(6)}) {
    let u = toneLuma / ${SHADOW_TONE_RANGE.toFixed(6)};
    let strength = select(${SHADOW_TONE_CRUSH_STRENGTH.toFixed(6)}, ${SHADOW_TONE_LIFT_STRENGTH.toFixed(6)}, shadows >= 0.0);
    return toneLuma + shadows * strength * ${SHADOW_TONE_RANGE.toFixed(6)} * u * (1.0 - u) * (1.0 - u);
  }
  let above = toneLuma - ${HIGHLIGHT_TONE_KNEE.toFixed(6)};
  if (highlights < 0.0) {
    return ${HIGHLIGHT_TONE_KNEE.toFixed(6)} + above / (1.0 - highlights * ${HIGHLIGHT_TONE_RECOVERY_STRENGTH.toFixed(6)} * above);
  }
  return ${HIGHLIGHT_TONE_KNEE.toFixed(6)} + above * (1.0 + highlights * ${HIGHLIGHT_TONE_BOOST_STRENGTH.toFixed(6)} * above);
}

fn applyShadowHighlightTone(rgb: vec3f, shadows: f32, highlights: f32) -> vec3f {
  let toneY = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
  if ((shadows == 0.0 && highlights == 0.0) || toneY <= ${MIN_TONE_LUMA.toFixed(6)}) {
    return rgb;
  }
  var ratio = shadowHighlightToneLuma(toneY, shadows, highlights) / toneY;
  if (toneY < ${SHADOW_TONE_RANGE.toFixed(6)} && ratio > 1.0) {
    ratio = min(ratio, max(1.0, 1.0 / max(max(rgb.r, rgb.g), rgb.b)));
  }
  return rgb * ratio;
}
`;
