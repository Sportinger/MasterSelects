// Stable selectors of the All tools sheet, the desktop-panel sheet and the pro rows that open it.
export const PHONE_PANELS_TEST_IDS = {
  allToolsSearch: 'phone-alltools-search',
  allToolsClear: 'phone-alltools-clear',
  /** One per group; carries data-group. */
  allToolsGroup: 'phone-alltools-group',
  /** One per entry; carries data-entry-id, data-kind and aria-disabled. */
  allToolsEntry: 'phone-alltools-entry',
  allToolsEmpty: 'phone-alltools-empty',
  allToolsCount: 'phone-alltools-count',
  panelHost: 'phone-panel-host',
  panelEmpty: 'phone-panel-empty',
  /** A working row in an M2 sheet that opens a desktop panel or a phone control. */
  proRow: 'phone-pro-row',
  fitLengthInput: 'phone-fit-length-input',
  fitLengthApply: 'phone-fit-length-apply',
} as const;

