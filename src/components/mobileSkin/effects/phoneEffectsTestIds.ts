// Stable selectors of the Effects, Filters and Adjust sheets (Playwright journeys and unit tests).

export const PHONE_EFFECTS_TEST_IDS = {
  // Effects sheet.
  effectsTarget: 'phone-effects-target',
  /** Layer properties an adjustment layer renders without (transform, 3D, transition, ...), with reasons. */
  effectsAdjustmentNotice: 'phone-effects-adjustment-notice',
  effectsSearch: 'phone-effects-search',
  /** One chip per catalog group; data-group carries the group id ('all' for every group). */
  effectsCategory: 'phone-effects-category',
  /** One card per effect; data-effect-type carries the effect id, aria-disabled when it cannot be added. */
  effectsCard: 'phone-effects-card',
  /** The rendered picture inside an Effects or Filters card; data-preview-state idle|loading|ready|unchanged|failed. */
  cardPreview: 'phone-fx-card-preview',
  /** One row per applied effect; data-effect-id / data-effect-type, aria-selected for the focused row. */
  effectsStackRow: 'phone-effects-stack-row',
  effectsToggle: 'phone-effects-toggle',
  effectsRemove: 'phone-effects-remove',
  effectsMoveUp: 'phone-effects-move-up',
  effectsMoveDown: 'phone-effects-move-down',
  effectsAllParameters: 'phone-effects-all-parameters',
  effectsEmpty: 'phone-effects-empty',
  /** Opens Copy & paste focused on effects (keeps this sheet's changes first). */
  effectsClipboard: 'phone-effects-clipboard',
  /** Save the clip's effect stack as a Look: name field, save button, note on what a Look leaves out. */
  effectsSaveLook: 'phone-effects-save-look',
  effectsSaveLookName: 'phone-effects-save-look-name',
  effectsSaveLookNote: 'phone-effects-save-look-note',
  // Shared slider row (effects primary parameter, filter strength, adjust value).
  slider: 'phone-fx-slider',
  sliderValue: 'phone-fx-slider-value',
  sliderReset: 'phone-fx-slider-reset',
  // Filters sheet.
  filtersNone: 'phone-filters-none',
  /** One card per look; data-look-id, aria-pressed for the active one. */
  filtersCard: 'phone-filters-card',
  filtersCategory: 'phone-filters-category',
  filtersStrengthNote: 'phone-filters-strength-note',
  filtersStatus: 'phone-filters-status',
  /** One per saved Look in the Saved group; data-look-id. */
  filtersDeleteLook: 'phone-filters-delete-look',
  // Adjust sheet.
  /** One tile per colour control; data-adjust-key carries the grade parameter. */
  adjustTile: 'phone-adjust-tile',
  adjustResetAll: 'phone-adjust-reset-all',
  adjustWheels: 'phone-adjust-wheels',
  adjustStatus: 'phone-adjust-status',
  /** Names node-driven controls a change or Reset all left unchanged. */
  adjustSkipNote: 'phone-adjust-skip-note',
  /** Opens Copy & paste focused on the colour grade (keeps this sheet's changes first). */
  adjustClipboard: 'phone-adjust-clipboard',
} as const;
