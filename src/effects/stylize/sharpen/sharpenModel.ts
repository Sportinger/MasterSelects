/**
 * Sharpen contract, shared by the operator graph (`services/operators/sharpenEffectGraph.ts`)
 * and the tests.
 *
 * - Unsharp mask on brightness: detail = luma - luma(blur), where the blur is a separable
 *   Gaussian of the premultiplied picture (sigma = Radius pixels of a 1080p frame), so
 *   transparent surroundings never darken an edge. Adding the same brightness change to R, G
 *   and B sharpens without colour fringes.
 * - Halo limit: SHARPEN_WINDOW_TAPS x SHARPEN_WINDOW_TAPS taps spread evenly over ±max(sigma, 1)
 *   pixels give a smooth darkest and brightest brightness of the neighbourhood (exponentially
 *   weighted means, SHARPEN_WINDOW_SHARPNESS per unit of brightness; transparent taps weigh
 *   nothing). The change may approach that range plus SHARPEN_OVERSHOOT of it, softly:
 *   room * (1 - exp(-change / room)). Edges get crisp; halos stay small and strong settings keep
 *   their gradation instead of flattening into plateaus.
 * - Amount scales the detail; negative values soften. Alpha is kept.
 */
import { GAUSSIAN_REACH_SIGMAS, SEPARABLE_MAX_PAIRS_PER_SIDE } from '../../blur/blurSampling';

export const SHARPEN_REFERENCE_HEIGHT = 1080;
export const SHARPEN_MIN_SIGMA_PX = 0.25;
export const SHARPEN_OVERSHOOT = 0.15;
export const SHARPEN_WINDOW_TAPS = 5;
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
  if (reach > 2 * SEPARABLE_MAX_PAIRS_PER_SIDE) notes.push(`Radius ${radius} reaches ${Math.round(reach)} px at ${width}x${height}, beyond the ${2 * SEPARABLE_MAX_PAIRS_PER_SIDE} px a pass reads texel by texel; fine detail can shimmer.`);
  return notes;
}
