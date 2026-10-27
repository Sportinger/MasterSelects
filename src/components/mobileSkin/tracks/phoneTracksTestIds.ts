// Stable selectors of the tracks sheet. Per-track controls carry data-track-id.

export const PHONE_TRACKS_TEST_IDS = {
  list: 'phone-tracks-list',
  /** One row per track: data-track-id, data-track-type, data-hidden, data-muted, data-solo, data-locked. */
  row: 'phone-tracks-row',
  name: 'phone-tracks-name',
  more: 'phone-tracks-more',
  addVideo: 'phone-tracks-add-video',
  addAudio: 'phone-tracks-add-audio',
  addMidi: 'phone-tracks-add-midi',
  visible: 'phone-tracks-visible',
  mute: 'phone-tracks-mute',
  solo: 'phone-tracks-solo',
  lock: 'phone-tracks-lock',
  target: 'phone-tracks-target',
  renameInput: 'phone-tracks-rename-input',
  renameApply: 'phone-tracks-rename-apply',
  /** Suffix: LabelColor key. */
  color: 'phone-tracks-color',
  /** Suffix: preset id (small, medium, large). */
  height: 'phone-tracks-height',
  moveUp: 'phone-tracks-move-up',
  moveDown: 'phone-tracks-move-down',
  remove: 'phone-tracks-delete',
  /** Opens the landscape mixer. */
  mixer: 'phone-tracks-mixer',
  /** Level and pan of an audio or MIDI track (inside "More"); carries data-track-id. */
  audioRows: 'phone-tracks-audio',
  volumeSlider: 'phone-tracks-volume-slider',
  volumeInput: 'phone-tracks-volume-input',
  volumeReset: 'phone-tracks-volume-reset',
  panSlider: 'phone-tracks-pan-slider',
  panInput: 'phone-tracks-pan-input',
  panReset: 'phone-tracks-pan-reset',
  /** MIDI tracks: opens the landscape piano roll. */
  editNotes: 'phone-tracks-edit-notes',
  message: 'phone-tracks-message',
} as const;
