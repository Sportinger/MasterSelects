// Stable selectors of the phone Sound range sheet (Playwright journeys import them).

export const PHONE_AUDIO_REGION_TEST_IDS = {
  root: 'phone-region-root',
  /** Why the sheet cannot edit (no audio clip selected, locked track). */
  blocked: 'phone-region-blocked',
  /** Waveform strip; data-mode is 'select' or 'move'. */
  waveform: 'phone-region-waveform',
  range: 'phone-region-range',
  handleStart: 'phone-region-handle-start',
  handleEnd: 'phone-region-handle-end',
  /** Select/Move mode chips; suffix is the mode. */
  modePrefix: 'phone-region-mode-',
  startInput: 'phone-region-start-input',
  endInput: 'phone-region-end-input',
  selectAll: 'phone-region-select-all',
  clearRange: 'phone-region-clear',
  /** Channel chips; suffix 'both' | 'left' | 'right'. */
  channelPrefix: 'phone-region-channel-',
  readout: 'phone-region-readout',
  /** Section tabs; suffix is the section id. */
  sectionPrefix: 'phone-region-section-',
  /** One button per command; suffix is the command key of the editor's region command model. */
  commandPrefix: 'phone-region-cmd-',
  gainSlider: 'phone-region-gain-slider',
  gainInput: 'phone-region-gain-input',
  gainReset: 'phone-region-gain-reset',
  fadeInSlider: 'phone-region-fade-in-slider',
  fadeInInput: 'phone-region-fade-in-input',
  fadeOutSlider: 'phone-region-fade-out-slider',
  fadeOutInput: 'phone-region-fade-out-input',
  roomTone: 'phone-region-room-tone',
  previewEdited: 'phone-region-preview-edited',
  previewSource: 'phone-region-preview-source',
  previewStatus: 'phone-region-preview-status',
  /** Edit stack rows (data-op-type, data-enabled), their bypass and remove buttons. */
  stackRow: 'phone-region-stack-row',
  stackBypass: 'phone-region-stack-bypass',
  stackRemove: 'phone-region-stack-remove',
  /** Opens the desktop audio edit stack (Properties) on the phone. */
  stackPanel: 'phone-region-stack-panel',
  message: 'phone-region-message',
} as const;
