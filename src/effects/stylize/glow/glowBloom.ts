/**
 * Glow (bloom) contract, shared by the operator graph (`services/operators/glowBloomEffectGraph.ts`),
 * the inspector note and the tests.
 *
 * 1. Bright pass (full size): light = rgb * alpha * contribution(peak), peak = max(r, g, b).
 *    contribution follows a soft knee around Threshold: below `threshold - knee` nothing glows,
 *    above `threshold + knee` the part over the threshold glows, in between a quadratic blend;
 *    knee = Softness * Threshold. Taking the brightest channel lets saturated lights glow too;
 *    the default Threshold 0.8 keeps a mid-bright daylight sky out of the glow.
 * 2. Pyramid: the light is halved in size GLOW_LEVELS times (1/2 … 1/1024 of the frame) with a
 *    [1 3 3 1] filter, then added back up from the smallest level with a 3x3 tent. Every level
 *    is a softer, wider copy; together they give the long, smooth falloff of a lens bloom.
 * 3. Radius (pixels of a 1080p frame) switches levels on: level k joins smoothly as Radius grows
 *    from half its reach to its reach (glowLevelWeight). Levels finer than GLOW_FINEST_REACH fade
 *    out, so 4K renders the same levels as 1080p. Level 0, the bright pass itself, stands for the
 *    1080p levels a smaller render cannot resolve (log2(min(Radius, its reach) / GLOW_FINEST_REACH)
 *    + 1 of them) and fills up to a total weight of 1 when the Radius is finer than the pyramid, so
 *    a reduced preview matches the export and a tiny Radius stays tight. The glow is divided by
 *    the square root of the summed weights.
 * 4. Resolve: picture = 1 - (1 - picture) * exp(-glow * Amount * Color) on premultiplied colour,
 *    a Screen with a soft roll-off: faint glows add their light, bright areas have less room left
 *    and nothing passes white, so colours keep their hue and the frame cannot clip. Alpha grows
 *    to carry the halo, so a title on a transparent layer gets its glow outside the letters too.
 */
export const GLOW_LEVELS = 10;
/** Radius unit: pixels on a frame whose shorter side is 1080. */
export const GLOW_REFERENCE_HEIGHT = 1080;
/** Glow reach of a pyramid level, in its own texels: level k reaches about this * 2^k pixels. */
export const GLOW_LEVEL_REACH = 1.5;
/** Reach (1080p pixels) of the finest level that renders fully: level 1 at 1080p. Finer levels fade out from it down to half of it. */
export const GLOW_FINEST_REACH = 3;
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

/** Reach of pyramid level k (0 = the full-size bright pass) in pixels of a 1080p frame, on a frame whose shorter side is `shortSide`. */
export const glowLevelReach = (level: number, shortSide: number) => GLOW_LEVEL_REACH * GLOW_REFERENCE_HEIGHT * 2 ** level / Math.max(1, shortSide);

/** Radius weight of level k before the level-0 fill: it joins from half its reach to its reach; levels finer than GLOW_FINEST_REACH fade out. */
export function glowLevelWeight(level: number, radius: number, shortSide: number): number {
  const reach = glowLevelReach(level, shortSide);
  return smoothstep01(Math.log2(Math.max(radius, 1e-3) / reach) + 1) * smoothstep01(Math.log2(reach / (GLOW_FINEST_REACH / 2)));
}

/** Weights of levels 0 … GLOW_LEVELS as the graph applies them (level 0: folded 1080p levels, at least what the pyramid lacks up to 1). */
export function glowLevelWeights(radius: number, shortSide: number): number[] {
  const weights = Array.from({ length: GLOW_LEVELS + 1 }, (_, level) => level ? glowLevelWeight(level, radius, shortSide) : 0);
  const pyramid = weights.reduce((sum, weight) => sum + weight, 0);
  const folded = Math.log2(Math.min(Math.max(radius, 1e-3), glowLevelReach(0, shortSide)) / GLOW_FINEST_REACH) + 1;
  weights[0] = Math.max(0, folded, 1 - pyramid);
  return weights;
}

/** Largest Radius (1080p pixels) that still widens the glow on this frame. */
export function glowMaxRadius(shortSide: number): number {
  return GLOW_LEVEL_REACH * 2 ** GLOW_LEVELS * GLOW_REFERENCE_HEIGHT / Math.max(1, shortSide);
}

/** Inspector and tool notes for values the graph limits at this frame size; empty when Glow renders them as set. */
export function glowParamNotes(params: GlowParams, width = 1920, height = 1080): string[] {
  const notes: string[] = [];
  const amount = finite(params.amount, 1.5), threshold = finite(params.threshold, 0.8);
  const softness = finite(params.softness, 0.5), radius = finite(params.radius, 40);
  if (amount < 0) notes.push(`Amount ${amount} is below 0; Glow adds no light below 0 and uses 0.`);
  if (threshold < 0) notes.push(`Threshold ${threshold} is below 0; it is used as 0 (everything glows).`);
  if (softness < 0) notes.push(`Softness ${softness} is below 0; it is used as 0 (hard threshold).`);
  if (threshold * (1 - Math.min(1, Math.max(0, softness))) >= 1) {
    notes.push(`Threshold ${threshold} with Softness ${softness} starts above white (1); nothing glows unless the picture is brighter than white.`);
  }
  if (radius < 0) notes.push(`Radius ${radius} is below 0; it is used as 0 (the tightest glow).`);
  const reach = glowMaxRadius(Math.max(1, Math.min(width, height)));
  if (radius > reach) notes.push(`Radius above ${Math.round(reach)} no longer widens the glow at ${width}x${height} (the largest glow level is reached).`);
  return notes;
}
