// Stable selectors of the shape path sheet and its preview overlay (tests import them from here).
export const PHONE_SHAPE_PATH_TEST_IDS = {
  sheet: 'phone-shape-path-sheet',
  status: 'phone-shape-path-status',
  /** Segmented 'draw' | 'edit'. */
  mode: 'phone-shape-path-mode',
  newPath: 'phone-shape-path-new',
  convert: 'phone-shape-path-convert',
  closed: 'phone-shape-path-closed',
  insert: 'phone-shape-path-insert',
  remove: 'phone-shape-path-remove',
  corner: 'phone-shape-path-corner',
  trimStart: 'phone-shape-path-trim-start',
  trimEnd: 'phone-shape-path-trim-end',
  trimOffset: 'phone-shape-path-trim-offset',
  dashLength: 'phone-shape-path-dash-length',
  dashGap: 'phone-shape-path-dash-gap',
  dashOffset: 'phone-shape-path-dash-offset',
  /** Overlay over the preview; data-mode, data-points, data-closed. */
  overlay: 'phone-shape-path-overlay',
  /** One per vertex; data-index. */
  point: 'phone-shape-path-point',
  /** Curve handle knobs of the selected vertex; data-sign (1 out, -1 in). */
  handle: 'phone-shape-path-handle',
} as const;
