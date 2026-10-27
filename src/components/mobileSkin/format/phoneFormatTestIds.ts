// Stable selectors of the format sheet.
export const PHONE_FORMAT_TEST_IDS = {
  sheet: 'phone-format-sheet',
  /** Preset chips: `${presets}-9-16`, `${presets}-16-9`, `${presets}-1-1`, `${presets}-4-5`, `${presets}-4-3`, `${presets}-21-9`. */
  presets: 'phone-format-preset',
  /** Layout chips: `${layout}-relative`, `${layout}-pixels`. */
  layout: 'phone-format-layout',
  /** Background chips (greyed until the editor renders a composition background). */
  background: 'phone-format-background',
  size: 'phone-format-size',
} as const;
