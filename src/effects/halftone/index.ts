import shader from './shader.wgsl?raw';
import { createCatalogEffect } from '../_shared/catalogEffect';

const select = (label: string, values: string[], defaultValue = values[0]) => ({
  type: 'select' as const,
  label,
  default: defaultValue,
  options: values.map((value) => ({ value, label: value.replace(/-/g, ' ') })),
  group: 'Pattern',
});
export const dither = createCatalogEffect({
  id: 'dither', name: 'Dithering', category: 'halftone', shader, entryPoint: 'ditherFragment',
  params: { scale: { type: 'number', label: 'Pixel Size', default: 3, min: 1, max: 24, step: 1, group: 'Pattern' } },
});
export const ditherStudio = createCatalogEffect({
  id: 'dither-studio', name: 'Dither Studio', category: 'halftone', shader, entryPoint: 'ditherStudioFragment',
  params: { kernel: select('Kernel', ['bayer-2', 'bayer-4', 'checker'], 'bayer-4') },
  variantMap: { 'bayer-2': 0, 'bayer-4': 1, checker: 2 },
});
export const halftone = createCatalogEffect({
  id: 'halftone', name: 'Halftone', category: 'halftone', shader, entryPoint: 'halftoneFragment',
});
export const patternHalftone = createCatalogEffect({
  id: 'pattern-halftone', name: 'Pattern Halftone', category: 'halftone', shader, entryPoint: 'patternHalftoneFragment',
  params: { shape: select('Shape', ['circle', 'diamond', 'line']) },
  variantMap: { circle: 0, diamond: 1, line: 2 },
});
export const riso = createCatalogEffect({
  id: 'riso', name: 'Riso', category: 'halftone', shader, entryPoint: 'risoFragment',
  params: { scale: { type: 'number', label: 'Registration', default: 8, min: 1, max: 32, step: 1, group: 'Pattern' }, colorA: { type: 'color', label: 'Dark Ink', default: '#2046b3', group: 'Color' }, colorB: { type: 'color', label: 'Warm Ink', default: '#ef476f', group: 'Color' } },
});
export const risoGlow = createCatalogEffect({
  id: 'riso-glow', name: 'Riso Glow', category: 'halftone', shader, entryPoint: 'risoGlowFragment', animated: true,
  params: { colorA: { type: 'color', label: 'Shadow Ink', default: '#4f46e5', group: 'Color' }, colorB: { type: 'color', label: 'Glow Ink', default: '#f43f5e', group: 'Color' } },
});
export const paperPrint = createCatalogEffect({
  id: 'paper-print', name: 'Pixel Press', category: 'halftone', shader, entryPoint: 'paperPrintFragment',
  params: { scale: { type: 'number', label: 'Press Grain', default: 18, min: 4, max: 80, step: 1, group: 'Pattern' } },
});
export const pixelPoster = createCatalogEffect({
  id: 'pixel-poster', name: 'Pixel Poster', category: 'halftone', shader, entryPoint: 'pixelPosterFragment',
  params: { scale: { type: 'number', label: 'Block Size', default: 10, min: 2, max: 64, step: 1, group: 'Pattern' } },
});
export const toneGeometry = createCatalogEffect({
  id: 'tone-geometry', name: 'Tone Geometry', category: 'halftone', shader, entryPoint: 'toneGeometryFragment', animated: true,
  params: { shape: select('Shape', ['square', 'circle', 'triangle']) },
  variantMap: { square: 0, circle: 1, triangle: 2 },
});
export const crossStitch = createCatalogEffect({
  id: 'cross-stitch', name: 'Cross Stitch', category: 'halftone', shader, entryPoint: 'crossStitchFragment',
  params: { scale: { type: 'number', label: 'Stitch Size', default: 12, min: 4, max: 40, step: 1, group: 'Pattern' } },
});
export const glitchGrid = createCatalogEffect({
  id: 'glitch-grid', name: 'Glitch Grid', category: 'halftone', shader, entryPoint: 'glitchGridFragment', animated: true,
});
export const scatterMosaic = createCatalogEffect({
  id: 'scatter-mosaic', name: 'Scatter Mosaic', category: 'halftone', shader, entryPoint: 'scatterMosaicFragment', animated: true,
});
export const driftLines = createCatalogEffect({
  id: 'drift-lines', name: 'Drift Lines', category: 'halftone', shader, entryPoint: 'driftLinesFragment', animated: true,
});
