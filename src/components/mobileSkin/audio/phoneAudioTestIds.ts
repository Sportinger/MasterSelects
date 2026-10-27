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
  /** Opens the Audio effects sheet for the same clips (M3). */
  audioEffects: 'phone-volume-audio-effects',
  /** Greyed rows with a pointer to where it works; suffix is the row id ('pan', 'noise'). */
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
  /** Opens the Tracks sheet (name, order, mute, solo, level and pan of audio tracks). */
  tracks: 'phone-audio-tracks',
  /** Beats tab: source chips (data-value), Detect, track chips (data-track-id), step chips (data-step). */
  beatsSource: 'phone-audio-beats-source',
  beatsDetect: 'phone-audio-beats-detect',
  beatsTrack: 'phone-audio-beats-track',
  beatsStep: 'phone-audio-beats-step',
  beatsPlace: 'phone-audio-beats-place',
  beatsMessage: 'phone-audio-beats-message',
  /** Opens the Nodes editor, where beat rules stay editable. */
  beatsRules: 'phone-audio-beats-rules',
  /** Greyed rows; suffix is the row id ('devices'). */
  unavailablePrefix: 'phone-audio-unavailable-',
  /** Voiceover tab: record a punch range (data-phase on the group). */
  punch: 'phone-audio-punch',
  punchIn: 'phone-audio-punch-in',
  punchOut: 'phone-audio-punch-out',
  punchInFromPlayhead: 'phone-audio-punch-in-playhead',
  punchOutFromPlayhead: 'phone-audio-punch-out-playhead',
  punchStart: 'phone-audio-punch-start',
  punchStop: 'phone-audio-punch-stop',
  punchStatus: 'phone-audio-punch-status',
  punchTake: 'phone-audio-punch-take',
  /** Voiceover tab: rescue interrupted recordings (items carry data-status, data-session-id). */
  recovery: 'phone-audio-recovery',
  recoveryEmpty: 'phone-audio-recovery-empty',
  recoveryItem: 'phone-audio-recovery-item',
  recoveryAdd: 'phone-audio-recovery-add',
  recoveryDiscard: 'phone-audio-recovery-discard',
  recoveryMessage: 'phone-audio-recovery-message',
  recoveryStorage: 'phone-audio-recovery-storage',
  recoveryWarning: 'phone-audio-recovery-warning',
  /** More audio tools: the Sound range sheet and the Notation (score) sheet. */
  soundRange: 'phone-audio-sound-range',
  notation: 'phone-audio-notation',
} as const;
