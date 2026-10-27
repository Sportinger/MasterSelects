// Stable selectors of the trim modes sheet ('edits').

export const PHONE_EDITS_TEST_IDS = {
  status: 'phone-edits-status',
  /** Suffix: mode id (ripple, roll, slip, slide, gaps, link). */
  tab: 'phone-edits-tab',
  rippleStart: 'phone-edits-ripple-start',
  rippleEnd: 'phone-edits-ripple-end',
  /** Suffix: start | end, which cut the roll moves. */
  rollSide: 'phone-edits-roll-side',
  /** Stepper prefixes: buttons are <prefix>-minus-<n>, <prefix>-plus-<n>, <prefix>-reset, <prefix>-value. */
  roll: 'phone-edits-roll',
  slip: 'phone-edits-slip',
  slide: 'phone-edits-slide',
  closeGaps: 'phone-edits-close-gaps',
  link: 'phone-edits-link',
  unlink: 'phone-edits-unlink',
  audioSync: 'phone-edits-audio-sync',
  rangeEdits: 'phone-edits-range',
  message: 'phone-edits-message',
  empty: 'phone-edits-empty',
} as const;
