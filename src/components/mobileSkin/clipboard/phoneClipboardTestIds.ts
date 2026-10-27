// Stable selectors of the Copy & paste sheet and the shared clip pick list.

export const PHONE_CLIPBOARD_TEST_IDS = {
  status: 'phone-clipboard-status',
  /** One chip per copy group; test id suffix -effects | -colour | -animation. */
  copyGroup: 'phone-clipboard-copy-group',
  copy: 'phone-clipboard-copy',
  /** One chip per paste group; suffix as above. */
  pasteGroup: 'phone-clipboard-paste-group',
  paste: 'phone-clipboard-paste',
  pasted: 'phone-clipboard-pasted',
  empty: 'phone-clipboard-empty',
  replaceNote: 'phone-clipboard-replace-note',
  /** Shared clip pick list: one row per clip, data-clip-id, aria-checked, aria-disabled when greyed. */
  pickRow: 'phone-pick-row',
  pickAll: 'phone-pick-all',
} as const;
