// Stable selectors of the speed sheet (Playwright and unit tests).
export const PHONE_SPEED_TEST_IDS = {
  tabNormal: 'phone-speed-tab-normal',
  tabCurve: 'phone-speed-tab-curve',
  value: 'phone-speed-value',
  slider: 'phone-speed-slider',
  /** One chip per preset speed; suffix is the speed ('0.5', '2', ...). */
  chip: 'phone-speed-chip',
  duration: 'phone-speed-duration',
  keepPitch: 'phone-speed-keep-pitch',
  reverse: 'phone-speed-reverse',
  /** Curve tiles; suffix is the preset id or 'none' / 'custom'. */
  curve: 'phone-speed-curve',
  message: 'phone-speed-message',
  unavailable: 'phone-speed-unavailable',
  /** Names the clip the sheet changes. */
  target: 'phone-speed-target',
  /** Says which other selected clips the sheet leaves unchanged. */
  leftOut: 'phone-speed-left-out',
  freeze: 'phone-speed-freeze',
  fitLength: 'phone-speed-fit-length',
  editPoints: 'phone-speed-edit-points',
} as const;

export function phoneSpeedChipTestId(speed: number): string {
  return `${PHONE_SPEED_TEST_IDS.chip}-${speed}`;
}

export function phoneSpeedCurveTestId(id: string): string {
  return `${PHONE_SPEED_TEST_IDS.curve}-${id}`;
}
