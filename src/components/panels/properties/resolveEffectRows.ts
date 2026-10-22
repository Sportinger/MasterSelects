import { effectEngine } from '../../../effects/effectCatalogGroups';

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
  'drift-lines']);

/**
 * Whether a card shows its parameters in Resolve rows. Besides the listed effects, every look of a
 * style engine (so a Style switch keeps one design) and every card with a colour (colours have no
 * generic control): a card never mixes the two designs.
 */
export function usesResolveEffectRows(type: string, params: Readonly<Record<string, { type: string }>>): boolean {
  return RESOLVE_ROW_EFFECTS.has(type) || effectEngine(type) !== undefined || Object.values(params).some(param => param.type === 'color');
}

/** Parameter types that have a Resolve row (ResolveEffectParamRow): every type a card shows, typed text included. */
export function hasResolveEffectParamRow(definition: { type: string }): boolean {
  return definition.type === 'number' || definition.type === 'select' || definition.type === 'boolean' || definition.type === 'color' || definition.type === 'text';
}

/** Decimals a step implies; the shared display rules live in effects/paramDisplay.ts. */
export { stepDecimals } from '../../../effects/paramDisplay';
