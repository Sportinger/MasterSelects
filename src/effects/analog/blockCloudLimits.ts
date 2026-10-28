/** Block Cloud recipe limits shared by the effect definition (inspector, tool notes) and its graph. */
export const BLOCK_CLOUD_CELL_RANGE = [2, 400] as const;
export const BLOCK_CLOUD_OFFSET_RANGE = [-400, 400] as const;
export const BLOCK_CLOUD_COVERAGE_RANGE = [0, 3] as const;
export const BLOCK_CLOUD_CLOUD_SIZE_RANGE = [1, 200] as const;
export const BLOCK_CLOUD_RATE_RANGE = [0, 60] as const;
export const BLOCK_CLOUD_PERIOD_RANGE = [0.1, 30] as const;
export const BLOCK_CLOUD_SEED_RANGE = [0, 9999] as const;
export const BLOCK_CLOUD_COLOR_SLOTS = 6;
/** Highest share of one level the blocks may cover (the prototype's 0.95). */
export const BLOCK_CLOUD_MAX_COVER = 0.95;
/**
 * The three block levels after overlay_pixel.py: block size in cells, share they cover at Progress 1, and the
 * share of the way to Progress 0 by which they are gone (big blocks leave first).
 */
export const BLOCK_CLOUD_LEVELS = [
  { id: 'big', size: 2, cover: 0.22, end: 0.55 },
  { id: 'cell', size: 1, cover: 0.42, end: 0.85 },
  { id: 'small', size: 0.5, cover: 0.3, end: 1 },
] as const;
export const BLOCK_CLOUD_CLEAR_OPTIONS = [
  { value: 'thin', label: 'Thin Out' },
  { value: 'wave', label: 'Wave Front' },
] as const;
export const BLOCK_CLOUD_CLIP_OPTIONS = [
  { value: 'layer', label: 'Layer' },
  { value: 'frame', label: 'Whole Frame' },
] as const;
