export const FILLER_LEXICONS = {
  de: ['äh', 'ähm', 'hm', 'mhm', 'öh', 'öhm'],
  en: ['uh', 'um', 'uhm', 'er', 'erm', 'mm'],
} as const;

export type FillerLanguage = keyof typeof FILLER_LEXICONS;

export function normalizeToken(text: string): string {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function languageKey(language: string | undefined): FillerLanguage | undefined {
  const base = language?.toLocaleLowerCase().split(/[-_]/u)[0];
  return base === 'de' || base === 'en' ? base : undefined;
}

export function isFillerToken(text: string, language?: string): boolean {
  const token = normalizeToken(text);
  const selectedLanguage = languageKey(language);
  if (selectedLanguage) {
    return (FILLER_LEXICONS[selectedLanguage] as readonly string[]).includes(token);
  }
  return Object.values(FILLER_LEXICONS)
    .some((lexicon) => (lexicon as readonly string[]).includes(token));
}
