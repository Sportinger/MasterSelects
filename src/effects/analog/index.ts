import shader from './shader.wgsl?raw';
import { createCatalogEffect } from '../_shared/catalogEffect';

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
    scale: { type: 'number', label: 'Facets', default: 14, min: 4, max: 80, step: 1, group: 'Pattern' },
    amount: { type: 'number', label: 'Refraction', default: 0.75, min: 0, max: 1, step: 0.01, group: 'Style' },
    speed: { type: 'number', label: 'Shimmer Speed', default: 1, min: 0, max: 5, step: 0.05, group: 'Motion' },
  },
  retired: { angle: NO_ANGLE('Crystal Glass'), ...NO_COLORS('Crystal Glass') },
  paramWarnings: floorNote('Facets', 4),
});
export const glassDispersion = createCatalogEffect({
  id: 'glass-dispersion', name: 'Glass Dispersion', category: 'analog', shader, entryPoint: 'glassDispersionFragment', animated: true,
  params: {
    scale: { type: 'number', label: 'Cell Size (px)', default: 14, min: 4, max: 80, step: 1, group: 'Pattern' },
    amount: { type: 'number', label: 'Dispersion', default: 0.75, min: 0, max: 1, step: 0.01, group: 'Style' },
    speed: { type: 'number', label: 'Pulse Speed', default: 1, min: 0, max: 5, step: 0.05, group: 'Motion' },
  },
  retired: { angle: NO_ANGLE('Glass Dispersion'), ...NO_COLORS('Glass Dispersion') },
  paramWarnings: floorNote('Cell Size', 4),
});
export const ribbonScan = createCatalogEffect({
  id: 'ribbon-scan', name: 'Ribbon Scan', category: 'analog', shader, entryPoint: 'ribbonScanFragment', animated: true,
  params: {
    scale: { type: 'number', label: 'Ribbons', default: 14, min: 3, max: 80, step: 1, group: 'Pattern' },
    amount: { type: 'number', label: 'Displacement', default: 0.4, min: 0, max: 1, step: 0.01, group: 'Style' },
  },
  retired: { angle: NO_ANGLE('Ribbon Scan'), ...NO_COLORS('Ribbon Scan') },
  paramWarnings: floorNote('Ribbons', 3),
});
export const waveLines = createCatalogEffect({
  id: 'wave-lines', name: 'Wave Lines', category: 'analog', shader, entryPoint: 'waveLinesFragment', animated: true,
  params: {
    scale: { type: 'number', label: 'Line Density', default: 14, min: 3, max: 80, step: 1, group: 'Pattern' },
    colorA: { type: 'color', label: 'Lines', default: '#111827', group: 'Color' },
    colorB: { type: 'color', label: 'Background', default: '#f8fafc', group: 'Color' },
  },
  retired: { angle: NO_ANGLE('Wave Lines') },
  paramWarnings: floorNote('Line Density', 3),
});
export const holo = createCatalogEffect({
  id: 'holo', name: 'Holo', category: 'analog', shader, entryPoint: 'holoFragment', animated: true,
  params: {
    amount: { type: 'number', label: 'Amount', default: 0.5, min: 0, max: 1, step: 0.01, group: 'Style' },
    colorA: { type: 'color', label: 'Spectrum A', default: '#22d3ee', group: 'Color' }, colorB: { type: 'color', label: 'Spectrum B', default: '#f472b6', group: 'Color' },
  },
  retired: { scale: 'Holo has no scale; the value is ignored.', angle: NO_ANGLE('Holo') },
});
