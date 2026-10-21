/**
 * Threshold and Posterize contract, shared by their operator graphs
 * (`services/operators/pointwiseEffectGraphs.ts`), the parameter notes and the tests.
 *
 * - Threshold: white where the Rec.709 brightness is above Level, black elsewhere. Softness
 *   (a brightness width) turns the hard step into a smooth ramp from Level - Softness / 2 to
 *   Level + Softness / 2. Softness 0 is the earlier strict comparison.
 * - Posterize: each channel snaps to Levels even steps, floor(v * L) / (L - 1) limited to 0-1
 *   (L at least MIN_POSTERIZE_LEVELS). Softness (share of a step) rounds every step edge into a
 *   smooth ramp of that width centred on the edge. Softness 0 is the earlier staircase.
 * Alpha is always kept.
 */
export const MIN_POSTERIZE_LEVELS = 2;
/** Ramp widths below this are treated as this, only to keep the division finite. */
export const SOFTNESS_FLOOR = 1e-4;

const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };

/** Threshold of one brightness value (reference for the tests). */
export function thresholdValue(luma: number, level: number, softness: number): number {
  if (!(softness > 0)) return luma > level ? 1 : 0;
  return smooth((luma - level) / Math.max(softness, SOFTNESS_FLOOR) + 0.5);
}

/** Posterize of one channel value (reference for the tests). */
export function posterizeValue(value: number, levels: number, softness: number): number {
  const l = Math.max(levels, MIN_POSTERIZE_LEVELS), v = value * l;
  let steps = Math.floor(v);
  if (softness > 0) {
    const shifted = v - 0.5, base = Math.floor(shifted);
    steps = base + smooth((shifted - base - 0.5) / Math.max(softness, SOFTNESS_FLOOR) + 0.5);
  }
  return Math.min(1, Math.max(0, steps / (l - 1)));
}

export function thresholdParamNotes(params: Record<string, unknown>): string[] {
  const softness = finite(params.softness, 0);
  return softness < 0 ? [`Softness ${softness} is below 0; it is used as 0 (a hard edge).`] : [];
}

export function posterizeParamNotes(params: Record<string, unknown>): string[] {
  const notes: string[] = [];
  const levels = finite(params.levels, 6), softness = finite(params.softness, 0);
  if (levels < MIN_POSTERIZE_LEVELS) notes.push(`Levels ${levels} is below ${MIN_POSTERIZE_LEVELS}; it is used as ${MIN_POSTERIZE_LEVELS}.`);
  else if (!Number.isInteger(levels)) notes.push(`Levels ${levels} is not a whole number; the top step is narrower than the others.`);
  if (softness < 0) notes.push(`Softness ${softness} is below 0; it is used as 0 (hard steps).`);
  return notes;
}
