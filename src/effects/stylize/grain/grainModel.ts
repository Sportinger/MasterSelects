/**
 * Film Grain contract, shared by the operator graph (`services/operators/grainEffectGraph.ts`),
 * the inspector note and the tests.
 *
 * - Grain is smooth value noise (two octaves of Random (Cell) integer hashes) on a cell grid of
 *   Size pixels of a 1080p frame, so the grain keeps its look at every render size. Size 1 is
 *   fine 35 mm grain, 3 is coarse 16 mm grain.
 * - Each frame shows a new pattern: the pattern index is round(time * 60 * Speed), so Speed 1
 *   changes the grain on every frame up to 60 fps, 0.4 about 24 times a second, 0 freezes it.
 *   Seed picks another pattern. The pattern is zero-mean, so the picture never pumps.
 * - Strength: grain = noise (unit standard deviation) * Amount * GRAIN_STRENGTH * response(luma).
 *   The response follows film: strongest in the midtones, weaker in deep shadows and highlights.
 * - Color mixes each channel from shared (monochrome) grain towards its own grain.
 */
export const GRAIN_REFERENCE_HEIGHT = 1080;
export const GRAIN_MIN_SIZE = 0.25;
export const GRAIN_PATTERNS_PER_SECOND = 60;
/** Inverse standard deviation of the two-octave value noise (octaves 1 and 1/2 at half weight). */
export const GRAIN_OCTAVES_NORMALIZE = 4.17;
/** Inverse standard deviation of one value-noise octave (per-channel color grain). */
export const GRAIN_CHANNEL_NORMALIZE = 4.67;
/** Amount 0.1 gives a standard deviation of 0.035 in the midtones: visible, calm film grain. */
export const GRAIN_STRENGTH = 0.35;
export const GRAIN_SHADOW_FLOOR = 0.3;
/** Pattern offsets stay below this many cells, keeping the hash inputs small and exact. */
export const GRAIN_PATTERN_SPAN = 4096;
export const GRAIN_PATTERN_STEP: readonly [number, number] = [0.7548776662466927, 0.5698402909980532];

const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Film-like grain response: midtones full, black and white at GRAIN_SHADOW_FLOOR. */
export function grainResponse(luma: number): number {
  const l = Math.min(1, Math.max(0, luma));
  return GRAIN_SHADOW_FLOOR + (1 - GRAIN_SHADOW_FLOOR) * 4 * l * (1 - l);
}

/** Pattern index shown at a timeline time. */
export const grainPatternIndex = (time: number, speed: number) => Math.floor(time * GRAIN_PATTERNS_PER_SECOND * speed + 0.5);

export function grainParamNotes(params: Record<string, unknown>): string[] {
  const notes: string[] = [];
  const size = finite(params.size, 1), chroma = finite(params.chroma, 0), speed = finite(params.speed, 1);
  if (size < GRAIN_MIN_SIZE) notes.push(`Size ${size} is below ${GRAIN_MIN_SIZE}; grain cannot be finer than ${GRAIN_MIN_SIZE} px and uses ${GRAIN_MIN_SIZE}.`);
  if (chroma < 0 || chroma > 1) notes.push(`Color ${chroma} is outside 0–1: below 0 the channels move against each other, above 1 the color grain is exaggerated.`);
  if (speed < 0) notes.push(`Speed ${speed} is below 0; the pattern changes as at Speed ${-speed}.`);
  return notes;
}
