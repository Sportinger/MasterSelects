/**
 * Film Grain contract, shared by the operator graph (`services/operators/grainEffectGraph.ts`),
 * the inspector note and the tests.
 *
 * - Grain is smooth value noise (Random (Cell) integer hashes, smoothstep-blended) on a cell
 *   grid of Size pixels of a 1080p frame, so the grain keeps its look at every render size.
 *   Three layers of it, turned by 0°, 30° and 60° against each other, hide the square grid a
 *   single layer shows at coarse sizes. Size 1 is fine 35 mm grain, 3 is coarse 16 mm grain.
 * - Each frame shows a new pattern: the pattern index is round(time * 60 * Speed), so Speed 1
 *   changes the grain on every frame up to 60 fps, 0.4 about 24 times a second, 0 freezes it.
 *   The index and Seed pick the pattern's offset through Random (Cell), exact up to index 2^24
 *   (77 hours at 60 patterns a second). The pattern is zero-mean, so the picture never pumps.
 * - Strength: grain = noise (unit standard deviation) * Amount * GRAIN_STRENGTH * response(luma).
 *   The response follows film: full in the midtones, GRAIN_SHADOW_FLOOR of it in black and white.
 * - Color mixes each channel from shared (monochrome) grain towards its own grain.
 */
export const GRAIN_REFERENCE_HEIGHT = 1080;
export const GRAIN_MIN_SIZE = 0.25;
export const GRAIN_PATTERNS_PER_SECOND = 60;
/** Variance of one smoothstep value-noise layer of uniform 0-1 corners: (26/35)^2 / 12. */
const GRAIN_LAYER_VARIANCE = (26 / 35) ** 2 / 12;
/** Inverse standard deviation of the three-layer monochrome grain. */
export const GRAIN_LAYERS_NORMALIZE = 1 / Math.sqrt(3 * GRAIN_LAYER_VARIANCE);
/** Inverse standard deviation of one value-noise layer (per-channel color grain). */
export const GRAIN_CHANNEL_NORMALIZE = 1 / Math.sqrt(GRAIN_LAYER_VARIANCE);
/** Grid turn of each monochrome layer, in full turns (0°, 30°, 60°), and of the red, green and blue layers (15°, 45°, 75°). */
export const GRAIN_LAYER_TURNS: readonly [number, number, number] = [0, 1 / 12, 1 / 6];
export const GRAIN_CHANNEL_TURNS: readonly [number, number, number] = [1 / 24, 1 / 8, 5 / 24];
/** Amount 0.1 gives a standard deviation of 0.035 in the midtones: visible, calm film grain. */
export const GRAIN_STRENGTH = 0.35;
export const GRAIN_SHADOW_FLOOR = 0.3;
/** Pattern offsets stay below this many cells, keeping the noise positions small and exact. */
export const GRAIN_PATTERN_SPAN = 4096;
/** The second offset axis hashes (index, Seed + this). */
export const GRAIN_SEED_ROW = 7919;

const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Film-like grain response: midtones full, black and white at GRAIN_SHADOW_FLOOR. */
export function grainResponse(luma: number): number {
  const l = Math.min(1, Math.max(0, luma));
  return GRAIN_SHADOW_FLOOR + (1 - GRAIN_SHADOW_FLOOR) * 4 * l * (1 - l);
}

export function grainParamNotes(params: Record<string, unknown>): string[] {
  const notes: string[] = [];
  const size = finite(params.size, 1), chroma = finite(params.chroma, 0), speed = finite(params.speed, 1);
  if (size < GRAIN_MIN_SIZE) notes.push(`Size ${size} is below ${GRAIN_MIN_SIZE}; grain cannot be finer than ${GRAIN_MIN_SIZE} px and uses ${GRAIN_MIN_SIZE}.`);
  if (chroma < 0 || chroma > 1) notes.push(`Color ${chroma} is outside 0–1: below 0 the channels move against each other, above 1 the color grain is exaggerated.`);
  if (speed < 0) notes.push(`Speed ${speed} is below 0; the pattern changes as at Speed ${-speed}.`);
  if (Math.abs(speed) > 1) notes.push(`Speed ${speed} changes nothing above 1: at Speed 1 the grain is already new on every frame (up to 60 fps).`);
  return notes;
}
