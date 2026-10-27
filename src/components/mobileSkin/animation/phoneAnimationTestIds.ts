// Stable selectors of the phone Animation sheet.

export const PHONE_ANIMATION_TABS = ['in', 'out', 'combo', 'reveal'] as const;
export type PhoneAnimationTab = typeof PHONE_ANIMATION_TABS[number];

export const PHONE_ANIMATION_TEST_IDS = {
  /** `${tab}-${id}` */
  tab: 'phone-animation-tab',
  /** `${preset}-${tab}-${id}`: one chip per preset, 'none' included. */
  preset: 'phone-animation-preset',
  duration: 'phone-animation-duration',
  revealMode: 'phone-animation-reveal',
  revealCursor: 'phone-animation-reveal-cursor',
  note: 'phone-animation-note',
  empty: 'phone-animation-empty',
} as const;

export function phoneAnimationPresetTestId(tab: PhoneAnimationTab, preset: string): string {
  return `${PHONE_ANIMATION_TEST_IDS.preset}-${tab}-${preset}`;
}
