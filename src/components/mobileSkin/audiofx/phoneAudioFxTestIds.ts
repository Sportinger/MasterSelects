// Stable selectors of the phone Audio effects sheet (Playwright journeys and unit tests import them).

export const PHONE_AUDIO_FX_TEST_IDS = {
  target: 'phone-audiofx-target',
  /** Section tabs; suffix is the section id ('effects', 'cleanup', 'ai'). */
  sectionPrefix: 'phone-audiofx-section-',
  empty: 'phone-audiofx-empty',
  /** Applied effect rows carry data-effect-id, data-descriptor and data-enabled. */
  row: 'phone-audiofx-row',
  rowFocus: 'phone-audiofx-row-focus',
  toggle: 'phone-audiofx-toggle',
  moveUp: 'phone-audiofx-move-up',
  moveDown: 'phone-audiofx-move-down',
  remove: 'phone-audiofx-remove',
  mainSlider: 'phone-audiofx-main-slider',
  mainInput: 'phone-audiofx-main-input',
  mainReset: 'phone-audiofx-main-reset',
  mainNote: 'phone-audiofx-main-note',
  allParameters: 'phone-audiofx-all-parameters',
  /** Category chips carry data-group. */
  category: 'phone-audiofx-category',
  /** Add cards carry data-descriptor. */
  card: 'phone-audiofx-card',
  normalize: 'phone-audiofx-normalize',
  silenceThreshold: 'phone-audiofx-silence-threshold',
  silenceThresholdSlider: 'phone-audiofx-silence-threshold-slider',
  silenceRipple: 'phone-audiofx-silence-ripple',
  silenceRun: 'phone-audiofx-silence-run',
  silenceResult: 'phone-audiofx-silence-result',
  repair: 'phone-audiofx-repair',
  stemsRun: 'phone-audiofx-stems-run',
  stemsCancel: 'phone-audiofx-stems-cancel',
  stemsStatus: 'phone-audiofx-stems-status',
  aiStudio: 'phone-audiofx-ai-studio',
  /** Opens the landscape Curves editor on the clip (keyframed effect values over time). */
  effectCurves: 'phone-audiofx-effect-curves',
  /** Opens the landscape Mixer (track and master bus effects). */
  trackEffects: 'phone-audiofx-track-effects',
  /** Greyed rows; suffix is the row id. */
  unavailablePrefix: 'phone-audiofx-unavailable-',
} as const;
