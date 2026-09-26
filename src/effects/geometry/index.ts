import shader from './shader.wgsl?raw';
import { createCatalogEffect } from '../_shared/catalogEffect';
import { createGlyphEffect } from '../glyph/glyphEffectFactory';
import { createComputeEffect } from './computeEffectFactory';

export const voronoi = createComputeEffect({
  id: 'voronoi',
  name: 'Voronoi',
  entryPoint: 'voronoiResolveCompute',
  animated: true,
  computeMode: 'jump-flood',
});
export const pixelSort = createComputeEffect({
  id: 'pixel-sort',
  name: 'Pixel Sort',
  entryPoint: 'pixelSortCompute',
  category: 'analog',
  params: {
    scale: { type: 'number', label: 'Segment Size', default: 16, min: 4, max: 16, step: 1, group: 'Structure' },
  },
});

export const quadtreeZoom = createComputeEffect({
  id: 'quadtree-zoom',
  name: 'Quadtree Zoom',
  entryPoint: 'quadtreeZoomCompute',
  animated: true,
  params: {
    scale: { type: 'number', label: 'Minimum Cell', default: 8, min: 2, max: 32, step: 1, group: 'Structure' },
    threshold: { type: 'number', label: 'Detail Threshold', default: 0.025, min: 0.001, max: 0.2, step: 0.001, group: 'Structure' },
  },
});
export const contour = createComputeEffect({
  id: 'contour',
  name: 'Contour',
  entryPoint: 'marchingSquaresCompute',
  colors: true,
  params: {
    scale: { type: 'number', label: 'Cell Size', default: 12, min: 4, max: 48, step: 1, group: 'Structure' },
    threshold: { type: 'number', label: 'Iso Level', default: 0.5, min: 0, max: 1, step: 0.01, group: 'Structure' },
  },
});
export const contourMap = createCatalogEffect({ id: 'contour-map', name: 'Contour Map', category: 'geometry', shader, entryPoint: 'contourMapFragment' });
export const contourType = createGlyphEffect({ id: 'contour-type', name: 'Contour Type', category: 'geometry', entryPoint: 'contourTypeFragment', defaultRamp: 'numeric', defaultCellSize: 20 });
export const vectorTiling = createCatalogEffect({ id: 'vector-tiling', name: 'Vector Engraving', category: 'geometry', shader, entryPoint: 'vectorTilingFragment' });
export const crosshatch = createCatalogEffect({ id: 'crosshatch', name: 'Crosshatch', category: 'geometry', shader, entryPoint: 'crosshatchFragment' });
export const embroidery = createCatalogEffect({ id: 'embroidery', name: 'Embroidery', category: 'geometry', shader, entryPoint: 'embroideryFragment', animated: true, clock: 'timeline' });
export const kilim = createCatalogEffect({ id: 'kilim', name: 'Kilim Carpet', category: 'geometry', shader, entryPoint: 'kilimFragment' });
export const outline = createCatalogEffect({ id: 'outline', name: 'Outline', category: 'geometry', shader, entryPoint: 'outlineFragment', animated: true, clock: 'timeline' });
export const bricks = createCatalogEffect({ id: 'bricks', name: 'Toy Bricks', category: 'geometry', shader, entryPoint: 'bricksFragment', animated: true, clock: 'timeline' });

export { splatExploration } from './splat-exploration';
