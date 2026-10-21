/**
 * Colour-space conversions shared by the image graph nodes "sRGB to Linear", "Linear to sRGB",
 * "RGB to OkLCh" and "OkLCh to RGB": CPU references and the matching WGSL.
 *
 * - sRGB transfer: the exact piecewise IEC 61966-2-1 curve. Negative values mirror around zero
 *   and values above 1 continue the curve, so no input produces NaN.
 * - Oklab / OkLCh: Björn Ottosson's perceptual space (2020) on linear sRGB primaries.
 *   L is perceived lightness (0 black, 1 white), C chroma, h hue in turns (0..1, wrapped).
 *   Neutral colours (C below 1e-7) report hue 0 instead of an undefined angle.
 */
export type Rgb = [number, number, number];

export function srgbToLinear(value: number): number {
  const magnitude = Math.abs(value);
  return Math.sign(value) * (magnitude <= 0.04045 ? magnitude / 12.92 : ((magnitude + 0.055) / 1.055) ** 2.4);
}

export function linearToSrgb(value: number): number {
  const magnitude = Math.abs(value);
  return Math.sign(value) * (magnitude <= 0.0031308 ? magnitude * 12.92 : 1.055 * magnitude ** (1 / 2.4) - 0.055);
}

const LINEAR_TO_LMS = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
] as const;
const LMS_TO_LAB = [
  [0.2104542553, 0.7936177850, -0.0040720468],
  [1.9779984951, -2.4285922050, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.8086757660],
] as const;
const LAB_TO_LMS = [
  [1, 0.3963377774, 0.2158037573],
  [1, -0.1055613458, -0.0638541728],
  [1, -0.0894841775, -1.2914855480],
] as const;
const LMS_TO_LINEAR = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.7076147010],
] as const;
const TAU = 2 * Math.PI;
const NEUTRAL_CHROMA = 1e-7;

const multiply = (matrix: readonly (readonly number[])[], vector: readonly number[]): Rgb =>
  matrix.map(row => row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2]) as Rgb;

/** sRGB-encoded RGB → (L, C, h in turns). */
export function rgbToOklch(rgb: readonly number[]): Rgb {
  const lms = multiply(LINEAR_TO_LMS, rgb.map(srgbToLinear)).map(Math.cbrt);
  const [lightness, a, b] = multiply(LMS_TO_LAB, lms);
  const chroma = Math.hypot(a, b);
  const turns = chroma < NEUTRAL_CHROMA ? 0 : Math.atan2(b, a) / TAU;
  return [lightness, chroma, turns - Math.floor(turns)];
}

/** (L, C, h in turns) → sRGB-encoded RGB, not clamped: out-of-gamut colours leave 0..1. */
export function oklchToRgb(lch: readonly number[]): Rgb {
  const [lightness, chroma, turns] = lch;
  const lms = multiply(LAB_TO_LMS, [lightness, chroma * Math.cos(turns * TAU), chroma * Math.sin(turns * TAU)]).map(value => value ** 3);
  return multiply(LMS_TO_LINEAR, lms).map(linearToSrgb) as Rgb;
}

const wgslMatrix = (matrix: readonly (readonly number[])[]) =>
  `mat3x3f(${[0, 1, 2].map(column => matrix.map(row => row[column].toFixed(10)).join(', ')).join(', ')})`;

/** Inline per-pixel expressions; `value` must be a plain identifier (it is repeated). */
export const srgbToLinearWgsl = (value: string) =>
  `(sign(${value}) * select(pow((abs(${value}) + 0.055) / 1.055, vec3f(2.4)), abs(${value}) / 12.92, abs(${value}) <= vec3f(0.04045)))`;
export const linearToSrgbWgsl = (value: string) =>
  `(sign(${value}) * select(1.055 * pow(abs(${value}), vec3f(1.0 / 2.4)) - 0.055, abs(${value}) * 12.92, abs(${value}) <= vec3f(0.0031308)))`;

/** Helper functions for the OkLCh nodes; emitted only when a graph uses them. */
export const IMAGE_OKLCH_WGSL = `fn imageGraphRgbToOklch(rgb: vec3f) -> vec3f {
  let linear = ${srgbToLinearWgsl('rgb')};
  let lms = ${wgslMatrix(LINEAR_TO_LMS)} * linear;
  let lab = ${wgslMatrix(LMS_TO_LAB)} * (sign(lms) * pow(abs(lms), vec3f(1.0 / 3.0)));
  let chroma = length(lab.yz);
  let turns = select(atan2(lab.z, lab.y) / ${TAU.toFixed(10)}, 0.0, chroma < ${NEUTRAL_CHROMA.toFixed(8)});
  return vec3f(lab.x, chroma, fract(turns));
}
fn imageGraphOklchToRgb(lch: vec3f) -> vec3f {
  let angle = lch.z * ${TAU.toFixed(10)};
  let root = ${wgslMatrix(LAB_TO_LMS)} * vec3f(lch.x, lch.y * cos(angle), lch.y * sin(angle));
  let linear = ${wgslMatrix(LMS_TO_LINEAR)} * (root * root * root);
  return ${linearToSrgbWgsl('linear')};
}`;
