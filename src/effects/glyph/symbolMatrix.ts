// Symbol Matrix: the glyph engine as twinkling signs. Each cell swaps at its own moment to a random sign of
// its Roll window and breathes in brightness on its own phase. Twinkle sets how far a sign dims at the low
// point of that pulse. Shared by the effect definition (index.ts) and the runtime graph
// (src/services/operators/asciiEffectGraph.ts, its 'symbol-matrix' branch, the reference); shader.wgsl is not compiled for it and is out of date.
import type { EffectParam } from '../types';

/** Twinkle of instances saved before it existed: the earlier pulse 0.65 + 0.35 × sin dimmed the signs to 0.3. */
export const SYMBOL_LEGACY_TWINKLE = 0.7;

/** Its own control (lookOwn, so the Style menu still offers the other moving looks): Twinkle. */
export const SYMBOL_MATRIX_PARAMS: Record<string, EffectParam> = {
  twinkle: {
    type: 'number', label: 'Twinkle', default: 0.35, legacyDefault: SYMBOL_LEGACY_TWINKLE, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'Motion', renderMin: 0, renderMax: 1, graphOnly: true, lookOwn: true,
  },
};
