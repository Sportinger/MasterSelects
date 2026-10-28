import type { GraphPort } from './blurGraphBuilder';
import type { AnalogRecipeBuilder } from './analogRecipeBuilder';

/**
 * Seeded random rolls and 1080p sizes shared by the Glitch / Data recipes (Block Dissolve, Data HUD).
 * Random keys are exact integers below 2^24 (cell indices and states folded by integer modulo, integer
 * salts), so the GPU (f32) and the CPU worker path (f64) hash the same bits.
 *
 * Contract: the recipe defines the constants `zero`, `one` and `half`, calls `keyConstants`, and for
 * `seedSalt` has a clamped `seed-clamped` value.
 */
/** Cell indices and states fold into [0, KEY_RANGE); KEY_RANGE² = 2^24. */
export const KEY_RANGE = 4096;
/** Shifts signed cell indices into the key range (cells are at least 2 px of a 1080p frame, so frames stay far below 4096 cells across). */
export const INDEX_OFFSET = 2048;
/** Distinct roll kinds per recipe: integer salts below SALT_KINDS in the key's x component. */
export const SALT_KINDS = 16;
/** The seed folds into [0, SEED_KEYS): (salt + SALT_KINDS × seed) stays below KEY_RANGE / 16. */
export const SEED_KEYS = 16;

export function keyConstants(g: AnalogRecipeBuilder): void {
  g.number('key-range', KEY_RANGE); g.number('index-offset', INDEX_OFFSET);
}

/** value mod divisor for non-negative integers, robust to the GPU's approximate division. */
export function modulo(g: AnalogRecipeBuilder, id: string, value: GraphPort, divisor: number | string) {
  const d = typeof divisor === 'number' ? g.number(`${id}-divisor`, divisor) : divisor;
  const quotient = g.fn(`${id}-quotient`, 'floor', g.div(`${id}-ratio`, g.plus(`${id}-rounded`, value, 'half'), d));
  return g.sub(id, value, g.mul(`${id}-multiple`, quotient, d));
}

/** A 1080p-pixel size → whole rendered pixels, at least one (`pixel-scale` = shorter side / 1080). */
export function renderedPixels(g: AnalogRecipeBuilder, id: string, size: GraphPort) {
  pixelScale(g);
  return g.max(id, g.fn(`${id}-rounded`, 'floor', g.plus(`${id}-shifted`, g.mul(`${id}-scaled`, size, 'pixel-scale'), 'half')), 'one');
}

/** `pixel-scale`: rendered pixels per pixel of a 1080p frame (shorter side / 1080). */
export function pixelScale(g: AnalogRecipeBuilder): string {
  if (!g.nodes.some(node => node.id === 'pixel-scale')) {
    g.add('short-side', 'vector.reduce-min.vec2', { value: ['resolution', 'value'] });
    g.div('pixel-scale', 'short-side', g.number('reference-height', 1080));
  }
  return 'pixel-scale';
}

/** `seed-salt`: the seed's share of every roll's salt. */
export function seedSalt(g: AnalogRecipeBuilder): void {
  modulo(g, 'seed-key', g.fn('seed-whole', 'floor', 'seed-clamped'), SEED_KEYS);
  g.mul('seed-salt', 'seed-key', g.number('seed-salt-stride', SALT_KINDS));
}

/** hash of vec2(x + KEY_RANGE × (salt + seed), y + KEY_RANGE × state), uniform in [0, 1). */
export function roll(g: AnalogRecipeBuilder, id: string, salt: number, x: GraphPort, y: GraphPort, state: GraphPort) {
  const saltKey = g.plus(`${id}-salt`, g.number(`${id}-kind`, salt), 'seed-salt');
  const keyX = g.plus(`${id}-key-x`, x, g.mul(`${id}-salt-key`, saltKey, 'key-range'));
  const keyY = g.plus(`${id}-key-y`, y, g.mul(`${id}-state-key`, state, 'key-range'));
  return g.hash(id, g.vec2(`${id}-key`, keyX, keyY));
}

/** 1 when `rolled` < `probability` (strict, so probability 0 never fires), else 0. */
export function chance(g: AnalogRecipeBuilder, id: string, rolled: GraphPort, probability: GraphPort) {
  return g.select(id, g.greater(`${id}-hit`, probability, rolled), 'zero', 'one');
}

/** A signed cell index → its key in [0, KEY_RANGE). */
export function indexKey(g: AnalogRecipeBuilder, id: string, index: GraphPort) {
  return g.plus(id, index, 'index-offset');
}
