// Stable selectors of the phone Notation (score) sheet (Playwright journeys import them).

export const PHONE_SCORE_TEST_IDS = {
  root: 'phone-score-root',
  /** "Score clips do not sound in the timeline or export" note above the editor. */
  limit: 'phone-score-limit',
  empty: 'phone-score-empty',
  pick: 'phone-score-pick',
  create: 'phone-score-create',
  touchBar: 'phone-score-touch',
  /** Letter keys; suffix c d e f g a b. */
  letterPrefix: 'phone-score-letter-',
  chordMode: 'phone-score-chord-mode',
  /** Shortcut action keys; suffix is the editor action id (enterRest, pitchUp, deleteSelected, ...). */
  actionPrefix: 'phone-score-action-',
} as const;
