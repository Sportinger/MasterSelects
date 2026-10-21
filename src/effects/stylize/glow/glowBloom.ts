/**
 * Glow (bloom) contract, shared by the operator graph (`services/operators/glowBloomEffectGraph.ts`),
 * the inspector note and the tests.
 *
 * 1. Bright pass (full size): light = rgb * alpha * contribution(peak), peak = max(r, g, b).
 *    contribution follows a soft knee around Threshold: below `threshold - knee` nothing glows,
 *    above `threshold + knee` the part over the threshold glows, in between a quadratic blend;
 *    knee = Softness * Threshold. Taking the brightest channel lets saturated lights glow too.
 * 2. Pyramid: the light is halved in size GLOW_LEVELS times (1/2 … 1/1024 of the frame) with a
 *    [1 3 3 1] filter, then added back up from the smallest level with a 3x3 tent. Every level
 *    is a softer, wider copy; together they give the long, smooth falloff of a lens bloom.
 * 3. Radius (pixels of a 1080p frame) switches levels on: level k joins smoothly as Radius grows
 *    from half its size to its size. The finest level always glows. Alpha carries the summed
 *    level weights, so the glow keeps the energy of the light at any Radius.
 * 4. Resolve: premultiplied source + glow * Amount * Color; alpha grows to carry the halo, so a
 *    title on a transparent layer gets its glow outside the letters too.
 */
export const GLOW_LEVELS = 10;
/** Radius unit: pixels on a frame whose shorter side is 1080. */
export const GLOW_REFERENCE_HEIGHT = 1080;
/** Glow reach of a pyramid level, in its own texels: level k reaches about this * 2^k pixels. */
export const GLOW_LEVEL_REACH = 1.5;
export const GLOW_KNEE_FLOOR = 1e-5;
export const GLOW_PEAK_FLOOR = 1e-4;

export interface GlowParams { amount?: unknown; threshold?: unknown; softness?: unknown; radius?: unknown; [key: string]: unknown }

const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const smoothstep01 = (value: number) => { const t = Math.min(1, Math.max(0, value)); return t * t * (3 - 2 * t); };

/** Share of the light that glows, for a pixel whose brightest channel is `peak`. */
export function glowContribution(peak: number, threshold: number, softness: number): number {
  const t = Math.max(0, threshold), knee = Math.max(t * Math.max(0, softness), GLOW_KNEE_FLOOR);
  const soft = Math.min(2 * knee, Math.max(0, peak - t + knee));
  return Math.max(soft * soft / (4 * knee), peak - t) / Math.max(peak, GLOW_PEAK_FLOOR);
}

/** Weight of pyramid level k (1-based) for a Radius on a frame whose shorter side is `shortSide` pixels. */
export function glowLevelWeight(level: number, radius: number, shortSide: number): number {
  if (level <= 1) return 1;
  const levelShortSide = shortSide / 2 ** level;
  const position = Math.log2(Math.max(radius, 1e-3) * levelShortSide / (GLOW_LEVEL_REACH * GLOW_REFERENCE_HEIGHT)) + 1;
  return smoothstep01(position);
}

/** Largest Radius (1080p pixels) that still widens the glow on this frame. */
export function glowMaxRadius(shortSide: number): number {
  return GLOW_LEVEL_REACH * 2 ** GLOW_LEVELS * GLOW_REFERENCE_HEIGHT / Math.max(1, shortSide);
}

/** Inspector and tool notes for values the graph limits at this frame size; empty when Glow renders them as set. */
export function glowParamNotes(params: GlowParams, width = 1920, height = 1080): string[] {
  const notes: string[] = [];
  const amount = finite(params.amount, 1), threshold = finite(params.threshold, 0.6);
  const softness = finite(params.softness, 0.5), radius = finite(params.radius, 40);
  if (amount < 0) notes.push(`Amount ${amount} is below 0; Glow adds no light below 0 and uses 0.`);
  if (threshold < 0) notes.push(`Threshold ${threshold} is below 0; it is used as 0 (everything glows).`);
  if (softness < 0) notes.push(`Softness ${softness} is below 0; it is used as 0 (hard threshold).`);
  if (radius < 0) notes.push(`Radius ${radius} is below 0; it is used as 0 (the tightest glow).`);
  const reach = glowMaxRadius(Math.max(1, Math.min(width, height)));
  if (radius > reach) notes.push(`Radius above ${Math.round(reach)} no longer widens the glow at ${width}x${height} (the largest glow level is reached).`);
  return notes;
}
