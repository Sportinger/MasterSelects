/** Flow Mosh recipe limits shared by the effect definition (inspector, tool notes) and its graph. */
export const FLOW_MOSH_DISTANCE_RANGE = [0, 3000] as const;
export const FLOW_MOSH_SMOOTHNESS_RANGE = [2, 400] as const;
export const FLOW_MOSH_SWIRL_RANGE = [4, 2000] as const;
export const FLOW_MOSH_CELL_RANGE = [1, 400] as const;
export const FLOW_MOSH_OFFSET_RANGE = [-400, 400] as const;
export const FLOW_MOSH_SPEED_RANGE = [1, 8] as const;
export const FLOW_MOSH_SEED_RANGE = [0, 9999] as const;
/** Backward integration steps per cell (fixed: the trace is stateless). */
export const FLOW_MOSH_STEPS = 10;
/** Cells a Jump copies from at most, across and along (glitch_v3/v4: ±4 and ±2). */
export const FLOW_MOSH_JUMP_CELLS = [4, 2] as const;
/** Cells a Slice shifts a row by at most (glitch_v4: ±10). */
export const FLOW_MOSH_SLICE_CELLS = 10;
/** Turbulence at Progress 0 relative to Progress 1 (the prototypes' turbulence grows as they get wild). */
export const FLOW_MOSH_TURBULENCE_START = 0.2;
export const FLOW_MOSH_SOURCE_OPTIONS = [
  { value: 'brightness', label: 'Brightness' },
  { value: 'red-green', label: 'Red – Green' },
] as const;
export const FLOW_MOSH_SNAP_OPTIONS = [
  { value: 'cells', label: 'Cells' },
  { value: 'pixels', label: 'Pixels' },
] as const;
export const FLOW_MOSH_SHAPE_OPTIONS = [
  { value: 'keep', label: 'Keep' },
  { value: 'move', label: 'Move' },
] as const;
/** Two counter-rotating vortices (fluss_v2.py "wirbel"): centre in frame UV and spin (1 clockwise on screen, −0.8 against). */
export const FLOW_MOSH_VORTICES = [[0.38, 0.5, 1], [0.78, 0.62, -0.8]] as const;
/** Vortex falloff radius as a share of the frame width. */
export const FLOW_MOSH_VORTEX_RADIUS = 0.22;
/** Sort Rows run length in 1080p pixels (glitch_v3.py sorts 96-pixel row segments of its 2970-pixel frame). */
export const FLOW_MOSH_SORT_RUN = 35;
