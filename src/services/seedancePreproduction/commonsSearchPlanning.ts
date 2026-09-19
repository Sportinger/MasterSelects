import type { CommonsSourceAsset } from './contracts';

const GENERIC_SEARCH_TERMS = new Set([
  'abbildung', 'archive', 'archival', 'bild', 'building', 'buildings',
  'commons', 'demonstration', 'document', 'documents', 'foto', 'fotos',
  'gebaude', 'historic', 'historical', 'historisch', 'image', 'images',
  'manifestation', 'photo', 'photograph', 'photographs', 'portrait',
  'portraits', 'portrat', 'portrats', 'protest', 'wikimedia',
]);

const TOKEN_STOP_WORDS = new Set([
  'and', 'das', 'de', 'der', 'des', 'die', 'ein', 'eine', 'en', 'et', 'for',
  'für', 'im', 'in', 'la', 'le', 'of', 'the', 'und', 'von', 'zur',
]);

function normalizedText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase();
}

function queryTokens(value: string): string[] {
  return value.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? [];
}

function isYearOrDecade(value: string): boolean {
  return /^(?:1[5-9]|20)\d{2}(?:er|s)?$/iu.test(value);
}

function meaningfulTokens(value: string): string[] {
  return queryTokens(value)
    .map(normalizedText)
    .filter((token) => (
      token.length >= 3
      && !isYearOrDecade(token)
      && !GENERIC_SEARCH_TERMS.has(token)
      && !TOKEN_STOP_WORDS.has(token)
    ));
}

function withoutCommonsBrand(value: string): string {
  return value
    .replace(/\b(?:wikimedia\s+commons|commons\s+wikimedia)\b/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function pushUnique(target: string[], value: string): void {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized && !target.some((candidate) => normalizedText(candidate) === normalizedText(normalized))) {
    target.push(normalized);
  }
}

/**
 * Build a bounded, deterministic sequence of Commons full-text queries.
 * Provider prose often includes the site name, media type and several dates;
 * those terms make MediaWiki search substantially less useful.
 */
export function buildCommonsQueryVariants(requestedQuery: string): string[] {
  const unbranded = withoutCommonsBrand(requestedQuery);
  const rawTokens = queryTokens(unbranded);
  const relaxedTokens = rawTokens.filter((token) => (
    !isYearOrDecade(token)
    && !GENERIC_SEARCH_TERMS.has(normalizedText(token))
  ));
  const variants: string[] = [];
  pushUnique(variants, unbranded);
  pushUnique(variants, relaxedTokens.join(' '));

  if (relaxedTokens.length > 3) {
    pushUnique(variants, relaxedTokens.slice(0, 2).join(' '));
    const middleStart = Math.floor((relaxedTokens.length - 3) / 2);
    pushUnique(variants, relaxedTokens.slice(middleStart, middleStart + 3).join(' '));
    pushUnique(variants, relaxedTokens.slice(-2).join(' '));
  } else if (relaxedTokens.length > 1) {
    pushUnique(variants, relaxedTokens[0] ?? '');
  }

  return variants.slice(0, 5);
}

export function isCommonsResultRelevant(
  asset: Pick<CommonsSourceAsset, 'title' | 'description' | 'creator' | 'credit'>,
  requestedQuery: string,
  matchedQuery = requestedQuery,
): boolean {
  const terms = [...new Set(meaningfulTokens(withoutCommonsBrand(requestedQuery)))];
  if (terms.length === 0) return true;
  const haystack = normalizedText([
    asset.title,
    asset.description,
    asset.creator,
    asset.credit,
  ].join(' '));
  if (/\bportraits?\b/iu.test(normalizedText(requestedQuery))) {
    const normalizedTitle = normalizedText(asset.title);
    if (/\b(?:avenue|boulevard|place|road|rue|square|street|strasse)\b/iu.test(normalizedTitle)) {
      return false;
    }
    const matchedTerms = meaningfulTokens(withoutCommonsBrand(matchedQuery));
    const entityTerms = matchedTerms.length >= 2 && matchedTerms.length <= 3
      ? matchedTerms
      : terms.slice(0, 2);
    if (entityTerms.length >= 2) return haystack.includes(entityTerms.join(' '));
  }
  const matches = terms.filter((term) => haystack.includes(term)).length;
  return matches >= Math.min(2, terms.length);
}
