// Stable selectors of the phone text style tabs (title sheet), for Playwright and unit tests.

export const PHONE_TEXT_STYLE_TABS = ['font', 'color', 'outline', 'shadow', 'box', 'align', 'animation'] as const;
export type PhoneTextStyleTab = typeof PHONE_TEXT_STYLE_TABS[number];

export const PHONE_TEXT_TEST_IDS = {
  /** One per tab: `${tab}-${id}`. */
  tab: 'phone-text-tab',
  panel: 'phone-text-panel',
  fontCard: 'phone-text-font',
  bold: 'phone-text-bold',
  italic: 'phone-text-italic',
  fontSize: 'phone-text-size',
  letterSpacing: 'phone-text-letter-spacing',
  lineHeight: 'phone-text-line-height',
  fontNote: 'phone-text-font-note',
  color: 'phone-text-color',
  strokeToggle: 'phone-text-outline-toggle',
  strokeColor: 'phone-text-outline-color',
  strokeWidth: 'phone-text-outline-width',
  shadowToggle: 'phone-text-shadow-toggle',
  shadowColor: 'phone-text-shadow-color',
  shadowX: 'phone-text-shadow-x',
  shadowY: 'phone-text-shadow-y',
  shadowBlur: 'phone-text-shadow-blur',
  alignH: 'phone-text-align',
  alignV: 'phone-text-valign',
} as const;

export function phoneTextTabTestId(tab: PhoneTextStyleTab): string {
  return `${PHONE_TEXT_TEST_IDS.tab}-${tab}`;
}
