// Stable selectors of the overlay sheet.
export const PHONE_OVERLAY_TEST_IDS = {
  sheet: 'phone-overlay-sheet',
  pick: 'phone-overlay-pick',
  /** Hidden <input type=file> behind the pick button (for setInputFiles). */
  input: 'phone-overlay-input',
  picked: 'phone-overlay-picked',
  /** Size chips: `${size}-small`, `${size}-medium`, `${size}-large`. */
  size: 'phone-overlay-size',
  /** Place chips: `${place}-center`, `${place}-top-left`, ... */
  place: 'phone-overlay-place',
  /** One row per overlay at the playhead; carries data-clip-id. */
  existing: 'phone-overlay-existing',
  progress: 'phone-overlay-progress',
} as const;
