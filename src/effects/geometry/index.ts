import shader from './shader.wgsl?raw';
import { catalogBaseParam, createCatalogEffect, ignoredBaseParams } from '../_shared/catalogEffect';
import { createGlyphEffect } from '../glyph/glyphEffectFactory';
import { createComputeEffect } from './computeEffectFactory';
import type { ComputeEffectDefinition } from '../types';

export const voronoi = createComputeEffect({
  id: 'voronoi',
  name: 'Voronoi',
  entryPoint: 'voronoiResolveCompute',
  animated: true,
  computeMode: 'jump-flood',
});
export const pixelSort: ComputeEffectDefinition = {
  ...createComputeEffect({
    id: 'pixel-sort',
    name: 'Pixel Sort',
    entryPoint: 'pixelSortCompute',
    category: 'analog',
    params: {
      scale: { type: 'number', label: 'Segment Size', default: 16, min: 4, max: 16, step: 1, group: 'Structure' },
      amount: { type: 'number', label: 'Amount', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true, group: 'Style' },
    },
  }),
  experimental: 'Sorts fixed runs of at most 16 pixels instead of brightness intervals, so smooth areas such as sky show a fine stripe texture at the run seams.',
  // The sort works on fixed runs of at most 16 pixels (image.segment-sort-luma); say what renders.
  paramWarnings: values => [
    ...(typeof values.scale === 'number' && (values.scale < 4 || values.scale > 16)
      ? [`Segment Size ${values.scale} is outside 4 to 16 pixels and renders as ${Math.min(16, Math.max(4, Math.round(values.scale)))}.`] : []),
    ...(typeof values.amount === 'number' && (values.amount < 0 || values.amount > 1)
      ? [`Amount ${values.amount} is outside 0 to 1; values outside push sorted pixels past the original colours.`] : []),
    ...(typeof values.threshold === 'number' && values.threshold >= 1
      ? [`Threshold ${values.threshold} is at or above 1, so only pure white pixels can be replaced and the picture passes through almost unchanged.`] : []),
  ],
};

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
// Scale counts the bands (contourMapFragment: levels = scale x 0.35), the reverse of a cell size: its own role.
export const contourMap = createCatalogEffect({ id: 'contour-map', name: 'Contour Map', category: 'geometry', shader, entryPoint: 'contourMapFragment',
  params: { scale: catalogBaseParam('scale', { label: 'Band Density', styleRole: 'band-count' }) },
  retired: ignoredBaseParams('Contour Map', ['angle']) });
export const contourType = createGlyphEffect({ id: 'contour-type', name: 'Contour Type', category: 'geometry', entryPoint: 'contourTypeFragment', defaultRamp: 'numeric', defaultCellSize: 20 });
export const vectorTiling = createCatalogEffect({ id: 'vector-tiling', name: 'Vector Engraving', category: 'geometry', shader, entryPoint: 'vectorTilingFragment' });
export const crosshatch = createCatalogEffect({ id: 'crosshatch', name: 'Crosshatch', category: 'geometry', shader, entryPoint: 'crosshatchFragment', retired: ignoredBaseParams('Crosshatch', ['angle']) });
export const embroidery = createCatalogEffect({ id: 'embroidery', name: 'Embroidery', category: 'geometry', shader, entryPoint: 'embroideryFragment', animated: true, clock: 'timeline', retired: ignoredBaseParams('Embroidery', ['angle', 'colorB']) });
export const kilim = createCatalogEffect({ id: 'kilim', name: 'Kilim Carpet', category: 'geometry', shader, entryPoint: 'kilimFragment', retired: ignoredBaseParams('Kilim Carpet', ['angle']) });
export const outline = createCatalogEffect({ id: 'outline', name: 'Outline', category: 'geometry', shader, entryPoint: 'outlineFragment', animated: true, clock: 'timeline', retired: ignoredBaseParams('Outline', ['scale', 'angle']) });
export const bricks = createCatalogEffect({ id: 'bricks', name: 'Toy Bricks', category: 'geometry', shader, entryPoint: 'bricksFragment', animated: true, clock: 'timeline', retired: ignoredBaseParams('Toy Bricks', ['angle', 'colorA', 'colorB']) });

export { splatExploration } from './splat-exploration';
