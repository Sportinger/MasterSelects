import shader from './shader.wgsl?raw';
import { createCatalogEffect } from '../_shared/catalogEffect';

export { analogSignalLab } from './signal-lab';
export { crtScreen } from './crtScreen';
export { glitch } from './glitch';
export { filmPrism } from './filmPrism';

export const crystal = createCatalogEffect({
  id: 'crystal', name: 'Crystal Glass', category: 'analog', shader, entryPoint: 'crystalFragment', animated: true,
});
export const glassDispersion = createCatalogEffect({
  id: 'glass-dispersion', name: 'Glass Dispersion', category: 'analog', shader, entryPoint: 'glassDispersionFragment', animated: true,
});
export const ribbonScan = createCatalogEffect({
  id: 'ribbon-scan', name: 'Ribbon Scan', category: 'analog', shader, entryPoint: 'ribbonScanFragment', animated: true,
});
export const waveLines = createCatalogEffect({
  id: 'wave-lines', name: 'Wave Lines', category: 'analog', shader, entryPoint: 'waveLinesFragment', animated: true,
});
export const holo = createCatalogEffect({
  id: 'holo', name: 'Holo', category: 'analog', shader, entryPoint: 'holoFragment', animated: true,
  params: { colorA: { type: 'color', label: 'Spectrum A', default: '#22d3ee', group: 'Color' }, colorB: { type: 'color', label: 'Spectrum B', default: '#f472b6', group: 'Color' } },
});
