// Stable selectors of the phone source monitor ('source' sheet).
export const PHONE_SOURCE_TEST_IDS = {
  root: 'phone-source',
  /** One per library media file while no source is chosen; data-item-id. */
  pick: 'phone-source-pick',
  /** The <video>/<img>/<audio> of the source; data-frame is the shown frame. */
  media: 'phone-source-media',
  play: 'phone-source-play',
  stepBack: 'phone-source-step-back',
  stepForward: 'phone-source-step-forward',
  scrub: 'phone-source-scrub',
  frame: 'phone-source-frame',
  markIn: 'phone-source-mark-in',
  markOut: 'phone-source-mark-out',
  inFrame: 'phone-source-in-frame',
  outFrame: 'phone-source-out-frame',
  clearMarks: 'phone-source-clear-marks',
  range: 'phone-source-range',
  /** One per placement mode; data-mode, aria-pressed, aria-disabled. */
  mode: 'phone-source-mode',
  preview: 'phone-source-preview',
  useClipUnderPlayhead: 'phone-source-use-clip',
  target: 'phone-source-target',
  change: 'phone-source-change',
  status: 'phone-source-status',
} as const;
