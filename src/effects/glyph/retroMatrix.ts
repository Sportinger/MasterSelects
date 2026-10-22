// Retro Matrix: the glyph engine as an old phosphor terminal. Its text scrolls up row by row while the
// picture stays put, glows in one Phosphor colour, brighter where the picture is bright, and is drawn
// in scanlines. Shared by the effect definition (index.ts) and the runtime graph
// (src/services/operators/asciiEffectGraph.ts, its 'retro-matrix' branches, the reference). shader.wgsl is not compiled
// for the glyph looks and is out of date; do not copy its maths.
import type { EffectParam } from '../types';

/** Rows the text scrolls up per second at Speed 1 (a terminal's line rate, at every Cell Size). */
export const RETRO_SCROLL_RATE = 3;
/**
 * Rows after which the scroll wraps and the text repeats (68 min at Speed 1), so the per-pixel grid stays small in
 * f32. A multiple of RETRO_LINE_SPACING × 4096: at a whole Cell Size the scanlines also continue across the wrap.
 */
export const RETRO_SCROLL_PERIOD = 12288;
/** Character colour of new instances and of instances saved before Phosphor existed: amber. */
export const RETRO_PHOSPHOR = '#ff8514';
/** Brightness of a character: base + factor × the picture's tone (dim in the dark, overdriven in the light). */
export const RETRO_TONE_BASE = 0.15;
export const RETRO_TONE_FACTOR = 1.6;
/** Scanline pitch in pixels of a 1080p frame (360 lines on 1080 rows), so every output size shows the same lines. */
export const RETRO_LINE_SPACING = 3;
/** Scanline depth instances saved before Scanlines existed render with (the earlier 0.64–1 ripple). */
export const RETRO_LEGACY_SCANLINES = 0.36;

/** The two controls of its own (lookOwn, so the Style menu still offers the other moving looks): Phosphor and Scanlines. */
export const RETRO_MATRIX_PARAMS: Record<string, EffectParam> = {
  scanlines: {
    type: 'number', label: 'Scanlines', default: 0.5, legacyDefault: RETRO_LEGACY_SCANLINES, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'Style', renderMin: 0, renderMax: 1, graphOnly: true, lookOwn: true,
  },
  phosphor: { type: 'color', label: 'Phosphor', default: RETRO_PHOSPHOR, group: 'Color', graphOnly: true, lookOwn: true },
};
