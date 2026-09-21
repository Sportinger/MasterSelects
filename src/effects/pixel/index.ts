import shader from './shader.wgsl?raw';
import { createCatalogEffect } from '../_shared/catalogEffect';

export const blockify = createCatalogEffect({
  id: 'blockify', name: 'Blockify', category: 'pixel', shader, entryPoint: 'blockifyFragment',
  params: { scale: { type: 'number', label: 'Block Size', default: 16, min: 2, max: 96, step: 1, group: 'Pattern' } },
});
export const blockMosaic = createCatalogEffect({
  id: 'block-mosaic', name: 'Block Mosaic', category: 'pixel', shader, entryPoint: 'blockMosaicFragment', animated: true,
  clock: 'timeline',
  params: { scale: { type: 'number', label: 'Tile Size', default: 22, min: 4, max: 120, step: 1, group: 'Pattern' } },
});
