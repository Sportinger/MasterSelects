// Stable selectors of the Effects, Filters and Adjust sheets (Playwright journeys and unit tests).

export const PHONE_EFFECTS_TEST_IDS = {
  // Effects sheet.
  effectsTarget: 'phone-effects-target',
  effectsSearch: 'phone-effects-search',
  /** One chip per catalog group; data-group carries the group id ('all' for every group). */
  effectsCategory: 'phone-effects-category',
  /** One card per effect; data-effect-type carries the effect id, aria-disabled when it cannot be added. */
  effectsCard: 'phone-effects-card',
  /** One row per applied effect; data-effect-id / data-effect-type, aria-selected for the focused row. */
  effectsStackRow: 'phone-effects-stack-row',
  effectsToggle: 'phone-effects-toggle',
  effectsRemove: 'phone-effects-remove',
  effectsMoveUp: 'phone-effects-move-up',
  effectsMoveDown: 'phone-effects-move-down',
  effectsAllParameters: 'phone-effects-all-parameters',
  effectsEmpty: 'phone-effects-empty',
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
  // Adjust sheet.
  /** One tile per colour control; data-adjust-key carries the grade parameter. */
  adjustTile: 'phone-adjust-tile',
  adjustResetAll: 'phone-adjust-reset-all',
  adjustWheels: 'phone-adjust-wheels',
  adjustStatus: 'phone-adjust-status',
} as const;
