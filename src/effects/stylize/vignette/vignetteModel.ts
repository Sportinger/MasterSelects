/**
 * Vignette contract, shared by the operator graph (`services/operators/vignetteEffectGraph.ts`),
 * the inspector note and the tests.
 *
 * - Distance d from the centre is measured in pixels and normalized so every corner is at
 *   d = 1, on any resolution and aspect. Roundness 1 is a true circle; 0 follows the frame
 *   (an ellipse touching all four edges at the same d); values between blend the two.
 * - The darkening starts at d = Size and is complete at d = Size + Softness (smoothstep). A
 *   minimum feather of VIGNETTE_MIN_FEATHER_PX pixels keeps even Softness 0 free of jagged edges.
 * - gain = 1 - Amount * falloff, applied to the colour (alpha is kept); negative Amount
 *   brightens the edges. A tiny dither (at most half an 8-bit step, only where the gain
 *   changes the picture) keeps dark gradients free of banding.
 */
export const VIGNETTE_MIN_FEATHER_PX = 1.5;
export const VIGNETTE_DITHER = 1 / 255;

const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Normalized distance (corners at 1) of a pixel centre for a Roundness between 0 and 1. */
export function vignetteDistance(x: number, y: number, width: number, height: number, roundness: number): number {
  const r = Math.min(1, Math.max(0, roundness)), half = Math.hypot(width, height) / 2;
  const sx = (1 - r) * Math.SQRT2 + r * width / half, sy = (1 - r) * Math.SQRT2 + r * height / half;
  const corner = 0.5 * Math.hypot(sx, sy);
  return Math.hypot((x / width - 0.5) * sx, (y / height - 0.5) * sy) / corner;
}

export function vignetteParamNotes(params: Record<string, unknown>): string[] {
  const notes: string[] = [];
  const softness = finite(params.softness, 0.5), roundness = finite(params.roundness, 1);
  if (softness < 0) notes.push(`Softness ${softness} is below 0; it is used as 0 (the sharpest edge).`);
  if (roundness < 0 || roundness > 1) notes.push(`Roundness ${roundness} is outside 0–1; it is used as ${roundness < 0 ? 0 : 1}.`);
  // Every corner is at distance 1, so a falloff that starts there darkens nothing. The slider keeps
  // its 0-1.5 range because Vignettes saved before 2026-10-21 (corners at about 1.41) still use it.
  const size = finite(params.size, 0.5);
  if (size >= 1) notes.push(`Size ${size} starts the darkening at or past the corners (1), so nothing darkens; use a Size below 1.`);
  const amount = finite(params.amount, 0.5);
  if (amount > 1) notes.push(`Amount ${amount} is above 1: the edges reach black before Size + Softness.`);
  return notes;
}
