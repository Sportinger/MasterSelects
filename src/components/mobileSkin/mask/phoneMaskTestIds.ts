// Stable selectors of the mask sheet (Playwright and unit tests import them from here).
export const PHONE_MASK_TEST_IDS = {
  sheet: 'phone-mask-sheet',
  /** Chip group; each chip is `${shapes}-${shape}` ('none', 'linear', 'mirror', 'circle', 'rectangle', 'star', 'heart', 'pen'). */
  shapes: 'phone-mask-shape',
  invert: 'phone-mask-invert',
  centerX: 'phone-mask-center-x',
  centerY: 'phone-mask-center-y',
  width: 'phone-mask-width',
  height: 'phone-mask-height',
  rotation: 'phone-mask-rotation',
  feather: 'phone-mask-feather',
  status: 'phone-mask-status',
  // Pen mode.
  penStatus: 'phone-mask-pen-status',
  penUndo: 'phone-mask-pen-undo',
  penClose: 'phone-mask-pen-close',
  penClear: 'phone-mask-pen-clear',
  /** The drawing surface over the preview; data-points and data-closed mirror the path. */
  penOverlay: 'phone-mask-pen-overlay',
  /** One per point; data-index. */
  penPoint: 'phone-mask-pen-point',
  /** Handle knobs of the selected point; data-index, data-sign (1 out, -1 in). */
  penHandle: 'phone-mask-pen-handle',
  /** Constraint toggles in pen mode; each is `${constraint}-${key}` (axisLock, wholeShape, …). */
  constraint: 'phone-mask-constraint',
  /** Turns a Rectangle, Circle, Star or Heart into editable points (a pen path where it sits). */
  editPoints: 'phone-mask-edit-points',
} as const;
