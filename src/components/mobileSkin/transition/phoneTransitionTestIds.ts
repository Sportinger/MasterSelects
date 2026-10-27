// Stable selectors of the transition sheet and the cut buttons (Playwright and unit tests).
export const PHONE_TRANSITION_TEST_IDS = {
  /** One per visible cut on the phone timeline; carries data-clip-a, data-clip-b, data-has-transition. */
  cutButton: 'phone-transition-cut',
  /** Category chips; suffix is the category id ('dissolve', 'wipe', ...). */
  category: 'phone-transition-category',
  /** One tile per transition; suffix is the transition type ('crossfade', 'dip-to-white', ...). 'none' removes. */
  choice: 'phone-transition-choice',
  duration: 'phone-transition-duration',
  durationValue: 'phone-transition-duration-value',
  applyAll: 'phone-transition-apply-all',
  status: 'phone-transition-status',
  message: 'phone-transition-message',
  settings: 'phone-transition-settings',
  /** Enters the transition's own composition (back crumb in the top bar returns to the cut). */
  content: 'phone-transition-content',
  /** Same, then opens the landscape node editor on it. */
  contentNodes: 'phone-transition-content-nodes',
  empty: 'phone-transition-empty',
} as const;

export function phoneTransitionChoiceTestId(type: string): string {
  return `${PHONE_TRANSITION_TEST_IDS.choice}-${type}`;
}

export function phoneTransitionCategoryTestId(category: string): string {
  return `${PHONE_TRANSITION_TEST_IDS.category}-${category}`;
}
