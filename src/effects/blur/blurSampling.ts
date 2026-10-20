/**
 * Shared blur sampling contract. The editable operator graphs
 * (`services/operators/blurEffectGraphs.ts`, `directionalBlurEffectGraphs.ts`), the WGSL
 * references (`separableBlur.wgsl`, `directionalBlur.wgsl`) and the unit tests follow it.
 *
 * Gaussian and Box Blur
 * - Radius is measured in pixels of a 1080p frame (shorter side 1080 px) and scales with
 *   the rendered size, so a reduced-quality preview, the export and a 4K composition show
 *   the same blur relative to the picture. On 1080p frames a radius is a pixel radius.
 * - Gaussian: sigma = radius / 2, truncated at 3 sigma. The legacy grid grew with
 *   radius^2 / (3 * samples): at its default (Samples 5) the two agree near radius 10;
 *   small radii are now stronger (radius 3: 2.5x) and large ones about 20 % softer, so
 *   saved projects change look. Box gives full weight inside the radius plus a fractional
 *   edge tap, so animated radii change smoothly.
 * - Separable: the source is premultiplied into an rgba16float cache, then a horizontal
 *   pass (cached) and a vertical pass. Each pass reads a pair of neighbouring texels with one
 *   linear-filtered tap at their weighted centre (exact for any weights, because the texels
 *   are already premultiplied), plus the centre texel: 2 * pairs + 1 reads per pass.
 * - Straight alpha is restored at the end, so transparent surroundings do not darken the
 *   edges of a layer.
 *
 * Motion, Zoom and Radial Blur (two stages)
 * Every sample path is a one-parameter transform group T(u): a translation (Motion), a
 * log-scale about the centre (Zoom, Radial Zoom) or a rotation about the centre (Radial
 * Spin). Stage A averages each pixel of the premultiplied source over a short box
 * u in [-h/2, h/2] with taps at most one pixel apart into an rgba16float cache. Stage B sums
 * coarse taps h apart over the full range and samples that cache. Because T(a) after T(b)
 * equals T(a + b), the boxes tile the range exactly: streaks stay continuous at any length
 * with about 2 * sqrt(2 * length) taps per pixel instead of one tap per pixel of streak length.
 * - Motion: the direction is the on-screen angle in pixels; the streak reaches
 *   Length * |(cos * W, sin * H)| to each side (the legacy UV length: a share of the width
 *   when horizontal, of the height when vertical).
 * - Negative amounts reverse the range (legacy behaviour): Motion draws the same streak,
 *   Zoom streaks inward, Radial Zoom outward, Spin turns the other way. Scales stay >= 0.05.
 */

/** Radius unit: pixels on a frame whose shorter side is this long. */
export const BLUR_REFERENCE_HEIGHT = 1080;
/** A sequence reduction holds 256 entries: the centre tap plus 127 pair taps per side. */
export const SEPARABLE_MAX_PAIRS_PER_SIDE = 127;
export const GAUSSIAN_SIGMA_PER_RADIUS = 0.5;
export const GAUSSIAN_REACH_SIGMAS = 3;
export const GAUSSIAN_SIGMA_MIN_PX = 1e-4;
export const DIRECTIONAL_MAX_COARSE_TAPS = 64;
export const DIRECTIONAL_MAX_FINE_TAPS = 256;
/** Legacy scale spans: Zoom samples scales 1 .. 1 + 0.5 * amount, Radial 1 - 0.2 * amount * distance .. 1. */
export const ZOOM_SCALE_PER_AMOUNT = 0.5;
export const RADIAL_SCALE_PER_AMOUNT = 0.2;
export const RADIAL_MIN_SCALE = 0.05;
/** Spin mode: total arc in radians per unit of Amount (Amount 1 = 20 degrees). */
export const SPIN_RADIANS_PER_AMOUNT = Math.PI / 9;

export type SeparableBlurKind = 'gaussian' | 'box';
export type DirectionalBlurType = 'motion-blur' | 'zoom-blur' | 'radial-blur';
export interface BlurTap { offset: number; weight: number }

const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
/** Uniform packing for the WGSL references: missing or non-finite values use the catalog default. */
export const finiteBlurParam = finite;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Rendered pixels per radius unit: the shorter frame side over 1080. */
export function blurPixelScale(width: number, height: number): number {
  return Math.min(width, height) / BLUR_REFERENCE_HEIGHT;
}

/** One axis of the separable kernel, after pair merging. Offsets are in texels. */
export function separableBlurTaps(kind: SeparableBlurKind, radius: number, width: number, height: number) {
  const radiusPx = Math.max(0, radius) * blurPixelScale(width, height);
  const sigma = Math.max(radiusPx * GAUSSIAN_SIGMA_PER_RADIUS, GAUSSIAN_SIGMA_MIN_PX);
  const reach = kind === 'gaussian' ? GAUSSIAN_REACH_SIGMAS * sigma : radiusPx + 1;
  const pairsNeeded = Math.ceil(reach / 2);
  const pairs = Math.min(pairsNeeded, SEPARABLE_MAX_PAIRS_PER_SIDE);
  // Beyond the tap budget the pair spacing widens instead of truncating the kernel.
  const stride = Math.max(1, reach / (2 * SEPARABLE_MAX_PAIRS_PER_SIDE));
  const weightAt = (x: number) => kind === 'gaussian'
    ? Math.exp(-(x * x) / ((2 * sigma) * sigma))
    : clamp(radiusPx + 1 - Math.abs(x), 0, 1);
  const taps: BlurTap[] = [];
  for (let index = 0; index <= 2 * pairs; index += 1) {
    const signed = index - pairs, magnitude = Math.abs(signed);
    const a = Math.max(2 * magnitude - 1, 0) * stride, b = 2 * magnitude * stride;
    const wa = weightAt(a) * Math.min(magnitude, 1), wb = weightAt(b), weight = wa + wb;
    const centre = (a * wa + b * wb) / Math.max(weight, 1e-20);
    taps.push({ offset: centre * (signed / Math.max(magnitude, 1)), weight });
  }
  return { radiusPx, sigma, reach, pairsNeeded, pairs, stride, clamped: pairsNeeded > pairs, taps };
}

export interface DirectionalBlurParams {
  amount?: unknown; angle?: unknown; centerX?: unknown; centerY?: unknown; mode?: unknown;
}

/** Transform family and per-pixel range in group units (pixels, log-scale or radians). */
export interface DirectionalBlurPlan {
  group: 'translate' | 'scale' | 'rotate';
  /** Unit direction in pixels (translate only). */
  direction: [number, number];
  /** Centre in pixels (scale and rotate). */
  center: [number, number];
  /** Start of the coarse range and its signed length for the pixel at `pixel` (px). */
  range: (pixel: [number, number]) => { start: number; length: number };
  /** Coarse taps over the longest range, box length h (group units) shared by every pixel. */
  coarseTaps: number;
  step: number;
  /** Pixels moved per group unit at `pixel` (1 for translations). */
  speed: (pixel: [number, number]) => number;
  /** Relative weight of a coarse tap at normalized position t (0..1) along the range. */
  taper: (t: number) => number;
}

/** Radial Blur's mode; missing or unknown values keep the legacy zoom look. */
export function radialBlurMode(mode: unknown): 'zoom' | 'spin' {
  return mode === 'spin' ? 'spin' : 'zoom';
}

export function directionalBlurPlan(type: DirectionalBlurType, params: DirectionalBlurParams, width: number, height: number): DirectionalBlurPlan {
  const amount = finite(params.amount, type === 'motion-blur' ? 0.05 : type === 'zoom-blur' ? 0.3 : 0.5);
  const center: [number, number] = [finite(params.centerX, 0.5) * width, finite(params.centerY, 0.5) * height];
  const farthest = Math.hypot(Math.max(center[0], width - center[0]), Math.max(center[1], height - center[1]));
  const radius = (pixel: [number, number]) => Math.hypot(pixel[0] - center[0], pixel[1] - center[1]);
  // Coarse taps balance both stages (~sqrt(2 * longest streak in px) each); every pixel shares the box length.
  const finish = (plan: Omit<DirectionalBlurPlan, 'coarseTaps' | 'step'>, signedLongest: number, signedLongestPx: number): DirectionalBlurPlan => {
    const longest = Math.abs(signedLongest), longestPx = Math.abs(signedLongestPx);
    const coarseTaps = clamp(Math.ceil(Math.sqrt(2 * longestPx)), 1, DIRECTIONAL_MAX_COARSE_TAPS);
    return { ...plan, coarseTaps, step: longest / coarseTaps };
  };
  if (type === 'motion-blur') {
    const angle = finite(params.angle, 0), direction: [number, number] = [Math.cos(angle), Math.sin(angle)];
    const half = motionBlurHalfLengthPx(amount, angle, width, height);
    return finish({ group: 'translate', direction, center,
      range: () => ({ start: -half, length: 2 * half }), speed: () => 1,
      taper: t => Math.exp(-2 * (2 * t - 1) * (2 * t - 1)) }, 2 * half, 2 * half);
  }
  if (type === 'zoom-blur') {
    const span = Math.log(Math.max(1 + ZOOM_SCALE_PER_AMOUNT * amount, RADIAL_MIN_SCALE));
    return finish({ group: 'scale', direction: [1, 0], center, range: () => ({ start: 0, length: span }),
      speed: radius, taper: () => 1 }, span, span * farthest);
  }
  if (radialBlurMode(params.mode) === 'spin') {
    const arc = amount * SPIN_RADIANS_PER_AMOUNT;
    return finish({ group: 'rotate', direction: [1, 0], center, range: () => ({ start: -arc / 2, length: arc }),
      speed: radius, taper: () => 1 }, arc, arc * farthest);
  }
  // Legacy radial zoom: scales 1 .. 1 - 0.2 * amount * uvDistance, inward, weight 1 - 0.5 t.
  const uvDistance = (pixel: [number, number]) => Math.hypot(pixel[0] / width - center[0] / width, pixel[1] / height - center[1] / height);
  const span = (pixel: [number, number]) => -Math.log(Math.max(1 - RADIAL_SCALE_PER_AMOUNT * amount * uvDistance(pixel), RADIAL_MIN_SCALE));
  const farthestUv = Math.hypot(Math.max(center[0], width - center[0]) / width, Math.max(center[1], height - center[1]) / height);
  const longest = Math.log(Math.max(1 - RADIAL_SCALE_PER_AMOUNT * amount * farthestUv, RADIAL_MIN_SCALE));
  return finish({ group: 'scale', direction: [1, 0], center, range: pixel => ({ start: 0, length: -span(pixel) }),
    speed: radius, taper: t => 1 - 0.5 * t }, longest, longest * farthest);
}

/** Motion Blur's reach to each side in pixels (signed like Length): Length * |(cos * W, sin * H)|. */
export function motionBlurHalfLengthPx(amount: number, angle: number, width: number, height: number): number {
  return amount * Math.hypot(Math.cos(angle) * width, Math.sin(angle) * height);
}

/** Longest streak of a directional blur in pixels (Motion: the whole streak; Zoom/Radial: at the farthest corner). */
export function directionalBlurStreakPx(type: DirectionalBlurType, params: DirectionalBlurParams, width: number, height: number): number {
  const plan = directionalBlurPlan(type, params, width, height);
  return plan.group === 'translate' ? plan.step * plan.coarseTaps
    : plan.step * plan.coarseTaps * Math.hypot(Math.max(plan.center[0], width - plan.center[0]), Math.max(plan.center[1], height - plan.center[1]));
}

/** Applies T(u) to a pixel position. */
export function transformDirectionalPixel(plan: DirectionalBlurPlan, pixel: [number, number], u: number): [number, number] {
  if (plan.group === 'translate') return [pixel[0] + plan.direction[0] * u, pixel[1] + plan.direction[1] * u];
  const dx = pixel[0] - plan.center[0], dy = pixel[1] - plan.center[1];
  if (plan.group === 'scale') { const scale = Math.exp(u); return [plan.center[0] + dx * scale, plan.center[1] + dy * scale]; }
  const cos = Math.cos(u), sin = Math.sin(u);
  return [plan.center[0] + dx * cos - dy * sin, plan.center[1] + dx * sin + dy * cos];
}

/** Stage A tap count at a pixel: enough for at most one pixel between taps. */
export function directionalFineTaps(plan: DirectionalBlurPlan, pixel: [number, number]): number {
  return clamp(Math.ceil(plan.step * plan.speed(pixel)), 1, DIRECTIONAL_MAX_FINE_TAPS);
}

/**
 * Stage B taps for one pixel: tap k sits at the centre of the part of box k that lies inside
 * the range, weighted by that covered share and the taper, so a range that is not a whole
 * number of boxes (Radial zoom) still changes smoothly.
 */
export function directionalCoarseTaps(plan: DirectionalBlurPlan, pixel: [number, number]): Array<{ u: number; weight: number }> {
  const { start, length } = plan.range(pixel), span = Math.abs(length), sign = length < 0 ? -1 : 1;
  const step = Math.max(plan.step, 1e-9), boxes = span / step;
  const count = clamp(Math.ceil(boxes - 1e-4), 1, DIRECTIONAL_MAX_COARSE_TAPS);
  return Array.from({ length: count }, (_, index) => {
    const covered = clamp(boxes - index, 0, 1), along = (index + 0.5 * covered) * step;
    return { u: start + sign * along, weight: plan.taper(along / Math.max(span, 1e-9)) * Math.max(covered, 1e-6) };
  });
}

/** Legacy two-unit mirror repeat of normalized coordinates (Motion Blur's edge rule; Zoom and Radial clamp). */
export function mirrorRepeat(value: number): number {
  const wrapped = value - Math.floor(value * 0.5) * 2;
  return wrapped > 1 ? 2 - wrapped : wrapped;
}

const isDirectional = (type: string): type is DirectionalBlurType => type === 'motion-blur' || type === 'zoom-blur' || type === 'radial-blur';

/**
 * Where a blur stops being exact at this frame size, in words for tool results and the
 * inspector (the limits act in the graph; they must not act silently). Empty when exact.
 */
export function blurBudgetNotes(type: string, params: Record<string, unknown>, width: number, height: number): string[] {
  if (type === 'gaussian-blur' || type === 'box-blur') {
    const radius = finite(params.radius, type === 'box-blur' ? 5 : 10);
    const taps = separableBlurTaps(type === 'gaussian-blur' ? 'gaussian' : 'box', radius, width, height);
    return taps.clamped ? [`Radius ${radius} reaches ${Math.round(taps.reach)} px on this ${width}×${height} frame, beyond the `
      + `${2 * SEPARABLE_MAX_PAIRS_PER_SIDE} px a pass reads texel by texel: its reads are spread ${taps.stride.toFixed(2)} px apart, so fine detail can shimmer.`] : [];
  }
  if (!isDirectional(type)) return [];
  const plan = directionalBlurPlan(type, params, width, height);
  const farthest = Math.hypot(Math.max(plan.center[0], width - plan.center[0]), Math.max(plan.center[1], height - plan.center[1]));
  const fineSpan = plan.step * (plan.group === 'translate' ? 1 : farthest);
  const notes: string[] = [];
  if (fineSpan > DIRECTIONAL_MAX_FINE_TAPS) notes.push(`The streak reaches ${Math.round(plan.step * plan.coarseTaps * (plan.group === 'translate' ? 1 : farthest))} px `
    + `on this ${width}×${height} frame, beyond the ${DIRECTIONAL_MAX_COARSE_TAPS} × ${DIRECTIONAL_MAX_FINE_TAPS} reads per pixel: reads are up to `
    + `${(fineSpan / DIRECTIONAL_MAX_FINE_TAPS).toFixed(1)} px apart, so the longest streaks can look stepped.`);
  const amount = finite(params.amount, type === 'motion-blur' ? 0.05 : type === 'zoom-blur' ? 0.3 : 0.5);
  const farUv = Math.hypot(Math.max(plan.center[0], width - plan.center[0]) / width, Math.max(plan.center[1], height - plan.center[1]) / height);
  const minimumScale = type === 'zoom-blur' ? 1 + ZOOM_SCALE_PER_AMOUNT * amount
    : plan.group === 'scale' ? 1 - RADIAL_SCALE_PER_AMOUNT * amount * farUv : 1;
  if (minimumScale < RADIAL_MIN_SCALE) notes.push(`Amount ${amount} would sample past the centre; the streaks stop at ${RADIAL_MIN_SCALE * 100} % of the distance to it.`);
  return notes;
}
