// Stable selectors of the crop & transform sheet.
export const PHONE_CROP_TEST_IDS = {
  sheet: 'phone-crop-sheet',
  /** Segmented tabs: `${tabs}-crop`, `${tabs}-transform`. */
  tabs: 'phone-crop-tab',
  /** Ratio chips: `${ratios}-free`, `${ratios}-9-16`, `${ratios}-16-9`, `${ratios}-1-1`, `${ratios}-4-5`, `${ratios}-4-3`, `${ratios}-3-4`. */
  ratios: 'phone-crop-ratio',
  cropLeft: 'phone-crop-left',
  cropRight: 'phone-crop-right',
  cropTop: 'phone-crop-top',
  cropBottom: 'phone-crop-bottom',
  softness: 'phone-crop-softness',
  resetCrop: 'phone-crop-reset',
  positionX: 'phone-transform-x',
  positionY: 'phone-transform-y',
  scale: 'phone-transform-scale',
  rotation: 'phone-transform-rotation',
  opacity: 'phone-transform-opacity',
  flipH: 'phone-transform-flip-h',
  flipV: 'phone-transform-flip-v',
  fit: 'phone-transform-fit',
  fill: 'phone-transform-fill',
  resetTransform: 'phone-transform-reset',
  status: 'phone-crop-status',
} as const;
