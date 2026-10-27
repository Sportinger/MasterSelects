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
} as const;
