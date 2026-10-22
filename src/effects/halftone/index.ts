import shader from './shader.wgsl?raw';
import { catalogBaseParam, createCatalogEffect, ignoredBaseParams } from '../_shared/catalogEffect';
import { DRIFT_LINES_PRESETS, driftLinesWarnings } from './driftLines';
import { HALFTONE_PRESETS } from './halftonePresets';

/** Dither cells are whole output pixels (patternReferenceFrame.ts wholePixels): say when Pixel Size rounds on this frame. */
function ditherWholePixelNotes(params: Record<string, number | boolean | string>, width = 1920, height = 1080): string[] {
  const size = Math.max(typeof params.scale === 'number' && Number.isFinite(params.scale) ? params.scale : 3, 1);
  const pixels = size * Math.min(width, height) / 1080, whole = Math.round(pixels);
  if (pixels < 1 || Math.abs(pixels - whole) < 1e-6) return [];
  return [`Pixel Size ${Number(size.toPrecision(4))} px is ${Number(pixels.toPrecision(3))} pixels on this ${width}×${height} frame; dither cells are whole pixels, so it renders ${whole}.`];
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
  params: { scale: { type: 'number', label: 'Pixel Size', default: 3, min: 1, max: 24, step: 1, group: 'Pattern' } },
  retired: ignoredBaseParams('Dithering', ['angle', 'colorA', 'colorB']),
  paramWarnings: ditherWholePixelNotes,
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
  params: { scale: { type: 'number', label: 'Registration', default: 8, min: 1, max: 32, step: 1, group: 'Pattern' }, colorA: { type: 'color', label: 'Dark Ink', default: '#2046b3', group: 'Color' }, colorB: { type: 'color', label: 'Warm Ink', default: '#ef476f', group: 'Color' } },
  retired: ignoredBaseParams('Riso', ['angle']),
});
export const risoGlow = createCatalogEffect({
  id: 'riso-glow', name: 'Riso Glow', category: 'halftone', shader, entryPoint: 'risoGlowFragment', animated: true,
  params: { colorA: { type: 'color', label: 'Shadow Ink', default: '#4f46e5', group: 'Color' }, colorB: { type: 'color', label: 'Glow Ink', default: '#f43f5e', group: 'Color' } },
  retired: ignoredBaseParams('Riso Glow', ['angle']),
});
export const paperPrint = createCatalogEffect({
  id: 'paper-print', name: 'Paper Print', category: 'halftone', shader, entryPoint: 'paperPrintFragment', scaleFloor: 1,
  params: { scale: { type: 'number', label: 'Press Grain', default: 18, min: 4, max: 80, step: 1, group: 'Pattern' } },
  retired: ignoredBaseParams('Paper Print', ['angle']),
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
