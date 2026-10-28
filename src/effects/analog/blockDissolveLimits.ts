/** Block Dissolve recipe limits shared by the effect definition (inspector, tool notes) and its graph. */
export const BLOCK_DISSOLVE_SIZE_RANGE = [2, 200] as const;
export const BLOCK_DISSOLVE_HOLE_SIZE_RANGE = [2, 16] as const;
export const BLOCK_DISSOLVE_DITHER_SIZE_RANGE = [1, 16] as const;
export const BLOCK_DISSOLVE_EDGE_WIDTH_RANGE = [1, 80] as const;
export const BLOCK_DISSOLVE_MARK_GRID_RANGE = [4, 400] as const;
export const BLOCK_DISSOLVE_MARK_SIZE_RANGE = [1, 24] as const;
export const BLOCK_DISSOLVE_PAPER_MARK_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'dots', label: 'Dots' },
  { value: 'crosses', label: 'Crosses' },
] as const;
export const BLOCK_DISSOLVE_RATE_RANGE = [0, 60] as const;
export const BLOCK_DISSOLVE_SEED_RANGE = [0, 9999] as const;
/** Displaced blocks copy the picture from one to this many block widths to the left or right. */
export const BLOCK_DISSOLVE_DISPLACE_REACH = 3;
/** Object options in their stored order; the graphs read the option index (objectMaskNodes.ts). */
export const OBJECT_MASK_OPTIONS = [
  { value: 'dark', label: 'Dark on light' },
  { value: 'light', label: 'Light on dark' },
  { value: 'alpha', label: 'Alpha' },
  { value: 'everywhere', label: 'Everywhere' },
] as const;
/** Dither pattern: a fixed half-and-half checker, an ordered (Bayer) dither of the brightness, or the checker turned by 45°. */
export const BLOCK_DISSOLVE_PATTERN_OPTIONS = [
  { value: 'checker', label: 'Checker' },
  { value: 'bayer', label: 'Bayer' },
  { value: 'diagonal', label: 'Diagonal' },
] as const;
/** Diagonal of the slant cuts: top-left to bottom-right (the 350Z reel), bottom-left to top-right, or both. */
export const BLOCK_DISSOLVE_SLANT_OPTIONS = [
  { value: 'falling', label: 'Falling' },
  { value: 'rising', label: 'Rising' },
  { value: 'both', label: 'Both' },
] as const;
/** Where holes may sit: biting in from the outline, or anywhere on the object. */
export const BLOCK_DISSOLVE_PLACEMENT_OPTIONS = [
  { value: 'edges', label: 'Edges' },
  { value: 'anywhere', label: 'Anywhere' },
] as const;
/** Dither dot colour: each dot keeps its pixel's colour, or takes Ink. */
export const BLOCK_DISSOLVE_DOT_COLOR_OPTIONS = [
  { value: 'original', label: 'Original' },
  { value: 'ink', label: 'Ink' },
] as const;
export const BLOCK_DISSOLVE_FILL_OPTIONS = [
  { value: 'paper', label: 'Paper' },
  { value: 'transparent', label: 'Transparent' },
] as const;
