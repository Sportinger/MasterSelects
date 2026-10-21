/**
 * Glow (bloom) contract, shared by the operator graph (`services/operators/glowBloomEffectGraph.ts`),
 * the inspector note and the tests.
 *
 * 1. Bright pass (full size): light = rgb * alpha * glowShare(peak), peak = max(r, g, b).
 *    The share is a smooth ramp (smoothstep) from `Threshold - Softness * headroom` up to white
 *    (1), where all of a pixel's light glows; headroom = min(Threshold, 1 - Threshold), so the
 *    ramp never starts below 0 and stays close to a high Threshold. Taking the brightest channel
 *    lets saturated neon glow; lights near white glow fully, so the default Threshold 0.95 makes
 *    the lamps and neon of a night picture glow while a daylight sky (brightest channel about
 *    0.8) stays out of it. A Threshold of 1 or more glows only above white (HDR sources).
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
 *    and nothing passes white, so it never clips hard; very strong glows still approach white
 *    and wash the colours out. Alpha grows
 *    to carry the halo, so a title on a transparent layer gets its glow outside the letters too.
 */
export const GLOW_LEVELS = 10;
/** Radius unit: pixels on a frame whose shorter side is 1080. */
export const GLOW_REFERENCE_HEIGHT = 1080;
/** Glow reach of a pyramid level, in its own texels: level k reaches about this * 2^k pixels. */
export const GLOW_LEVEL_REACH = 1.5;
/** Reach (1080p pixels) of the finest level that renders fully: level 1 at 1080p. Finer levels fade out from it down to half of it. */
export const GLOW_FINEST_REACH = 3;
/** Smallest width of the bright-pass ramp, so a Threshold at or above white stays a clean step. */
export const GLOW_RAMP_FLOOR = 1e-3;
/** Defaults of the current Glow, shared by the definition, its uniform fallbacks and the worker tables. */
export const GLOW_DEFAULTS = { amount: 2.5, threshold: 0.95, softness: 0.5, radius: 80 } as const;

export interface GlowParams { amount?: unknown; threshold?: unknown; softness?: unknown; radius?: unknown; [key: string]: unknown }

const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const smoothstep01 = (value: number) => { const t = Math.min(1, Math.max(0, value)); return t * t * (3 - 2 * t); };

/** Start and end of the bright-pass ramp (brightest channel) for these values. */
export function glowRamp(threshold: number, softness: number): [number, number] {
  const t = Math.max(0, threshold), start = t - Math.max(0, softness) * Math.max(0, Math.min(t, 1 - t));
  return [start, Math.max(1, start + GLOW_RAMP_FLOOR)];
}

/** Share of the light that glows, for a pixel whose brightest channel is `peak`. */
export function glowContribution(peak: number, threshold: number, softness: number): number {
  const [start, end] = glowRamp(threshold, softness);
  return smoothstep01((peak - start) / (end - start));
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
  const amount = finite(params.amount, GLOW_DEFAULTS.amount), threshold = finite(params.threshold, GLOW_DEFAULTS.threshold);
  const softness = finite(params.softness, GLOW_DEFAULTS.softness), radius = finite(params.radius, GLOW_DEFAULTS.radius);
  if (amount < 0) notes.push(`Amount ${amount} is below 0; Glow adds no light below 0 and uses 0.`);
  if (threshold < 0) notes.push(`Threshold ${threshold} is below 0; it is used as 0 (everything glows).`);
  if (softness < 0) notes.push(`Softness ${softness} is below 0; it is used as 0 (hard threshold).`);
  if (glowRamp(threshold, softness)[0] >= 1) {
    notes.push(`Threshold ${threshold} is at or above white (1); only pixels brighter than white (HDR) glow, so an ordinary picture does not glow.`);
  }
  if (radius < 0) notes.push(`Radius ${radius} is below 0; it is used as 0 (the tightest glow).`);
  const reach = glowMaxRadius(Math.max(1, Math.min(width, height)));
  if (radius > reach) notes.push(`Radius above ${Math.round(reach)} no longer widens the glow at ${width}x${height} (the largest glow level is reached).`);
  return notes;
}
