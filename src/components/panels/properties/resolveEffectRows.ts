// The stylize effects rebuilt on 2026-10-21 (their Color and Invert rows included).
const STYLIZE_RESOLVE_ROW_EFFECTS = ['glow', 'grain', 'sharpen', 'vignette', 'scanlines', 'edge-detect', 'posterize', 'threshold'];

/**
 * Effects whose generic parameter rows use the shared Resolve inspector design (AGENTS.md
 * section 9) instead of the older generic rows. Add an effect here when its inspector is revised.
 */
export const RESOLVE_ROW_EFFECTS: ReadonlySet<string> = new Set(['gaussian-blur', 'box-blur', 'motion-blur', 'radial-blur', 'zoom-blur',
  'wave', 'twirl', 'bulge', 'kaleidoscope', 'mirror', 'rgb-split', 'pixelate', 'blockify', 'block-mosaic',
  'brightness', 'contrast', 'saturation', 'vibrance', 'exposure', 'levels', 'hue-shift', 'temperature',
  ...STYLIZE_RESOLVE_ROW_EFFECTS,
  'crt-screen', 'glitch', 'film-prism', 'holo', 'ribbon-scan', 'crystal', 'glass-dispersion', 'wave-lines', 'pixel-sort',
  'acuarela', 'rom1', 'sheen', 'pixel-particle-disintegrate',
  'color-wheel', 'perspective-grid', 'stick-figure',
  // The pilot of the effect standard (presets, docs paragraphs): Documentation-Site.md "Effect pages".
  'drift-lines',
  // Print & Halftone looks reviewed to that standard (their Ink and Paper colour rows included).
  'halftone', 'dither', 'riso']);

/** Parameter types that have a Resolve row (ResolveEffectParamRow); others keep the generic control. */
export function hasResolveEffectParamRow(definition: { type: string }): boolean {
  return definition.type === 'number' || definition.type === 'select' || definition.type === 'boolean' || definition.type === 'color';
}

/** Decimals a step implies; the shared display rules live in effects/paramDisplay.ts. */
export { stepDecimals } from '../../../effects/paramDisplay';
