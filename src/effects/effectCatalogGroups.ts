/**
 * Presentation groups for the video effect catalog, ordered as shown in pickers
 * and menus. Effect `category` stays an internal registry field; these groups
 * sort by look (docs/ongoing/Node-Taxonomy-Plan.md, section 5).
 */
export const EFFECT_GROUPS = [
  { id: 'color', label: 'Color & Tone', effects: ['brightness', 'contrast', 'exposure', 'levels', 'saturation', 'vibrance', 'temperature', 'hue-shift', 'invert', 'posterize', 'threshold'] },
  { id: 'blur', label: 'Blur & Sharpen', effects: ['box-blur', 'gaussian-blur', 'motion-blur', 'radial-blur', 'zoom-blur', 'sharpen'] },
  { id: 'stylize', label: 'Light & Stylize', effects: ['glow', 'vignette', 'edge-detect', 'acuarela', 'rom1'] },
  { id: 'distort', label: 'Lens & Distort', effects: ['fisheye', 'bulge', 'twirl', 'wave', 'kaleidoscope', 'mirror', 'rgb-split', 'crystal', 'glass-dispersion', 'film-prism', 'holo'] },
  { id: 'pixel', label: 'Pixel & Mosaic', effects: ['pixelate', 'block-mosaic', 'blockify', 'quadtree-zoom', 'scatter-mosaic', 'pixel-poster', 'pixel-sort', 'voronoi'] },
  { id: 'print', label: 'Print & Halftone', effects: ['halftone', 'pattern-halftone', 'dither', 'dither-studio', 'riso', 'riso-glow', 'paper-print', 'tone-geometry'] },
  { id: 'lines', label: 'Lines & Engraving', effects: ['crosshatch', 'vector-tiling', 'contour', 'contour-map', 'outline', 'wave-lines', 'drift-lines'] },
  { id: 'textile', label: 'Textile & Craft', effects: ['embroidery', 'kilim', 'cross-stitch', 'stitch-poster'] },
  { id: 'text', label: 'Text & Glyph', effects: ['ascii', 'ascii-ghost', 'glyph-matrix', 'symbol-matrix', 'retro-matrix', 'matrix', 'grid-glyph', 'number-field', 'pixel-code', 'word-mosaic', 'inscribe', 'dither-text', 'data-hatch', 'pixel-dither', 'contour-type', 'brand-generator', 'capsule-cloud', 'ui-collage'] },
  { id: 'analog', label: 'Analog & Glitch', effects: ['analog-signal-lab', 'crt-screen', 'scanlines', 'grain', 'glitch', 'glitch-grid', 'ribbon-scan', 'memory-leak'] },
  { id: 'keying', label: 'Keying', effects: ['chroma-key'] },
  { id: 'time', label: 'Time', effects: ['slit-scan', 'time-stack', 'kinetic-trace'] },
  { id: 'tracking', label: 'Tracking & Overlays', effects: ['face-cables', 'hand-particles', 'hud-tracker', 'cctv', 'subject', 'tracked-scene', 'stardust', 'rain-reveal'] },
  { id: 'scene', label: '3D & Particles', effects: ['voxel-relief', 'splat-exploration', 'bricks', 'pixel-particle-disintegrate', 'flocking'] },
] as const;
export type EffectGroupId = typeof EFFECT_GROUPS[number]['id'];

const GROUP_OF = new Map<string, typeof EFFECT_GROUPS[number]>(EFFECT_GROUPS.flatMap(group => group.effects.map(id => [id, group] as const)));
export function effectGroup(effectId: string): { id: EffectGroupId | 'other'; label: string } {
  const group = GROUP_OF.get(effectId);
  return group ? { id: group.id, label: group.label } : { id: 'other', label: 'Other' };
}

/**
 * Looks rendered by one shared engine. Effects of an engine with identical
 * parameters are "styles": the inspector can switch between them in place.
 */
const ENGINES: Record<string, readonly string[]> = {
  'two-tone-pattern': ['drift-lines', 'glitch-grid', 'riso-glow', 'scatter-mosaic', 'crt-screen', 'crystal', 'film-prism', 'glass-dispersion', 'glitch', 'holo', 'ribbon-scan', 'wave-lines', 'block-mosaic', 'bricks', 'embroidery', 'outline',
    'cross-stitch', 'dither', 'halftone', 'paper-print', 'pixel-poster', 'riso', 'blockify', 'contour-map', 'crosshatch', 'kilim', 'vector-tiling'],
  'glyph-mosaic': ['ascii', 'brand-generator', 'grid-glyph', 'inscribe', 'number-field', 'pixel-code', 'stitch-poster', 'word-mosaic', 'contour-type',
    'capsule-cloud', 'data-hatch', 'dither-text', 'glyph-matrix', 'matrix', 'pixel-dither', 'retro-matrix', 'symbol-matrix', 'ui-collage'],
  'tracking-overlay': ['cctv', 'hud-tracker', 'rain-reveal', 'stardust', 'tracked-scene'],
  watercolor: ['acuarela', 'rom1'],
};
const ENGINE_OF = new Map(Object.entries(ENGINES).flatMap(([engine, ids]) => ids.map(id => [id, engine] as const)));
export function effectEngine(effectId: string): string | undefined { return ENGINE_OF.get(effectId); }
export function effectEngineMembers(engine: string): readonly string[] { return ENGINES[engine] ?? []; }

/** Kept for saved projects and reachable as a style of its engine, but not offered as a new effect. */
export const EFFECTS_HIDDEN_FROM_CATALOG: ReadonlySet<string> = new Set(['rom1']);
