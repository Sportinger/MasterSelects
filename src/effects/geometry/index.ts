import shader from './shader.wgsl?raw';
import { catalogBaseParam, createCatalogEffect, ignoredBaseParams } from '../_shared/catalogEffect';
import { createGlyphEffect } from '../glyph/glyphEffectFactory';
import { createComputeEffect, VORONOI_CELL_SIZE_PARAM } from './computeEffectFactory';
import type { ComputeEffectDefinition, EffectPreset } from '../types';
import { amountWarnings, cellSizeWarnings } from '../pixel/cellGridParams';

/** Voronoi's named starting points (the Preset row of its card; docs/Features/effects/voronoi.md). */
export const VORONOI_PRESETS: readonly EffectPreset[] = [
  { id: 'stained-glass', name: 'Stained Glass', params: { scale: 40, amount: 1, speed: 0 } },
  { id: 'fine-crackle', name: 'Fine Crackle', params: { scale: 10, amount: 1, speed: 0.5 } },
  { id: 'glass-veil', name: 'Glass Veil', params: { scale: 28, amount: 0.5, speed: 0.5 } },
  { id: 'drifting-shards', name: 'Drifting Shards', params: { scale: 64, amount: 1, speed: 2 } },
];

export const voronoi: ComputeEffectDefinition = {
  ...createComputeEffect({
    id: 'voronoi',
    name: 'Voronoi',
    entryPoint: 'voronoiResolveCompute',
    animated: true,
    computeMode: 'jump-flood',
    params: {
      // 1080p pixels (voronoiSeedCompute), so preview quality, 4K and export show the same cells.
      scale: VORONOI_CELL_SIZE_PARAM,
      // The shared compute schema's Threshold never reached the Voronoi resolve: retired, not shown.
      threshold: { type: 'number', label: 'Threshold', default: 0.45, min: 0, max: 1, step: 0.01, group: 'Style', hidden: true,
        deprecated: 'Voronoi has no Threshold; the value is ignored.' },
    },
  }),
  // The seeds drift with timeline time (Speed), so a paused playhead holds still and export matches the preview.
  requiresContinuousRender: false,
  timelineAnimated: true,
  paramWarnings: values => [
    ...(typeof values.scale === 'number' && values.scale < 4
      ? [`scale: ${values.scale} is below 4 px; Voronoi uses cells of 4 px (of a 1080p frame).`] : []),
    ...amountWarnings(values.amount),
  ],
  presets: VORONOI_PRESETS,
};
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

/** Quadtree Zoom's named starting points (the Preset row of its card; docs/Features/effects/quadtree-zoom.md). */
export const QUADTREE_ZOOM_PRESETS: readonly EffectPreset[] = [
  // Small cells that follow every edge: the picture stays readable, flat areas turn into calm tiles.
  { id: 'fine-print', name: 'Fine Print', params: { scale: 4, threshold: 0.005, amount: 1, speed: 0 } },
  // Chunky tiles on the figure and large squares on the stage (the 4 x 4 grid test keeps the figure in large blocks).
  { id: 'big-tiles', name: 'Big Tiles', params: { scale: 16, threshold: 0.015, amount: 1, speed: 0 } },
  // Tiles laid half over the original: a soft mosaic veil that keeps faces and lines.
  { id: 'tile-veil', name: 'Tile Veil', params: { scale: 8, threshold: 0.02, amount: 0.6, speed: 0.5 } },
  // The split threshold pulses quickly, so cells keep splitting and merging.
  { id: 'breathing-grid', name: 'Breathing Grid', params: { scale: 12, threshold: 0.025, amount: 0.9, speed: 3 } },
];

export const quadtreeZoom: ComputeEffectDefinition = {
  ...createComputeEffect({
    id: 'quadtree-zoom',
    name: 'Quadtree Zoom',
    entryPoint: 'quadtreeZoomCompute',
    animated: true,
    params: {
      // 1080p pixels (quadtreeEffectGraph: Cell Size folder), so preview quality, 4K and export show the same cells.
      scale: { type: 'number', label: 'Minimum Cell', default: 8, min: 2, max: 32, step: 1, unit: ' px', group: 'Structure' },
      threshold: { type: 'number', label: 'Detail Threshold', default: 0.025, min: 0.001, max: 0.2, step: 0.001, group: 'Structure' },
    },
  }),
  // The split pulses with timeline time (Speed), so a paused playhead holds still and export matches the preview.
  requiresContinuousRender: false,
  timelineAnimated: true,
  paramWarnings: (values, width, height) => [
    ...cellSizeWarnings('scale', values.scale, 2, width, height, 'Quadtree Zoom uses cells of 2 pixels'),
    ...amountWarnings(values.amount),
    ...(typeof values.threshold === 'number' && values.threshold <= 0
      ? [`threshold: ${values.threshold} is 0 or below, so every cell splits down to Minimum Cell.`] : []),
  ],
  presets: QUADTREE_ZOOM_PRESETS,
};
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
