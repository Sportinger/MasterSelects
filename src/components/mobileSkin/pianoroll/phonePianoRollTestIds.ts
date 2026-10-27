export const PHONE_PIANO_ROLL_TEST_IDS = {
  /** The inline piano roll for the selected MIDI clip (data-clip-id). */
  root: 'phone-piano-roll',
  /** Shown when no MIDI clip is selected. */
  empty: 'phone-piano-roll-empty',
  /** One button per MIDI clip of the composition; suffix is the clip id. */
  pick: 'phone-piano-roll-pick',
  create: 'phone-piano-roll-create',
} as const;
