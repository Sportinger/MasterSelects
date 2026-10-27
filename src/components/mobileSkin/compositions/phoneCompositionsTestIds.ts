// Stable selectors of the compositions sheet and the top bar's composition controls.

export const PHONE_COMPOSITIONS_TEST_IDS = {
  /** Top bar button: shows the active composition, opens the compositions sheet. */
  topBarButton: 'phone-topbar-compositions',
  /** Top bar crumb back to the composition a nested one was entered from. */
  topBarBack: 'phone-topbar-composition-back',
  list: 'phone-compositions-list',
  /** One row per user-visible composition; carries data-composition-id and data-active. */
  row: 'phone-compositions-row',
  rowOpen: 'phone-compositions-open',
  rowMore: 'phone-compositions-more',
  create: 'phone-compositions-create',
  nameInput: 'phone-compositions-name',
  /** Suffix: format id ('9:16', '16:9', '1:1', '4:5'). */
  formatChip: 'phone-compositions-format',
  /** Suffix: frame rate (24, 25, 30, 60). */
  fpsChip: 'phone-compositions-fps',
  durationValue: 'phone-compositions-duration-value',
  durationDown: 'phone-compositions-duration-down',
  durationUp: 'phone-compositions-duration-up',
  formSubmit: 'phone-compositions-submit',
  formBack: 'phone-compositions-back',
  duplicate: 'phone-compositions-duplicate',
  rename: 'phone-compositions-rename',
  settings: 'phone-compositions-settings',
  remove: 'phone-compositions-delete',
  confirmDelete: 'phone-compositions-confirm-delete',
  nest: 'phone-compositions-nest',
  /** One button per composition clip on the active timeline (data-composition-id). */
  nested: 'phone-compositions-nested',
  message: 'phone-compositions-message',
  /** Greyed background colour row (settings; '-list' suffix in the list). */
  greyedAdvanced: 'phone-compositions-advanced',
  /** Settings: render engine chips; suffix 'raster' | 'path-traced'. */
  renderEngine: 'phone-compositions-render-engine',
  /** Opens the Nodes editor on the composition (settings; '-list' suffix in the list). */
  nodeGraph: 'phone-compositions-node-graph',
} as const;

export function phoneCompositionFormatTestId(format: string): string {
  return `${PHONE_COMPOSITIONS_TEST_IDS.formatChip}-${format}`;
}

export function phoneCompositionFpsTestId(fps: number): string {
  return `${PHONE_COMPOSITIONS_TEST_IDS.fpsChip}-${fps}`;
}
