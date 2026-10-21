/**
 * Scanlines contract, shared by the operator graph (`services/operators/scanlinesEffectGraph.ts`),
 * the inspector note and the tests.
 *
 * - The line pattern is 0.5 + 0.5 * sin((v + time * Speed * 0.1) * Density * 100) over the frame
 *   height v (0–1), as before: Density 5 gives about 80 lines on any resolution.
 * - Lines closer than SCANLINES_FADE_END_PX pixels fade into an even darkening, fully gone below
 *   SCANLINES_FADE_START_PX: a small preview or a high Density shows no moiré, and the average
 *   brightness stays the same as with visible lines.
 * - gain = 1 - Opacity * (1 - pattern); Opacity is limited to 0–1. Alpha is kept.
 */
export const SCANLINES_PHASE_SCALE = 100;
export const SCANLINES_SCROLL_SCALE = 0.1;
export const SCANLINES_FADE_START_PX = 2;
export const SCANLINES_FADE_END_PX = 4;

const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Pixels from one line to the next on a frame `height` pixels tall. */
export const scanlinePeriodPx = (density: number, height: number) => 2 * Math.PI * height / Math.max(1e-6, Math.abs(density) * SCANLINES_PHASE_SCALE);

export function scanlinesParamNotes(params: Record<string, unknown>, width = 1920, height = 1080): string[] {
  const notes: string[] = [];
  const opacity = finite(params.opacity, 0.3), density = finite(params.density, 5);
  if (opacity < 0 || opacity > 1) notes.push(`Opacity ${opacity} is outside 0–1; it is used as ${opacity < 0 ? 0 : 1}.`);
  const period = scanlinePeriodPx(density, Math.max(1, height));
  if (period < SCANLINES_FADE_START_PX) {
    notes.push(`At Density ${density} the lines are ${period.toFixed(1)} px apart at ${width}x${height}, too close to show: they become an even darkening instead of flickering.`);
  } else if (period < SCANLINES_FADE_END_PX) {
    notes.push(`At Density ${density} the lines are ${period.toFixed(1)} px apart at ${width}x${height} and fade towards an even darkening to avoid flicker.`);
  }
  return notes;
}
