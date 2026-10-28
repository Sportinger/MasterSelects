/** Block Silhouette recipe limits shared by the effect definition (inspector, tool notes) and its graph. */
export const BLOCK_SILHOUETTE_SIZE_RANGE = [2, 200] as const;
export const BLOCK_SILHOUETTE_GRID_RANGE = [4, 400] as const;
export const BLOCK_SILHOUETTE_MARK_RANGE = [1, 24] as const;
/** Where marks may sit: where the outline passes, on Ink, on Paper, or everywhere. */
export const BLOCK_SILHOUETTE_AREA_OPTIONS = [
  { value: 'edges', label: 'Edges' },
  { value: 'ink', label: 'Ink' },
  { value: 'paper', label: 'Paper' },
  { value: 'everywhere', label: 'Everywhere' },
] as const;
export const BLOCK_SILHOUETTE_MARK_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'dots', label: 'Dots' },
  { value: 'crosses', label: 'Crosses' },
] as const;
/** What decides Ink: the block's brightness against Threshold, or how far its colour differs from the frame
 * edge in the same row (a render on a studio backdrop or gradient, where the object is as bright as the background). */
export const BLOCK_SILHOUETTE_MEASURE_OPTIONS = [
  { value: 'brightness', label: 'Brightness' },
  { value: 'edge', label: 'Differs from edge' },
] as const;
