// Stable selectors of the transport keyframe diamond and the 'keyframe' sheet.

export const PHONE_KEYFRAME_TEST_IDS = {
  /** Same id the greyed M1 button had, so existing checks keep finding it. data-state: on | off | outside | unavailable. */
  diamond: 'phone-transport-keyframe',
  prev: 'phone-keyframe-prev',
  next: 'phone-keyframe-next',
  /** One row per keyed property, data-property = the property path. */
  row: 'phone-keyframe-row',
  /** One chip per key inside a row, data-time = clip-local seconds. */
  key: 'phone-keyframe-key',
  /** Delete the row's key at the playhead. */
  deleteKey: 'phone-keyframe-delete',
  status: 'phone-keyframe-status',
  /** Select mode: tapping keys picks them (data-picked) instead of jumping. */
  selectMode: 'phone-keyframe-select-mode',
  copy: 'phone-keyframe-copy',
  deleteSelected: 'phone-keyframe-delete-selected',
  /** Pastes the copied keys at the playhead into this clip. */
  paste: 'phone-keyframe-paste',
  pasted: 'phone-keyframe-pasted',
  empty: 'phone-keyframe-empty',
} as const;
