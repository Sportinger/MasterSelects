export const PHONE_OUTPUT_TEST_IDS = {
  stage: 'phone-output-stage',
  /** The box that holds the output preview canvas and the corner handles (16:9, zoomed with the view). */
  box: 'phone-output-box',
  viewport: 'phone-output-viewport',
  tabInput: 'phone-output-tab-input',
  tabOutput: 'phone-output-tab-output',
  fit: 'phone-output-fit',
  zoomLabel: 'phone-output-zoom',
  done: 'phone-output-done',
  cancel: 'phone-output-cancel',
  emptyAdd: 'phone-output-empty-add',
  /** Corner handle of the selected item; data-corner = 0..3 (TL, TR, BR, BL). */
  handle: 'phone-output-handle',
  /** Outline of each item on the stage; data-item-id names it. */
  outline: 'phone-output-outline',

  targets: 'phone-output-targets',
  addTarget: 'phone-output-add-target',
  /** One card per output target; data-target-id names it, data-selected marks the selection. */
  targetCard: 'phone-output-target',
  targetName: 'phone-output-target-name',
  targetSource: 'phone-output-target-source',
  targetEnabled: 'phone-output-target-enabled',
  targetRemove: 'phone-output-target-remove',
  /** Greyed: a phone browser cannot open the output on a second display. */
  targetExternal: 'phone-output-target-external',
  targetPreview: 'phone-output-target-preview',

  slices: 'phone-output-slices',
  addSlice: 'phone-output-add-slice',
  addMask: 'phone-output-add-mask',
  /** One row per slice or mask, in stack order; data-item-id, data-kind (slice|mask), data-selected. */
  item: 'phone-output-item',
  itemEnabled: 'phone-output-item-enabled',
  itemInvert: 'phone-output-item-invert',
  itemUp: 'phone-output-item-up',
  itemDown: 'phone-output-item-down',
  itemDelete: 'phone-output-item-delete',
  itemName: 'phone-output-item-name',
  itemReset: 'phone-output-item-reset',
  itemMatch: 'phone-output-item-match',
  /** Typed corner value of the selected item on the active tab; data-corner 0..3, data-axis x|y. */
  cornerField: 'phone-output-corner-field',
  meshNotice: 'phone-output-mesh-notice',
} as const;
