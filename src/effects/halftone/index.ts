import lookShaders from './shader.wgsl?raw';
import coordinateRotation from '../_shared/coordinateRotation.wgsl?raw';
import { IMAGE_FRACTAL_NOISE_WGSL } from '../../services/operators/imageNoiseSemantics';
import { roundImageScalarEven } from '../../services/operators/imageRoundingSemantics';
import { catalogBaseParam, createCatalogEffect, ignoredBaseParams } from '../_shared/catalogEffect';
import { DRIFT_LINES_PRESETS, driftLinesWarnings } from './driftLines';
import { HALFTONE_PRESETS } from './halftonePresets';
import { DITHER_PRESETS } from './ditherPresets';
import { RISO_PRESETS } from './risoPresets';
import { RISO_GLOW_PRESETS } from './risoGlowPresets';
import { PAPER_PRINT_INK, PAPER_PRINT_PAPER, PAPER_PRINT_PRESETS, paperPrintNotes } from './paperPrint';

// The looks' shader twins; Paper Print's reads the graph's own Rotate UV and Fractal Noise (imageNoiseSemantics.ts), so both draw the same grain.
const shader = `${lookShaders}\n${coordinateRotation}\n${IMAGE_FRACTAL_NOISE_WGSL}`;

/** Dither cells are whole output pixels (patternReferenceFrame.ts wholePixels): say when Pixel Size rounds on this frame. */
function ditherWholePixelNotes(params: Record<string, number | boolean | string>, width = 1920, height = 1080): string[] {
  const size = Math.max(typeof params.scale === 'number' && Number.isFinite(params.scale) ? params.scale : 3, 1);
  // Half to even, as the graph (math.round-even) and the twin's round() do: 2.5 pixels render 2.
  const pixels = size * Math.min(width, height) / 1080, whole = roundImageScalarEven(pixels);
  if (pixels < 1 || Math.abs(pixels - whole) < 1e-6) return [];
  return [`Pixel Size ${Number(size.toPrecision(4))} px is ${Number(pixels.toPrecision(3))} pixels on this ${width}×${height} frame; dither cells are whole pixels, so it renders ${whole}.`];
}

/** A graph-less Dithering saved before Levels (no `levels` value, hasEarlierDitheringParams) renders its earlier recipe: say so in the card. */
function ditherNotes(params: Record<string, number | boolean | string>, width?: number, height?: number): string[] {
  const earlier = params.levels === undefined
    ? ['This Dithering was saved before Levels and keeps its earlier look (each pixel stepped to four levels); add Dithering again to use Levels and the presets as designed.']
    : [];
  return [...earlier, ...ditherWholePixelNotes(params, width, height)];
}

/** A graph-less Riso or Riso Glow saved before Dot Size (no `dotSize`, hasEarlierRisoParams) renders its earlier recipe;
 * a Dot Size thinner than one pixel of a small frame renders one pixel. Say both in the card. */
function risoNotes(params: Record<string, number | boolean | string>, width = 1920, height = 1080, name = 'Riso'): string[] {
  if (params.dotSize === undefined) {
    return [`This ${name} was saved before Dot Size and keeps its earlier look (both inks print the same darkness, without dots); add ${name} again to use Dot Size and the presets as designed.`];
  }
  const size = Math.max(typeof params.dotSize === 'number' && Number.isFinite(params.dotSize) ? params.dotSize : 6, 2);
  const pixels = size * Math.min(width, height) / 1080;
  return pixels < 1 ? [`Dot Size ${Number(size.toPrecision(4))} px is thinner than one pixel on this ${width}×${height} frame; it renders 1 pixel.`] : [];
}

const select = (label: string, values: string[], defaultValue = values[0]) => ({
  type: 'select' as const,
  label,
  default: defaultValue,
  options: values.map((value) => ({ value, label: value.replace(/-/g, ' ') })),
  group: 'Pattern',
});
export const dither = createCatalogEffect({
  id: 'dither', name: 'Dithering', category: 'halftone', shader, entryPoint: 'ditherFragment', scaleFloor: 1,
  // Same parameter ids as the other looks of the engine; Levels is its own, so the Style menu of the other looks
  // (styles share every parameter, effectStyles.ts) does not offer Dithering.
  params: {
    scale: { type: 'number', label: 'Pixel Size', default: 3, min: 1, max: 24, step: 1, unit: ' px', group: 'Pattern' },
    // Steps per colour channel (equal sRGB steps): 4 gives 64 colours, 2 the eight pure colours. A saved graph from before
    // Levels does not read it, so the card hides it there (graphOnly); below 2 renders 2 and the card says so (renderMin).
    levels: { type: 'number', label: 'Levels', default: 4, min: 2, max: 16, step: 1, renderMin: 2, graphOnly: true, group: 'Color' },
    // The dithered picture alone by default; effects saved without an Amount keep the earlier 0.75.
    amount: catalogBaseParam('amount', { group: 'Color', default: 1, legacyDefault: 0.75 }),
  },
  cardEnd: ['levels', 'amount'],
  variantParam: 'levels',
  retired: ignoredBaseParams('Dithering', ['angle', 'colorA', 'colorB']),
  paramWarnings: ditherNotes,
  presets: DITHER_PRESETS,
});
export const ditherStudio = createCatalogEffect({
  id: 'dither-studio', name: 'Dither Studio', category: 'halftone', shader, entryPoint: 'ditherStudioFragment',
  params: { kernel: select('Kernel', ['bayer-2', 'bayer-4', 'checker'], 'bayer-4') },
  variantMap: { 'bayer-2': 0, 'bayer-4': 1, checker: 2 },
  retired: ignoredBaseParams('Dither Studio', ['angle']),
});
export const halftone = createCatalogEffect({
  id: 'halftone', name: 'Halftone', category: 'halftone', shader, entryPoint: 'halftoneFragment', scaleFloor: 2,
  // Same parameter ids as the other looks of the engine (the Style menu keeps values); labels of its own.
  params: {
    scale: catalogBaseParam('scale', { label: 'Dot Size', unit: ' px' }),
    angle: catalogBaseParam('angle', { unit: '°' }),
    amount: catalogBaseParam('amount', { group: 'Color' }),
  },
  cardEnd: ['colorA', 'colorB', 'amount'],
  presets: HALFTONE_PRESETS,
});
export const patternHalftone = createCatalogEffect({
  id: 'pattern-halftone', name: 'Pattern Halftone', category: 'halftone', shader, entryPoint: 'patternHalftoneFragment', scaleFloor: 2,
  params: { shape: select('Shape', ['circle', 'diamond', 'line']) },
  variantMap: { circle: 0, diamond: 1, line: 2 },
});
export const riso = createCatalogEffect({
  id: 'riso', name: 'Riso', category: 'halftone', shader, entryPoint: 'risoFragment',
  // Same parameter ids as the other looks of the engine; Dot Size is its own. Card: Dot Size and Registration under
  // Pattern, then the two inks and Amount under Color.
  params: {
    // How far the two inks slip apart, in 1080p pixels (0: in register). Effects saved without a value had 8.
    // Below 0 renders 0 (the graph's max), and the card says so (renderMin).
    scale: { type: 'number', label: 'Registration', default: 3, min: 0, max: 32, step: 0.5, unit: ' px', renderMin: 0, group: 'Pattern', legacyDefault: 8 },
    // The cells of both dot screens, in 1080p pixels. A graph saved before Dot Size does not read it (graphOnly).
    dotSize: { type: 'number', label: 'Dot Size', default: 6, min: 2, max: 40, step: 1, unit: ' px', renderMin: 2, graphOnly: true, group: 'Pattern' },
    colorA: { type: 'color', label: 'Dark Ink', default: '#2046b3', group: 'Color' },
    colorB: { type: 'color', label: 'Warm Ink', default: '#ef476f', group: 'Color' },
    // The print alone by default; effects saved without an Amount keep the earlier 0.75.
    amount: catalogBaseParam('amount', { group: 'Color', default: 1, legacyDefault: 0.75 }),
  },
  cardEnd: ['scale', 'colorA', 'colorB', 'amount'],
  variantParam: 'dotSize',
  retired: ignoredBaseParams('Riso', ['angle']),
  paramWarnings: risoNotes,
  presets: RISO_PRESETS,
});
export const risoGlow = createCatalogEffect({
  id: 'riso-glow', name: 'Riso Glow', category: 'halftone', shader, entryPoint: 'risoGlowFragment', animated: true,
  // Riso's print (same parameter ids) with a fluorescent Glow Ink that breathes. Card: Dot Size and Registration under
  // Pattern, Glow and Speed under Glow & Pulse, then the two inks and Amount under Color.
  params: {
    // How far the two inks slip apart, in 1080p pixels (0: in register). Effects saved without a value had 14.
    scale: { type: 'number', label: 'Registration', default: 3, min: 0, max: 32, step: 0.5, unit: ' px', renderMin: 0, group: 'Pattern', legacyDefault: 14 },
    // The cells of both dot screens, in 1080p pixels. A graph saved before Dot Size does not read it (graphOnly).
    dotSize: { type: 'number', label: 'Dot Size', default: 6, min: 2, max: 40, step: 1, unit: ' px', renderMin: 2, graphOnly: true, group: 'Pattern' },
    // How brightly the Glow Ink shines at the top of its pulse (0: a plain two-ink print). Reaches the twin through the Angle slot.
    glow: { type: 'number', label: 'Glow', default: 1, min: 0, max: 2, step: 0.05, renderMin: 0, graphOnly: true, group: 'Glow & Pulse' },
    speed: { type: 'number', label: 'Speed', default: 1, min: 0, max: 5, step: 0.05, group: 'Glow & Pulse' },
    // A deep indigo, so where both inks print the stage stays near black and the glow has a dark to shine into.
    // Effects saved without a value had the lighter indigo #4f46e5.
    colorA: { type: 'color', label: 'Shadow Ink', default: '#1b1f4a', group: 'Color', legacyDefault: '#4f46e5' },
    colorB: { type: 'color', label: 'Glow Ink', default: '#f43f5e', group: 'Color' },
    // The print alone by default; effects saved without an Amount keep the earlier 0.75.
    amount: catalogBaseParam('amount', { group: 'Color', default: 1, legacyDefault: 0.75 }),
  },
  cardEnd: ['scale', 'glow', 'speed', 'colorA', 'colorB', 'amount'],
  variantParam: 'dotSize',
  angleSlotParam: 'glow',
  retired: ignoredBaseParams('Riso Glow', ['angle']),
  paramWarnings: (params, width, height) => risoNotes(params, width, height, 'Riso Glow'),
  presets: RISO_GLOW_PRESETS,
});
export const paperPrint = createCatalogEffect({
  id: 'paper-print', name: 'Paper Print', category: 'halftone', shader, entryPoint: 'paperPrintFragment', scaleFloor: 1,
  // Same parameter ids as the other looks of the engine; Texture is its own, so the Style menu of the other looks
  // (styles share every parameter, effectStyles.ts) does not offer Paper Print. Card: Grain Size and Texture under
  // Pattern, then Ink, Paper and Amount under Color.
  params: {
    // The size of one grain, in 1080p pixels. Effects saved without a value had 18. Below 1 renders 1 (renderMin).
    scale: { type: 'number', label: 'Grain Size', default: 2, min: 1, max: 80, step: 0.5, unit: ' px', renderMin: 1, group: 'Pattern', legacyDefault: 18 },
    // How much the paper's surface shows: uneven paper and ink that did not take everywhere. A graph saved before
    // Texture does not read it (graphOnly); below 0 renders 0 and the card says so (renderMin).
    texture: { type: 'number', label: 'Texture', default: 0.5, min: 0, max: 1, step: 0.01, renderMin: 0, graphOnly: true, group: 'Pattern' },
    colorA: catalogBaseParam('colorA', { default: PAPER_PRINT_INK, legacyDefault: '#111827' }),
    colorB: catalogBaseParam('colorB', { default: PAPER_PRINT_PAPER, legacyDefault: '#f8fafc' }),
    // The print alone by default; effects saved without an Amount keep the earlier 0.75.
    amount: catalogBaseParam('amount', { group: 'Color', default: 1, legacyDefault: 0.75 }),
  },
  cardEnd: ['colorA', 'colorB', 'amount'],
  variantParam: 'texture',
  retired: ignoredBaseParams('Paper Print', ['angle']),
  paramWarnings: paperPrintNotes,
  presets: PAPER_PRINT_PRESETS,
});
export const pixelPoster = createCatalogEffect({
  id: 'pixel-poster', name: 'Pixel Poster', category: 'halftone', shader, entryPoint: 'pixelPosterFragment', scaleFloor: 2,
  params: { scale: { type: 'number', label: 'Block Size', default: 10, min: 2, max: 64, step: 1, group: 'Pattern' } },
  retired: ignoredBaseParams('Pixel Poster', ['angle', 'colorA', 'colorB']),
});
export const toneGeometry = createCatalogEffect({
  id: 'tone-geometry', name: 'Tone Geometry', category: 'halftone', shader, entryPoint: 'toneGeometryFragment', scaleFloor: 3, animated: true,
  params: { shape: select('Shape', ['square', 'circle', 'triangle']) },
  variantMap: { square: 0, circle: 1, triangle: 2 },
});
export const crossStitch = createCatalogEffect({
  id: 'cross-stitch', name: 'Cross Stitch', category: 'halftone', shader, entryPoint: 'crossStitchFragment', scaleFloor: 3,
  params: { scale: { type: 'number', label: 'Stitch Size', default: 12, min: 4, max: 40, step: 1, group: 'Pattern' } },
  retired: ignoredBaseParams('Cross Stitch', ['angle']),
});
export const glitchGrid = createCatalogEffect({
  id: 'glitch-grid', name: 'Glitch Grid', category: 'halftone', shader, entryPoint: 'glitchGridFragment', scaleFloor: 2, animated: true,
  retired: ignoredBaseParams('Glitch Grid', ['angle', 'colorA', 'colorB']),
});
export const scatterMosaic = createCatalogEffect({
  id: 'scatter-mosaic', name: 'Scatter Mosaic', category: 'halftone', shader, entryPoint: 'scatterMosaicFragment', scaleFloor: 3, animated: true,
  retired: ignoredBaseParams('Scatter Mosaic', ['angle', 'colorA', 'colorB']),
});
export const driftLines = createCatalogEffect({
  id: 'drift-lines', name: 'Drift Lines', category: 'halftone', shader, entryPoint: 'driftLinesFragment', animated: true,
  // Same parameter ids as the other looks of the engine (the Style menu keeps values); labels of its own.
  params: {
    scale: catalogBaseParam('scale', { label: 'Band Size', unit: ' px', renderMin: 2 }),
    amount: catalogBaseParam('amount', { label: 'Drift', group: 'Motion' }),
    // An edited graph saved before Angle acted does not read it: the card hides it then (graphOnly).
    angle: catalogBaseParam('angle', { unit: '°', graphOnly: true }),
  },
  retired: ignoredBaseParams('Drift Lines', ['colorA', 'colorB']),
  paramWarnings: driftLinesWarnings,
  presets: DRIFT_LINES_PRESETS,
});
