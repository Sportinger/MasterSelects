export type LegalLang = 'de' | 'en';

/** German for German browsers, English otherwise; shared by the legal dialog and checkout consent. */
export function detectLegalLang(): LegalLang {
  if (typeof navigator === 'undefined') return 'en';
  const language = navigator.language?.toLowerCase() ?? '';
  return language.startsWith('de') ? 'de' : 'en';
}
