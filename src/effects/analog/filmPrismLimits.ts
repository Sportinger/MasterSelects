/** Film Prism recipe constants shared by the effect definition (inspector, tool notes) and its graph. */
export const FILM_PRISM_MODE_OPTIONS = [{ value: 'lens', label: 'Lens (radial)' }, { value: 'prism', label: 'Prism (one direction)' }];
/** Read spread at Fringe 1: lens scale ±1.5 % about the centre, prism shift ±1.5 % of the frame height. */
export const FILM_PRISM_REACH = 0.015;
export const FILM_PRISM_GRAIN_SIZE_RANGE = [0.5, 6] as const;
/** New grain patterns per second of timeline time at Grain Speed 1 (film frame rate). */
export const FILM_PRISM_GRAIN_FPS = 24;
/** The grain frame key cycles after this many patterns (about 41 s), keeping hash inputs small. */
export const FILM_PRISM_GRAIN_CYCLE = 997;
/**
 * Seven reads spread over t in [-1, 1] with normalized red, green and blue weights (triangular
 * spectrum bells at -0.6, 0 and +0.6): edges break into a smooth red-to-blue rainbow.
 */
export const FILM_PRISM_SPECTRUM: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [-1, [0.2143, 0, 0]],
  [-2 / 3, [0.3929, 0.0476, 0]],
  [-1 / 3, [0.2857, 0.2381, 0]],
  [0, [0.1071, 0.4286, 0.1071]],
  [1 / 3, [0, 0.2381, 0.2857]],
  [2 / 3, [0, 0.0476, 0.3929]],
  [1, [0, 0, 0.2143]],
];
