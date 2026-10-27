// Stable selectors of the phone Volume and Audio sheets (Playwright journeys import them).

export const PHONE_VOLUME_TEST_IDS = {
  status: 'phone-volume-status',
  note: 'phone-volume-note',
  levelInput: 'phone-volume-level-input',
  levelSlider: 'phone-volume-level-slider',
  levelReset: 'phone-volume-level-reset',
  mute: 'phone-volume-mute',
  fadeInInput: 'phone-volume-fade-in-input',
  fadeInSlider: 'phone-volume-fade-in-slider',
  fadeOutInput: 'phone-volume-fade-out-input',
  fadeOutSlider: 'phone-volume-fade-out-slider',
  /** Greyed rows; suffix is the row id ('pan', 'noise', 'effects'). */
  unavailablePrefix: 'phone-volume-unavailable-',
} as const;

export const PHONE_AUDIO_TEST_IDS = {
  /** Section tabs; suffix is the section id ('music', 'record', 'extract', 'beats'). */
  sectionPrefix: 'phone-audio-section-',
  status: 'phone-audio-status',
  musicPick: 'phone-audio-music-pick',
  /** Hidden <input type=file> behind the music button (Playwright setInputFiles). */
  musicInput: 'phone-audio-music-input',
  musicItem: 'phone-audio-music-item',
  recordStart: 'phone-audio-record-start',
  recordStop: 'phone-audio-record-stop',
  recordTimer: 'phone-audio-record-timer',
  recordTake: 'phone-audio-record-take',
  extractTarget: 'phone-audio-extract-target',
  extractRun: 'phone-audio-extract-run',
  /** Greyed rows; suffix is the row id ('tracks', 'devices'). */
  unavailablePrefix: 'phone-audio-unavailable-',
} as const;
