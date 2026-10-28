/** Pixel Sort Bands recipe limits shared by the effect definition (inspector, tool notes) and its graph. */
export const PIXEL_SORT_BANDS_WIDTH_RANGE = [1, 200] as const;
export const PIXEL_SORT_BANDS_OFFSET_RANGE = [0, 400] as const;
export const PIXEL_SORT_BANDS_TILT_RANGE = [-45, 45] as const;
export const PIXEL_SORT_BANDS_LENGTH_RANGE = [4, 4000] as const;
export const PIXEL_SORT_BANDS_DRIFT_RANGE = [-100000, 100000] as const;
export const PIXEL_SORT_BANDS_SEED_RANGE = [0, 9999] as const;
/** Shortest streak at the start of Progress (1080p pixels). */
export const PIXEL_SORT_BANDS_MIN_LENGTH = 3;
/** Smallest Range at the start of Progress, so the first sorted pixels appear right after 0. */
export const PIXEL_SORT_BANDS_MIN_SPAN = 0.03;
/** Share of Progress over which the sorted bands fade in. */
export const PIXEL_SORT_BANDS_FADE = 0.25;
export const PIXEL_SORT_BANDS_DIRECTION_OPTIONS = [
  { value: 'columns', label: 'Vertical' },
  { value: 'rows', label: 'Horizontal' },
] as const;
export const PIXEL_SORT_BANDS_KEY_OPTIONS = [
  { value: 'luminance', label: 'Brightness' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
] as const;
export const PIXEL_SORT_BANDS_ORDER_OPTIONS = [
  { value: 'ascending', label: 'Low to High' },
  { value: 'descending', label: 'High to Low' },
] as const;
/** Layer 2 sorts the result once more: off, or along the other or the same direction. */
export const PIXEL_SORT_BANDS_LAYER2_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'columns', label: 'Vertical' },
  { value: 'rows', label: 'Horizontal' },
] as const;
