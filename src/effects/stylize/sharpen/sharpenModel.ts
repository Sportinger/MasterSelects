/**
 * Sharpen contract, shared by the operator graph (`services/operators/sharpenEffectGraph.ts`)
 * and the tests.
 *
 * - Unsharp mask on brightness: detail = luma - luma(blur), where the blur is a separable
 *   Gaussian of the premultiplied picture (sigma = Radius pixels of a 1080p frame), so
 *   transparent surroundings never darken an edge. Adding the same brightness change to R, G
 *   and B sharpens without colour fringes.
 * - Halo limit: the smooth darkest and brightest brightness of the neighbourhood within
 *   ±SHARPEN_WINDOW_SIGMAS sigma (at least ±1 px), taken densely, one pixel apart, first along each
 *   row (in the horizontal blur pass) and then down a column of those rows (exponentially weighted
 *   means, SHARPEN_WINDOW_SHARPNESS per unit of brightness; transparent taps weigh nothing). The
 *   sharpened brightness passes unchanged within that range plus a margin (SHARPEN_OVERSHOOT of
 *   the range, at least SHARPEN_MARGIN_FLOOR); beyond it the excess e rolls off as
 *   s * ln(1 + e / s), s = SHARPEN_ROLL_OFF * margin. It keeps growing, so stronger settings keep
 *   adding contrast and neighbouring pixels keep their order (no plateaus), while halos at edges
 *   stay a small fraction of the edge.
 * - Amount scales the detail; negative values soften. Alpha is kept.
 */
import { GAUSSIAN_REACH_SIGMAS, SEPARABLE_MAX_PAIRS_PER_SIDE } from '../../blur/blurSampling';

export const SHARPEN_REFERENCE_HEIGHT = 1080;
export const SHARPEN_MIN_SIGMA_PX = 0.25;
/** Margin beyond the neighbourhood's range: this share of the range, at least SHARPEN_MARGIN_FLOOR. */
export const SHARPEN_OVERSHOOT = 0.05;
export const SHARPEN_MARGIN_FLOOR = 0.04;
/** Scale of the logarithmic roll-off beyond the margin, as a share of the margin. */
export const SHARPEN_ROLL_OFF = 0.5;
/** The window reaches this many sigma (the reach of the blur's halo). */
export const SHARPEN_WINDOW_SIGMAS = 2;
/** Window taps per side; wider windows space their taps further apart. */
export const SHARPEN_WINDOW_MAX_TAPS_PER_SIDE = 24;
/** Row extremes of a row without any opaque tap: far outside every range, so the column ignores them. */
export const SHARPEN_EMPTY_ROW = 8;
/** Exponent per unit of brightness of the smooth window minimum and maximum. */
export const SHARPEN_WINDOW_SHARPNESS = 64;
/** Window exponents are limited to ± this, so the sums stay finite for bright HDR values. */
export const SHARPEN_EXPONENT_LIMIT = 80;

const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Gaussian sigma in pixels for a Radius on a frame whose shorter side is `shortSide` pixels. */
export const sharpenSigmaPx = (radius: number, shortSide: number) => Math.max(SHARPEN_MIN_SIGMA_PX, radius * shortSide / SHARPEN_REFERENCE_HEIGHT);

/** Notes for values Sharpen limits at this frame size; empty when it renders them as set. */
export function sharpenParamNotes(params: Record<string, unknown>, width = 1920, height = 1080): string[] {
  const notes: string[] = [];
  const amount = finite(params.amount, 1), radius = finite(params.radius, 1);
  const shortSide = Math.max(1, Math.min(width, height));
  if (amount < 0) notes.push(`Amount ${amount} is below 0: Sharpen softens instead.`);
  if (radius * shortSide / SHARPEN_REFERENCE_HEIGHT < SHARPEN_MIN_SIGMA_PX) notes.push(`Radius ${radius} is finer than ${SHARPEN_MIN_SIGMA_PX} px at ${width}x${height}; it is used as ${SHARPEN_MIN_SIGMA_PX} px.`);
  const reach = sharpenSigmaPx(radius, shortSide) * GAUSSIAN_REACH_SIGMAS;
  const windowReach = Math.max(1, sharpenSigmaPx(radius, shortSide) * SHARPEN_WINDOW_SIGMAS);
  if (windowReach > SHARPEN_WINDOW_MAX_TAPS_PER_SIDE) notes.push(`Radius ${radius} makes the halo window reach ${Math.round(windowReach)} px at ${width}x${height}; its ${SHARPEN_WINDOW_MAX_TAPS_PER_SIDE} taps per side are ${(windowReach / SHARPEN_WINDOW_MAX_TAPS_PER_SIDE).toFixed(1)} px apart, so thin bright or dark lines between them can still draw a halo.`);
  if (reach > 2 * SEPARABLE_MAX_PAIRS_PER_SIDE) notes.push(`Radius ${radius} reaches ${Math.round(reach)} px at ${width}x${height}, beyond the ${2 * SEPARABLE_MAX_PAIRS_PER_SIDE} px a pass reads texel by texel; fine detail can shimmer.`);
  return notes;
}
