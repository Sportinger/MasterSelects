import shader from './shader.wgsl?raw';
import { createCatalogEffect } from '../_shared/catalogEffect';
import type { EffectParam } from '../types';
import { clampedValueNotes } from './analogParamWarnings';
import { RIBBON_SCAN_EDGE_OPTIONS, RIBBON_SCAN_MIN_RIBBONS } from './ribbonScanLimits';

export { analogSignalLab } from './signal-lab';
export { crtScreen } from './crtScreen';
export { glitch } from './glitch';
export { filmPrism } from './filmPrism';

const NO_ANGLE = (name: string) => `${name} has no angle; the value is ignored.`;
const NO_COLORS = (name: string) => ({ colorA: `${name} has no ink color; the value is ignored.`, colorB: `${name} has no paper color; the value is ignored.` });
/** A count or size whose recipe has a floor: values below it render as the floor (said, not silent). */
const floorNote = (label: string, floor: number) => (values: Record<string, number | boolean | string>) =>
  typeof values.scale === 'number' && values.scale < floor ? [`${label} ${values.scale} is below ${floor} and renders as ${floor}.`] : [];

export const crystal = createCatalogEffect({
  id: 'crystal', name: 'Crystal Glass', category: 'analog', shader, entryPoint: 'crystalFragment', animated: true,
  params: {
    scale: { type: 'number', label: 'Facets', default: 14, min: 4, max: 80, step: 1, group: 'Pattern', styleRole: 'facet-count' },
    amount: { type: 'number', label: 'Refraction', default: 0.3, min: 0, max: 1, step: 0.01, group: 'Style', styleRole: 'refraction' },
    speed: { type: 'number', label: 'Shimmer Speed', default: 1, min: 0, max: 5, step: 0.05, group: 'Motion' },
  },
  retired: { angle: NO_ANGLE('Crystal Glass'), ...NO_COLORS('Crystal Glass') },
  paramWarnings: floorNote('Facets', 4),
  experimental: 'Facets are squares of the frame (they stretch with its shape) with hard seams, and strong Refraction doubles edges into ghost copies.',
});
export const glassDispersion = createCatalogEffect({
  id: 'glass-dispersion', name: 'Glass Dispersion', category: 'analog', shader, entryPoint: 'glassDispersionFragment', animated: true,
  params: {
    scale: { type: 'number', label: 'Cell Size (px)', default: 14, min: 4, max: 80, step: 1, group: 'Pattern' },
    amount: { type: 'number', label: 'Dispersion', default: 0.3, min: 0, max: 1, step: 0.01, group: 'Style', styleRole: 'dispersion' },
    speed: { type: 'number', label: 'Pulse Speed', default: 1, min: 0, max: 5, step: 0.05, group: 'Motion' },
  },
  retired: { angle: NO_ANGLE('Glass Dispersion'), ...NO_COLORS('Glass Dispersion') },
  paramWarnings: floorNote('Cell Size', 4),
  experimental: 'Cells are sized in output pixels (the look changes with the resolution) and each cell splits red and blue its own way, so strong Dispersion reads as blocks of RGB noise.',
});
const ribbonScanParams: Record<string, EffectParam> = {
  scale: { type: 'number', label: 'Ribbons', default: 14, min: RIBBON_SCAN_MIN_RIBBONS, max: 80, step: 1, group: 'Pattern', styleRole: 'ribbon-count' },
  amount: { type: 'number', label: 'Displacement', default: 0.3, min: 0, max: 1, step: 0.01, group: 'Style', styleRole: 'displacement' },
  edges: { type: 'select', label: 'Edges', default: 'mirror', options: RIBBON_SCAN_EDGE_OPTIONS, group: 'Style', graphOnly: true },
};
export const ribbonScan = createCatalogEffect({
  id: 'ribbon-scan', name: 'Ribbon Scan', category: 'analog', shader, entryPoint: 'ribbonScanFragment', animated: true,
  params: ribbonScanParams,
  retired: { angle: NO_ANGLE('Ribbon Scan'), ...NO_COLORS('Ribbon Scan') },
  // Effects without Edges run the original Ribbon Scan graph (saved before the 2026-10 rebuild); it floors Ribbons too.
  paramWarnings: values => [...floorNote('Ribbons', RIBBON_SCAN_MIN_RIBBONS)(values),
    ...(values.edges === undefined ? [] : clampedValueNotes(ribbonScanParams, values, { amount: [0, 1] }))],
});
export const waveLines = createCatalogEffect({
  id: 'wave-lines', name: 'Wave Lines', category: 'analog', shader, entryPoint: 'waveLinesFragment', animated: true,
  params: {
    scale: { type: 'number', label: 'Line Density', default: 14, min: 3, max: 80, step: 1, group: 'Pattern', styleRole: 'line-count' },
    // A graphic line-art look: from about 0.5 the drawing covers most of the picture, so new effects start at 0.3.
    amount: { type: 'number', label: 'Amount', default: 0.3, min: 0, max: 1, step: 0.01, group: 'Style' },
    colorA: { type: 'color', label: 'Lines', default: '#111827', group: 'Color' },
    colorB: { type: 'color', label: 'Background', default: '#f8fafc', group: 'Color' },
  },
  retired: { angle: NO_ANGLE('Wave Lines') },
  paramWarnings: floorNote('Line Density', 3),
});
const holoParams: Record<string, EffectParam> = {
  amount: { type: 'number', label: 'Amount', default: 0.35, min: 0, max: 1, step: 0.01, group: 'Style' },
  stripes: { type: 'number', label: 'Stripes', default: 0.6, min: 0, max: 1, step: 0.01, group: 'Style', graphOnly: true },
  colorA: { type: 'color', label: 'Spectrum A', default: '#22d3ee', group: 'Color' }, colorB: { type: 'color', label: 'Spectrum B', default: '#f472b6', group: 'Color' },
};
export const holo = createCatalogEffect({
  id: 'holo', name: 'Holo', category: 'analog', shader, entryPoint: 'holoFragment', animated: true,
  params: holoParams,
  retired: { scale: 'Holo has no scale; the value is ignored.', angle: NO_ANGLE('Holo') },
  // Effects without Stripes run the original Holo graph (saved before the 2026-10 rebuild).
  paramWarnings: values => values.stripes === undefined ? [] : clampedValueNotes(holoParams, values, { amount: [0, 1], stripes: [0, 1] }),
});
