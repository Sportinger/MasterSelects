// Stable selectors of the markers sheet. Per-marker controls sit inside a row with data-marker-id.

export const PHONE_MARKERS_TEST_IDS = {
  labelInput: 'phone-markers-label',
  /** Suffix: colour index 0..n. */
  color: 'phone-markers-color',
  add: 'phone-markers-add',
  list: 'phone-markers-list',
  empty: 'phone-markers-empty',
  /** One row per marker: data-marker-id, data-time, data-color. */
  row: 'phone-markers-row',
  jump: 'phone-markers-jump',
  more: 'phone-markers-more',
  renameInput: 'phone-markers-rename-input',
  renameApply: 'phone-markers-rename-apply',
  /** Suffix: colour index, inside a row. */
  rowColor: 'phone-markers-row-color',
  moveHere: 'phone-markers-move-here',
  pause: 'phone-markers-pause',
  remove: 'phone-markers-delete',
  lanes: 'phone-markers-lanes',
  message: 'phone-markers-message',
} as const;
